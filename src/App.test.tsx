import { readFileSync } from 'node:fs';
import { MemoryRouter } from 'react-router';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { LoadOptions } from './audio';
import { renderApp, VIDEO_ID, VIDEO_TITLE, YOUTUBE_CANONICAL } from './test/app-fixture';
import type { MockAuthBackend } from './test/auth-fixture';
import { mockController } from './test/controller-fixture';
import { fakeProjectsApi } from './test/projects-fixture';
import type { FakeProjectsApi } from './test/projects-fixture';
import { marker } from './test/marker-fixture';
import { serverProject } from './test/server-project-fixture';
import { waitForPlayerSettled } from './test/settle-player';
import App from './App';

// jsdom computes no layout, so the navbar's one layout fact — that its own
// stylesheet never caps the rail the shell hands it — is read off the
// stylesheet text. Vitest stubs CSS imports, raw or not, to an empty string,
// so the file is read from disk (Player.test.tsx reads the rails themselves
// the same way).
const navbarCss = readFileSync('src/ui/navbar.css', 'utf8');

// The navbar's sign-in control is its own stylesheet (user.css), reached from
// nowhere else, and it wears the direction with the rest of the chrome (T76) —
// so it is read the same way.
const userCss = readFileSync('src/ui/user.css', 'utf8');

// The gallery wears the same direction (T88), and jsdom computes no layout, so
// the direction facts are read off its stylesheet text too.
const galleryCss = readFileSync('src/ui/gallery.css', 'utf8');

/**
 * A stylesheet's rules, with the prose taken out. Every reader below is
 * looking for what a rule *declares*, and a comment that happens to spell
 * `background:` or `border-radius:` is prose about a rule, not one.
 */
function rulesOf(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Every `border-radius` a stylesheet declares, as written. The value runs to
 * the declaration's `;` or to the block's `}` — a last declaration may legally
 * omit the semicolon, and a pattern that stopped at `;` would run past the
 * brace and read the next rule's text as this one's value.
 */
function radiiDeclaredIn(css: string): string[] {
  return [...rulesOf(css).matchAll(/border-radius:\s*([^;}]+)/g)].map((match) => match[1].trim());
}

/**
 * Every background a stylesheet declares, as written — the same shape of pin,
 * for the question "does anything here fill a band?"
 */
function backgroundsDeclaredIn(css: string): string[] {
  return [...rulesOf(css).matchAll(/background(?:-color)?:\s*([^;}]+)/g)].map((match) =>
    match[1].trim(),
  );
}

/**
 * Every colour a stylesheet assigns, as written: the value of any property
 * that paints — the colour properties, the `border` edges and shorthands, and
 * `box-shadow`, with the border metrics (`border-radius`, `border-width`) left
 * out because they paint nothing.
 *
 * A hex-only pattern would pass an `rgb(15, 118, 110)` teal or a `darkcyan`
 * without noticing, and the fold's claim about these surfaces is that they
 * consume the direction rather than name colours of their own.
 */
function coloursDeclaredIn(css: string): string[] {
  const paintsColour = (property: string): boolean =>
    /^(?:color|background|background-color|box-shadow|outline|outline-color|border|border-[a-z-]+)$/.test(
      property,
    ) && !/^border-(?:radius|width|style)$|^border-[a-z]+-(?:radius|width|style)$/.test(property);
  const declarations = /(?:^|[;{\s])([a-z-]+)\s*:\s*([^;}]+)/g;
  return [...rulesOf(css).matchAll(declarations)]
    .filter((match) => paintsColour(match[1]))
    .map((match) => match[2].trim());
}

/** The navbar's Sign in button — the landing's own button is a second, distinct one. */
function navSignIn(): HTMLElement {
  return within(screen.getByRole('navigation')).getByRole('button', { name: 'Sign in' });
}

/** A button in the navbar, by its accessible name. */
function navButton(name: string): HTMLElement {
  return within(screen.getByRole('navigation')).getByRole('button', { name });
}

/** The signed-in account trigger: the user's name and the chevron (T86). */
function accountTrigger(name = 'Ava Cellist'): HTMLElement {
  return within(screen.getByRole('navigation')).getByRole('button', { name });
}

/** The wordmark — the navbar's only way home (T86). */
function wordmark(): HTMLElement {
  return within(screen.getByRole('navigation')).getByRole('link', { name: 'Rehearsal Marks' });
}

/** Opens the account menu and returns it. */
async function openAccountMenu(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(accountTrigger());
  return screen.getByRole('group', { name: 'Account' });
}

/**
 * Signs in as Ava Cellist through the navbar, publishing the session the way
 * the real backend's redirect round-trip would.
 */
async function signIn(
  user: ReturnType<typeof userEvent.setup>,
  backend: MockAuthBackend,
): Promise<void> {
  await user.click(navSignIn());
  act(() => backend.setUser({ id: 'u1', name: 'Ava Cellist', email: 'ava@example.com' }));
  await screen.findByRole('button', { name: 'Ava Cellist' });
}

/** Types a link into the create surface's link input and submits it. */
async function pasteLink(user: ReturnType<typeof userEvent.setup>, url: string) {
  await user.type(screen.getByLabelText(/paste a YouTube link/i), url);
  await user.click(screen.getByRole('button', { name: /create from link/i }));
}

/**
 * Waits for a workspace row named `name` after leaving a player visit. The
 * row's presence is the signal the visit is over: the player has no list, so a
 * row cannot coexist with its page — the same guarantee the old "wait for the
 * navbar link" trick gave before the navbar became persistent (T45).
 */
async function waitForWorkspaceRow(name: string): Promise<void> {
  await waitFor(() => {
    expect(screen.getAllByRole('listitem').some((li) => li.textContent?.includes(name))).toBe(true);
  });
}

/**
 * Drives a link create whose title lookup is held open, then navigates away to
 * the privacy policy while it is still in flight — the shared "create lands
 * behind a navigation" setup (T45, T46). Returns the release, which drains the
 * create's continuation (title → server create → token check → list refresh)
 * inside act, so the tests assert only the aftermath.
 */
async function createBehindNavigation(): Promise<{
  api: FakeProjectsApi;
  controller: ReturnType<typeof mockController>;
  release: () => Promise<void>;
}> {
  const user = userEvent.setup();
  const api = fakeProjectsApi();
  let releaseTitle!: () => void;
  const pendingTitle = new Promise<void>((resolve) => {
    releaseTitle = resolve;
  });
  const controller = mockController({
    load: vi.fn(async () => ({ duration: 372 })),
  });
  const { auth, navigateTo } = renderApp({
    api,
    controller,
    fetchTitle: async () => {
      await pendingTitle;
      return VIDEO_TITLE;
    },
  });
  await signIn(user, auth);
  await pasteLink(user, YOUTUBE_CANONICAL);
  // The title lookup is still in flight; the user navigates away to a legal page.
  await navigateTo('/privacy');
  expect(screen.getByRole('heading', { name: 'Privacy policy' })).toBeInTheDocument();
  return {
    api,
    controller,
    release: async () => {
      await act(async () => {
        releaseTitle();
        // Drain the create's continuation inside act, so its App updates do not
        // leak past the block.
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
  };
}

/** Narrows a captured `load` call's options to the YouTube arm. */
function youtubeLoad(options: LoadOptions): Extract<LoadOptions, { source: 'youtube' }> {
  if (options.source !== 'youtube') throw new Error('Expected a YouTube load.');
  return options;
}

describe('App create from a YouTube link', () => {
  it('opens a freshly pasted link on the new project’s markings page — a bare project, ready to fill', async () => {
    // End to end: a pasted link creates a bare server project (T51) — nothing
    // decodes, nothing is copied in — and lands on its markings page (T63),
    // because filling the project is what creating it was for. That the
    // practice surface stays playback-only is Player.test.tsx's to hold; what
    // is asked here is whether the arrival can do the job it was chosen for.
    const user = userEvent.setup();
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 372 })),
    });
    const { api, auth } = renderApp({ controller });
    await signIn(user, auth);

    await pasteLink(user, YOUTUBE_CANONICAL);

    await screen.findByRole('heading', { name: VIDEO_TITLE });
    // Where it landed — the markings page's empty first paint (T55): the one
    // thing that fills a project, and both controls that do it.
    expect(screen.getByRole('button', { name: 'Add marker' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add movement' })).toBeInTheDocument();
    expect(screen.getByText(/Nothing marked yet/)).toBeInTheDocument();

    // The created row is bare: the client wrote name, recording title, video
    // ID, an empty timeline, and a zero duration — the server owns the rest.
    const [created] = await api.listMyProjects();
    expect(api.get(created.id)).toEqual(
      expect.objectContaining({
        name: VIDEO_TITLE,
        recordingTitle: VIDEO_TITLE,
        videoId: VIDEO_ID,
        duration: 0,
        markers: [],
        movements: [],
      }),
    );
    await waitForPlayerSettled();

    // The recording is playable where it landed, not merely drawn: the
    // playback keys answer on this page too.
    await user.keyboard(' ');
    expect(controller.togglePlay).toHaveBeenCalled();

    // And it can be filled from here, which is the whole point of the
    // destination — by the key the empty paint names, and by the control
    // beside it. Each mark lands at the playhead it was placed from, and the
    // project's own save path writes both, with no second gesture and no
    // other page visited first.
    act(() => controller.emitPlayback({ duration: 372 }));
    act(() => controller.seek(42));
    await user.keyboard('m');
    act(() => controller.seek(60));
    await user.click(screen.getByRole('button', { name: 'Add marker' }));

    // Both marks are persisted — the page's autosave writes them, ~500ms
    // after the last one, so the wait is the debounce's and says so.
    await waitFor(
      () => expect(api.get(created.id)!.markers.map((marker) => marker.time)).toEqual([42, 60]),
      { timeout: 2000 },
    );
  });

  it('records the video ID as identity whatever form was pasted', async () => {
    const user = userEvent.setup();
    const fetched: string[] = [];
    const { api, auth } = renderApp({
      fetchTitle: async (url) => {
        fetched.push(url);
        return VIDEO_TITLE;
      },
    });
    await signIn(user, auth);

    await pasteLink(user, `https://youtu.be/${VIDEO_ID}?t=42`);

    await screen.findByRole('heading', { name: VIDEO_TITLE });
    const [created] = await api.listMyProjects();
    expect(api.get(created.id)!.videoId).toBe(VIDEO_ID);
    // The title lookup asked about the canonical form, not the pasted one.
    expect(fetched).toEqual([YOUTUBE_CANONICAL]);
    await waitForPlayerSettled();
  });

  it('still creates the project when the title cannot be read', async () => {
    const user = userEvent.setup();
    const { api, auth } = renderApp({ fetchTitle: async () => null });
    await signIn(user, auth);

    await pasteLink(user, YOUTUBE_CANONICAL);

    expect(
      await screen.findByRole('heading', { name: `YouTube video ${VIDEO_ID}` }),
    ).toBeInTheDocument();
    const [created] = await api.listMyProjects();
    expect(created.name).toBe(`YouTube video ${VIDEO_ID}`);
    await waitForPlayerSettled();
  });

  it('surfaces a create failure on the link input', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.failNext('createProject');
    const { auth } = renderApp({ api });
    await signIn(user, auth);

    await pasteLink(user, YOUTUBE_CANONICAL);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong creating the project. Please try again.',
    );
    expect(await api.listMyProjects()).toEqual([]);
  });

  it('offers the YouTube link input on the create surface, and no file picker', async () => {
    const user = userEvent.setup();
    const { auth } = renderApp();
    await signIn(user, auth);

    expect(screen.getByRole('region', { name: 'Create project' })).toBeInTheDocument();
    expect(screen.getByLabelText(/paste a YouTube link/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/audio file/i)).not.toBeInTheDocument();
  });
});

describe('App Projects workspace', () => {
  it('lists stored projects with name, duration, marker count, and last-modified on start', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(serverProject());
    const { auth } = renderApp({ api });
    await signIn(user, auth);

    expect(await screen.findByText('Brahms Op. 118 No. 2')).toBeInTheDocument();
    // The row's meta: duration · marker count · last-modified. The fixture's
    // updatedAt is more than eight weeks old — the date fallback.
    expect(screen.getByText(/2:03\.456 · 2 markers · 2023-11-14/)).toBeInTheDocument();
    // Byte size left the record shape, and the total line with it.
    expect(screen.queryByText(/Total used/)).not.toBeInTheDocument();
  });

  it('shows the empty state pointing at pasting a YouTube link, and no library surface', async () => {
    const user = userEvent.setup();
    const { auth } = renderApp();
    await signIn(user, auth);

    expect(screen.getByRole('heading', { name: 'No projects yet' })).toBeInTheDocument();
    expect(screen.getByText(/paste a YouTube link above to start marking/i)).toBeInTheDocument();
    // The Library tab and its browse surface are gone — the link is the only way in.
    expect(wordmark()).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Library' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /browse the library/i })).not.toBeInTheDocument();
  });

  it('reopens a project and plays it from its canonical URL, markers intact', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    const project = serverProject();
    api.seed(project);
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 123.456 })),
    });
    const { auth } = renderApp({ api, controller });
    await signIn(user, auth);

    await user.click(await screen.findByRole('button', { name: /^Brahms/ }));

    // The player opened on the stored record: no decode (there is no audio),
    // the load is the YouTube arm's canonical URL, and the stored markers
    // come with the record.
    expect(await screen.findByRole('heading', { name: 'Brahms Op. 118 No. 2' })).toBeInTheDocument();
    const loadOptions = youtubeLoad(vi.mocked(controller.load).mock.calls[0][0]);
    expect(loadOptions.url).toBe(YOUTUBE_CANONICAL);
    // A visit writes nothing — the server row is exactly what was read.
    expect(api.get(project.id)).toEqual(expect.objectContaining({ markers: project.markers }));
    await waitForPlayerSettled();
  });

  it('returns to the workspace from the player and lists the new project', async () => {
    const user = userEvent.setup();
    const { api, auth } = renderApp();
    await signIn(user, auth);

    await pasteLink(user, YOUTUBE_CANONICAL);
    await screen.findByRole('heading', { name: VIDEO_TITLE });
    await waitForPlayerSettled();

    // The account menu's My projects is the way home now — the player carries
    // no nav of its own (T45, T86).
    await openAccountMenu(user);
    await user.click(screen.getByRole('link', { name: 'My projects' }));

    await waitForWorkspaceRow(VIDEO_TITLE);
    expect(await api.listMyProjects()).toHaveLength(1);
  });

  it('renames inline, persists, and moves the renamed project to the top', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(serverProject({ id: 'older', name: 'Older', updatedAt: 1_000 }));
    api.seed(serverProject({ id: 'newer', name: 'Newer', updatedAt: 2_000 }));
    const { auth } = renderApp({ api });
    await signIn(user, auth);
    await screen.findByText('Newer');

    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]).getByText('Newer')).toBeInTheDocument();

    await user.click(within(rows[1]).getByRole('button', { name: 'Rename' }));
    const input = screen.getByRole('textbox', { name: 'Project name' });
    await user.clear(input);
    await user.type(input, 'Brahms 2{enter}');

    await screen.findByText('Brahms 2');
    const stored = api.get('older')!;
    expect(stored.name).toBe('Brahms 2');
    expect(stored.updatedAt).toBeGreaterThan(2_000);
    // The rename re-stamps updatedAt, so the renamed row is now newest.
    const reordered = screen.getAllByRole('listitem');
    expect(within(reordered[0]).getByText('Brahms 2')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });

  it('surfaces in the save line that renaming a published project returned it to review', async () => {
    // The T49 trigger returns an owner's edit of a published public project to
    // pending (T52); the save line must say so, and the list badge follows.
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(serverProject());
    const { auth } = renderApp({ api });
    await signIn(user, auth);
    await screen.findByText('Brahms Op. 118 No. 2');

    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByRole('textbox', { name: 'Project name' });
    await user.clear(input);
    await user.type(input, 'Brahms 2{enter}');

    expect(await screen.findByText('Saved — back to review')).toBeInTheDocument();
    expect(screen.getByText('Pending review')).toBeInTheDocument();
    expect(api.get('project-1')!.publicationStatus).toBe('pending');
  });

  it('does not claim a return to review when renaming a private project', async () => {
    // Private work never enters review, so its save line stays plain.
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(serverProject({ visibility: 'private', publicationStatus: 'pending' }));
    const { auth } = renderApp({ api });
    await signIn(user, auth);
    await screen.findByText('Brahms Op. 118 No. 2');

    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByRole('textbox', { name: 'Project name' });
    await user.clear(input);
    await user.type(input, 'Brahms 2{enter}');

    expect(await screen.findByText('Brahms 2')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    expect(screen.queryByText('Saved — back to review')).not.toBeInTheDocument();
  });

  it('deletes after confirmation and empties the workspace', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(serverProject());
    const { auth } = renderApp({ api });
    await signIn(user, auth);
    await screen.findByText('Brahms Op. 118 No. 2');

    const row = screen.getByRole('listitem');
    await user.click(within(row).getByRole('button', { name: 'Delete' }));
    expect(
      screen.getByText('Delete “Brahms Op. 118 No. 2”? This cannot be undone.'),
    ).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByRole('heading', { name: 'No projects yet' })).toBeInTheDocument();
    expect(await api.listMyProjects()).toEqual([]);
  });

  it('shows the save-failed state when a rename hits a failing server', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(serverProject());
    const { auth } = renderApp({ api });
    await signIn(user, auth);
    await screen.findByText('Brahms Op. 118 No. 2');

    api.failNext('saveProject');
    const row = screen.getByRole('listitem');
    await user.click(within(row).getByRole('button', { name: 'Rename' }));
    const input = screen.getByRole('textbox', { name: 'Project name' });
    await user.clear(input);
    await user.type(input, 'New Name{enter}');

    expect(await screen.findByRole('status')).toHaveTextContent('Save failed.');
  });

  it('navigates between the gallery and the workspace through the wordmark and the account menu', async () => {
    const user = userEvent.setup();
    const { auth } = renderApp();
    await signIn(user, auth);

    // The wordmark is the way to the front door.
    await user.click(wordmark());
    expect(await screen.findByText('No public projects yet.')).toBeInTheDocument();

    // And the account menu's My projects is the way back.
    await openAccountMenu(user);
    await user.click(screen.getByRole('link', { name: 'My projects' }));
    expect(screen.getByRole('heading', { name: 'No projects yet' })).toBeInTheDocument();
  });

  it('drops an in-flight page read when the user navigates away', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(serverProject());
    let releaseRead!: () => void;
    const pendingGet = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 123.456 })),
    });
    vi.mocked(api.getProject).mockImplementation(async (id) => {
      await pendingGet;
      return api.get(id) ?? null;
    });
    const { auth } = renderApp({ api, controller });
    await signIn(user, auth);
    await screen.findByText('Brahms Op. 118 No. 2');

    // The row click navigates to the project page; its record read is slow.
    await user.click(screen.getByRole('button', { name: /^Brahms/ }));
    await user.click(wordmark());
    await act(async () => {
      releaseRead();
    });

    // The player must not yank the user off the page they navigated to. The
    // page read is cancelled by the unmount, so the session never builds and
    // the controller is never created in the first place — nothing leaks.
    expect(await screen.findByRole('heading', { name: 'Gallery' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Brahms Op. 118 No. 2' })).not.toBeInTheDocument();
  });

  it('reports a failed delete as its own notice, not as a save error', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(serverProject());
    api.failNext('deleteProject');
    const { auth } = renderApp({ api });
    await signIn(user, auth);
    await screen.findByText('Brahms Op. 118 No. 2');

    const row = screen.getByRole('listitem');
    await user.click(within(row).getByRole('button', { name: 'Delete' }));
    await user.click(within(row).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong deleting the project.',
    );
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    expect(await api.listMyProjects()).toHaveLength(1);
  });
});

describe('App user sign-in', () => {
  it('lands an anonymous visitor on the minimal landing — no create surface', async () => {
    renderApp();

    // The anonymous home is the landing (T51), at the workspace URL /projects:
    // what the app is, and that creating and saving needs sign-in. No create
    // surface, no workspace.
    expect(screen.getByRole('heading', { name: /Mark your rehearsal/ })).toBeInTheDocument();
    expect(screen.getByText(/creating and saving projects requires signing in/i)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Create project' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Projects' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/paste a YouTube link/i)).not.toBeInTheDocument();
    // The landing itself carries the way in.
    expect(
      within(screen.getByRole('region', { name: 'Welcome' })).getByRole('button', {
        name: 'Sign in with Google',
      }),
    ).toBeInTheDocument();
  });

  it('signs in with Google and shows the user in the navbar', async () => {
    const user = userEvent.setup();
    const { auth } = renderApp();

    await user.click(navSignIn());

    expect(auth.signInWithGoogle).toHaveBeenCalledOnce();
    // The redirect round-trip lands the session through the backend's events.
    act(() => auth.setUser({ id: 'u1', name: 'Ava Cellist', email: 'ava@example.com' }));

    expect(await screen.findByRole('button', { name: 'Ava Cellist' })).toBeInTheDocument();
    // The sign-in prompt is gone once the user is signed in.
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('signing out returns to the anonymous landing', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(serverProject());
    const { auth } = renderApp({ api });
    await signIn(user, auth);
    await screen.findByText('Brahms Op. 118 No. 2');

    await openAccountMenu(user);
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    // Anonymous again — the landing, and the workspace list is gone.
    expect(await screen.findByRole('heading', { name: /Mark your rehearsal/ })).toBeInTheDocument();
    expect(screen.queryByText('Brahms Op. 118 No. 2')).not.toBeInTheDocument();
    // The project itself is untouched — it lives on the server, not the shell.
    expect(api.get('project-1')).toBeDefined();
  });

  it('degrades a failed sign-in to anonymous browsing with a notice', async () => {
    const user = userEvent.setup();
    const { auth } = renderApp();

    auth.failNextSignIn();
    await user.click(navSignIn());

    expect(await screen.findByRole('alert')).toHaveTextContent(/didn't work/i);
    // The app never blocked on the failure: the sign-in control is still live.
    expect(navSignIn()).toBeInTheDocument();
  });

  it('a failed sign-out lands anonymous with a partial-sign-out notice — the session was removed', async () => {
    // supabase-js removes the local session (firing SIGNED_OUT) before the
    // API error surfaces, so the honest state is anonymous plus the notice
    // that the server side was not reached.
    const user = userEvent.setup();
    const { auth } = renderApp();
    await signIn(user, auth);

    auth.failNextSignOut();
    await openAccountMenu(user);
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/signed out on this device/i);
    expect(await screen.findByRole('heading', { name: /Mark your rehearsal/ })).toBeInTheDocument();
    expect(navSignIn()).toBeInTheDocument();
  });

  it('a signed-in user can delete their account, confirming the one-way door first', async () => {
    const user = userEvent.setup();
    const { auth } = renderApp();
    await signIn(user, auth);

    // The destructive action hides behind an explicit confirmation that
    // says what the account deletion removes — it never fires by accident.
    await openAccountMenu(user);
    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    expect(screen.getByText(/every project you've created/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete forever' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete forever' }));

    expect(auth.deleteAccount).toHaveBeenCalledOnce();
    // The deletion lands anonymous: the sign-in prompt is back.
    expect(await screen.findByRole('heading', { name: /Mark your rehearsal/ })).toBeInTheDocument();
    expect(navSignIn()).toBeInTheDocument();
  });

  it('cancelling the confirmation restores the menu items and does not delete', async () => {
    const user = userEvent.setup();
    const { auth } = renderApp();
    await signIn(user, auth);

    await openAccountMenu(user);
    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(auth.deleteAccount).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Ava Cellist' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete forever' })).not.toBeInTheDocument();
    // The menu's items are back, and the safe way out is still there.
    expect(screen.getByRole('link', { name: 'My projects' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete account' })).toBeInTheDocument();
  });

  it('a failed account deletion keeps the confirmation open with an honest notice', async () => {
    const user = userEvent.setup();
    const { auth } = renderApp();
    await signIn(user, auth);

    auth.failNextAccountDelete();
    await openAccountMenu(user);
    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    await user.click(screen.getByRole('button', { name: 'Delete forever' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/didn't work/i);
    // Nothing was deleted: the user is still signed in and the confirmation
    // stays, so they can see the reason and retry or cancel.
    expect(screen.getByRole('button', { name: 'Ava Cellist' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete forever' })).toBeInTheDocument();
  });

  it('an unconfigured deployment shows the not-wired-up screen and no chrome', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    render(
      <MemoryRouter>
        <App controllerFactory={() => mockController()} />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/isn't wired up yet/i)).toBeInTheDocument();
    // No navbar, no pages, no sign-in affordance — nothing to press.
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in with Google' })).not.toBeInTheDocument();
  });
});

describe('App project visibility', () => {
  it('makes a public project private', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(serverProject());
    const { auth } = renderApp({ api });
    await signIn(user, auth);
    await screen.findByText('Brahms Op. 118 No. 2');

    await user.click(screen.getByRole('button', { name: 'Make private' }));

    expect(await screen.findByText('Private')).toBeInTheDocument();
    expect(screen.queryByText('Published')).not.toBeInTheDocument();
    expect(api.get('project-1')!.visibility).toBe('private');
  });

  it('making a private project public re-enters review', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(serverProject({ visibility: 'private', publicationStatus: 'pending' }));
    const { auth } = renderApp({ api });
    await signIn(user, auth);
    await screen.findByText('Brahms Op. 118 No. 2');

    await user.click(screen.getByRole('button', { name: 'Make public' }));

    expect(await screen.findByText('Pending review')).toBeInTheDocument();
    expect(api.get('project-1')!.visibility).toBe('public');
    expect(api.get('project-1')!.publicationStatus).toBe('pending');
  });
});

describe('App project naming', () => {
  it('keeps the chosen naming on the project, and a published one returns to review', async () => {
    // The naming is the project's, not the viewer's (T72), so it is stored on
    // the row — and the write is a write to a published project's row, which
    // the review trigger returns to the queue exactly as a rename does.
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(serverProject());
    const { auth } = renderApp({ api });
    await signIn(user, auth);
    await screen.findByText('Brahms Op. 118 No. 2');

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Naming for Brahms Op. 118 No. 2' }),
      'measures',
    );

    expect(await screen.findByText('Pending review')).toBeInTheDocument();
    expect(api.get('project-1')!.naming).toBe('measures');
  });

  it('stores the mode on a private project, which review never touches', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(serverProject({ visibility: 'private', publicationStatus: 'pending' }));
    const { auth } = renderApp({ api });
    await signIn(user, auth);
    await screen.findByText('Brahms Op. 118 No. 2');

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Naming for Brahms Op. 118 No. 2' }),
      'numbers',
    );

    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    expect(api.get('project-1')!.naming).toBe('numbers');
  });
});

describe('App published-project peek', () => {
  it('shows a debounced published-project peek under the link field', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(serverProject());
    api.seed(serverProject({ id: 'project-2', name: 'Another take' }));
    const { auth } = renderApp({ api });
    await signIn(user, auth);

    await user.type(screen.getByLabelText(/paste a YouTube link/i), YOUTUBE_CANONICAL);

    // The 400ms debounce settles, then the count lands under the input.
    expect(await screen.findByText('2 published projects for this video')).toBeInTheDocument();
  });

  it('hides the peek when nothing published exists for the video', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(serverProject({ id: 'project-2', videoId: 'another-video-id' }));
    const { auth } = renderApp({ api });
    await signIn(user, auth);

    await user.type(screen.getByLabelText(/paste a YouTube link/i), YOUTUBE_CANONICAL);

    // The peek stays away — the count is a convenience, never a promise.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(screen.queryByText(/published projects for this video/)).not.toBeInTheDocument();
  });
});

describe('App durable workspace state (T43)', () => {
  it('keeps a create rejection’s guidance across a tab switch', async () => {
    const user = userEvent.setup();
    const { auth } = renderApp();
    await signIn(user, auth);

    await pasteLink(user, 'not a youtube link');
    expect(await screen.findByRole('alert')).toHaveTextContent(/YouTube video link/);

    await user.click(wordmark());
    expect(await screen.findByRole('heading', { name: 'Gallery' })).toBeInTheDocument();
    await openAccountMenu(user);
    await user.click(screen.getByRole('link', { name: 'My projects' }));

    // The guidance is still under the input it explains, and the input still
    // carries the invalid state.
    expect(await screen.findByRole('alert')).toHaveTextContent(/YouTube video link/);
    expect(screen.getByLabelText(/paste a YouTube link/i)).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('App pages and the persistent navbar (T44)', () => {
  it('renders the signed-in workspace at /projects, framed by the persistent navbar', async () => {
    const user = userEvent.setup();
    const { auth } = renderApp();
    await signIn(user, auth);

    expect(screen.getByRole('heading', { name: 'Rehearsal Marks' })).toBeInTheDocument();
    expect(wordmark()).toBeInTheDocument();
    expect(accountTrigger()).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Gallery' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Projects' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Help' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No projects yet' })).toBeInTheDocument();
  });

  it('renders each legal document as its own page, reachable signed out under the persistent navbar', async () => {
    const { navigateTo } = renderApp();

    await navigateTo('/privacy');
    expect(await screen.findByRole('heading', { name: 'Privacy policy' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Rehearsal Marks' })).toBeInTheDocument();

    // The deletion warning is the paragraph this slice moved off "the header";
    // it keeps its promise and no longer names a location that will change.
    const privacy = screen.getByRole('heading', { name: 'Privacy policy' }).closest('section')!;
    expect(privacy).toHaveTextContent('Delete account');
    expect(privacy).toHaveTextContent(/every project you've created/i);
    expect(privacy).not.toHaveTextContent(/in the header/i);

    await navigateTo('/terms');
    expect(await screen.findByRole('heading', { name: 'Terms' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Rehearsal Marks' })).toBeInTheDocument();
  });

  it('sends the retired Help URL to the gallery through the catch-all', async () => {
    const user = userEvent.setup();
    const { auth } = renderApp({ initialEntry: '/help' });
    await signIn(user, auth);

    expect(await screen.findByText('No public projects yet.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Help' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Help' })).not.toBeInTheDocument();
  });

  it('lands an unknown path on the front door, the gallery', async () => {
    const user = userEvent.setup();
    const { auth } = renderApp({ initialEntry: '/no-such-page' });
    await signIn(user, auth);

    expect(await screen.findByText('No public projects yet.')).toBeInTheDocument();
  });

  it('browser Back and Forward move between the workspace pages', async () => {
    const user = userEvent.setup();
    const { auth, go } = renderApp();
    await signIn(user, auth);

    await user.click(wordmark());
    expect(await screen.findByRole('heading', { name: 'Gallery' })).toBeInTheDocument();

    await go(-1);
    expect(screen.getByRole('heading', { name: 'No projects yet' })).toBeInTheDocument();

    await go(1);
    expect(await screen.findByRole('heading', { name: 'Gallery' })).toBeInTheDocument();
  });
});

describe('The navbar wears the direction (T76)', () => {
  it('makes the wordmark the way home, and its name the app’s name alone', async () => {
    const user = userEvent.setup();
    const { auth, currentPath } = renderApp();
    await signIn(user, auth);

    // The wordmark is the navbar's home link, and `getByRole` matches the
    // accessible name whole: a mark that leaked into it would read
    // "R Rehearsal Marks" and match neither this nor the heading below — the
    // same name the app announces itself by.
    const home = screen.getByRole('link', { name: 'Rehearsal Marks' });
    expect(home).toHaveAttribute('href', '/');
    expect(screen.getByRole('heading', { name: 'Rehearsal Marks' })).toBeInTheDocument();

    // And it goes home from wherever the session is, as a link must.
    await user.click(home);
    await waitFor(() => expect(currentPath()).toBe('/'));
    expect(await screen.findByText('No public projects yet.')).toBeInTheDocument();
  });

  it('draws the boxed mark as markup, in front of the name, hidden from assistive technology', () => {
    renderApp();
    const home = screen.getByRole('link', { name: 'Rehearsal Marks' });

    // Markup rather than the prototype's `content` pseudo-element: the mark is
    // no longer throwaway, and only a real element can be hidden from
    // assistive technology — which is the whole point, since the box is the
    // name's initial and not a second word of it.
    const mark = home.querySelector('.app-mark')!;
    expect(mark).toHaveAttribute('aria-hidden', 'true');
    expect(mark).toHaveTextContent('R');

    // In front of the words, so the box reads as the initial of the name beside
    // it. The words carry no space of their own — JSX trims it — so what holds
    // the two apart is the link's flex gap, pinned with the rest of the
    // stylesheet's facts below.
    expect(home.firstElementChild).toBe(mark);
    expect(home.textContent).toMatch(/^R\s*Rehearsal Marks$/);
  });

  it('paints the navbar in the direction’s tokens: paper, hairline, square, no teal', () => {
    // The ground is the direction's paper under a hairline, and both are
    // consumed by name. A rule that spelled its own colour here could drift
    // from the direction with nothing to notice — so every colour the file
    // assigns is a token reference, in whatever notation it might be written.
    expect(navbarCss).toMatch(/\.app-nav\s*\{[^}]*background:\s*var\(--paper\)/);
    expect(navbarCss).toMatch(/\.app-nav\s*\{[^}]*border-bottom:\s*1px solid var\(--rule\)/);
    // `none` paints nothing; every colour that does is a token.
    for (const colour of coloursDeclaredIn(navbarCss).filter((value) => value !== 'none')) {
      expect(colour).toContain('var(--');
    }

    // Square corners throughout: zero is the only radius the chrome declares.
    expect(radiiDeclaredIn(navbarCss).filter((radius) => radius !== '0')).toEqual([]);

    // The mark is markup now (the test above), so the stylesheet may not draw
    // one: a second, unannounced mark from `content` would sit beside the real
    // element and go stale against it.
    expect(navbarCss).not.toMatch(/content:/);
  });

  it('sets the name in the document’s face, with no tint behind any label', () => {
    expect(navbarCss).toMatch(/\.app-name\s*\{[^}]*var\(--serif\)/);

    // The gap between the box and the words. jsdom computes no layout, so the
    // separation is pinned as the rule that makes it rather than as a
    // distance: the words in the source carry no space of their own (the test
    // above), so without this the box would sit flush against the name.
    expect(navbarCss).toMatch(/\.app-name-link\s*\{[^}]*gap:\s*9px/);

    // Links are unhighlighted — no rule pours a tint behind a label. Paper is
    // the only fill in the file: the navbar's ground, the search's box, and
    // the narrow search's dropped panel.
    expect(backgroundsDeclaredIn(navbarCss).filter((value) => value !== 'none')).toEqual([
      'var(--paper)',
      'var(--paper)',
      'var(--paper)',
    ]);
  });

  it('boxes the account control and Sign in at 32px, with the pencil as the only interaction accent', () => {
    // Chrome is the sans and every colour a token: the direction is consumed
    // by name, never re-spelled here.
    expect(userCss).toMatch(/\.user-sign-in,\s*\.user-trigger\s*\{[^}]*var\(--sans\)/);
    expect(userCss).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);

    // One box rule for the bar's controls: the same 32px height and the same
    // ink rule at rest, whether signed in or out.
    expect(userCss).toMatch(/\.user-sign-in,\s*\.user-trigger\s*\{[^}]*height:\s*32px/);
    expect(userCss).toMatch(/\.user-sign-in,\s*\.user-trigger\s*\{[^}]*border:\s*1px solid var\(--ink\)/);

    // The pencil on hover, focus, or open — never a filled pill.
    expect(userCss).toMatch(
      /\.user-trigger\[aria-expanded='true'\]\s*\{[^}]*border-color:\s*var\(--pencil\)/,
    );
    expect(userCss).toMatch(/\.user-sign-in:focus-visible[^{]*\{[^}]*var\(--pencil\)/);

    // The menu is a boxed surface whose rows are unboxed; the legal links are
    // underlined text, not controls.
    expect(userCss).toMatch(/\.user-menu\s*\{[^}]*border:\s*1px solid var\(--ink\)/);
    expect(userCss).toMatch(/\.user-menu\s*\{[^}]*background:\s*var\(--paper\)/);
    expect(userCss).toMatch(/\.user-menu-item\s*\{[^}]*border:\s*0/);
    expect(userCss).toMatch(/\.user-legal-link\s*\{[^}]*text-decoration:\s*underline/);

    // The one-way door keeps the editorial red; nothing else in this file
    // names a colour.
    expect(userCss).toMatch(/\.user-menu-danger\s*\{[^}]*color:\s*var\(--editorial\)/);
    expect(userCss).toMatch(/\.user-delete-forever\s*\{[^}]*background:\s*var\(--editorial\)/);

    // Square corners throughout.
    expect(radiiDeclaredIn(userCss).filter((radius) => radius !== '0')).toEqual([]);
  });

  it('keeps the navbar’s 57px row in both auth states', () => {
    // 12px above, the 32px control, 12px below, and the hairline: the height
    // the shell's player rail budget pays for (app.css). A taller control
    // would take those pixels off the recording.
    expect(navbarCss).toMatch(/\.app-nav-inner\s*\{[^}]*padding-block:\s*12px/);
    expect(userCss).toMatch(/\.user-sign-in,\s*\.user-trigger\s*\{[^}]*height:\s*32px/);
    expect(navbarCss).toMatch(/\.app-nav\s*\{[^}]*border-bottom:\s*1px solid var\(--rule\)/);
  });
});

describe('The account control (T86)', () => {
  it('shows the wordmark, the legal line, and Sign in when signed out — and no page links', async () => {
    renderApp({ initialEntry: '/' });
    await screen.findByText('No public projects yet.');
    const nav = screen.getByRole('navigation');

    expect(wordmark()).toHaveAttribute('href', '/');
    expect(within(nav).getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
    expect(within(nav).getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
    expect(navSignIn()).toHaveTextContent('Sign in');
    expect(navSignIn()).not.toHaveTextContent('Google');

    // The legal line precedes the button in the document, so the bar reads
    // Privacy · Terms, then Sign in.
    const legal = within(nav).getByRole('link', { name: 'Privacy' }).parentElement!;
    expect(legal.compareDocumentPosition(navSignIn()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(within(nav).queryByRole('link', { name: 'Gallery' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Projects' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Help' })).not.toBeInTheDocument();
  });

  it('opens the signed-in menu and exposes its expanded state and items', async () => {
    const user = userEvent.setup();
    const { auth } = renderApp();
    await signIn(user, auth);

    const trigger = accountTrigger();
    expect(trigger).toHaveAttribute('aria-haspopup', 'true');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('group', { name: 'Account' })).not.toBeInTheDocument();

    const menu = await openAccountMenu(user);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(within(menu).getByRole('link', { name: 'My projects' })).toHaveAttribute(
      'href',
      '/projects',
    );
    expect(within(menu).getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
    expect(within(menu).getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
    expect(within(menu).getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(within(menu).getByRole('button', { name: 'Delete account' })).toBeInTheDocument();
    // The old inline block is gone: the trigger is the only place the bar
    // names the user.
    expect(screen.queryByText(/Signed in as/)).not.toBeInTheDocument();
  });

  it('focuses the first item on open, and Escape returns focus to the trigger', async () => {
    const user = userEvent.setup();
    const { auth } = renderApp();
    await signIn(user, auth);

    await openAccountMenu(user);
    expect(screen.getByRole('link', { name: 'My projects' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: 'Account' })).not.toBeInTheDocument();
    expect(accountTrigger()).toHaveFocus();
  });

  it('closes on an outside pointer-down', async () => {
    const user = userEvent.setup();
    const { auth } = renderApp();
    await signIn(user, auth);

    await openAccountMenu(user);
    await user.click(screen.getByRole('heading', { name: 'No projects yet' }));

    expect(screen.queryByRole('group', { name: 'Account' })).not.toBeInTheDocument();
  });

  it('closes when the route changes underneath it', async () => {
    const user = userEvent.setup();
    const { auth, navigateTo } = renderApp();
    await signIn(user, auth);

    await openAccountMenu(user);
    await navigateTo('/privacy');

    expect(await screen.findByRole('heading', { name: 'Privacy policy' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Account' })).not.toBeInTheDocument();
  });

  it('hands focus to Sign in when the session ends', async () => {
    const user = userEvent.setup();
    const { auth } = renderApp();
    await signIn(user, auth);

    await openAccountMenu(user);
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('button', { name: 'Sign in' })).toHaveFocus();
  });

  it('navigates to the legal pages from the menu', async () => {
    const user = userEvent.setup();
    const { auth, currentPath } = renderApp();
    await signIn(user, auth);

    await openAccountMenu(user);
    await user.click(screen.getByRole('link', { name: 'Privacy' }));

    expect(await screen.findByRole('heading', { name: 'Privacy policy' })).toBeInTheDocument();
    await waitFor(() => expect(currentPath()).toBe('/privacy'));
  });

  it('replaces the menu with the confirmation, focusing Cancel, and restores it', async () => {
    const user = userEvent.setup();
    const { auth } = renderApp();
    await signIn(user, auth);

    await openAccountMenu(user);
    await user.click(screen.getByRole('button', { name: 'Delete account' }));

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(screen.queryByRole('link', { name: 'My projects' })).not.toBeInTheDocument();
    expect(screen.getByText(/every project you've created/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('link', { name: 'My projects' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete forever' })).not.toBeInTheDocument();
  });

  it('renders a failed sign-in notice beneath the account control, outside any popup', async () => {
    const user = userEvent.setup();
    const { auth } = renderApp();

    auth.failNextSignIn();
    await user.click(navSignIn());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/didn't work/i);
    expect(alert.closest('[role="group"]')).toBeNull();
    expect(alert.closest('nav')).not.toBeNull();
  });

  it('renders a failed deletion’s notice outside the open confirmation', async () => {
    const user = userEvent.setup();
    const { auth } = renderApp();
    await signIn(user, auth);

    auth.failNextAccountDelete();
    await openAccountMenu(user);
    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    await user.click(screen.getByRole('button', { name: 'Delete forever' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/didn't work/i);
    // Outside the popup, below the control, while the confirmation stays open.
    expect(alert.closest('[role="group"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete forever' })).toBeInTheDocument();
  });

  it('names the account menu as the Delete account location in the policy', async () => {
    const { navigateTo } = renderApp();
    await navigateTo('/privacy');
    const privacy = (await screen.findByRole('heading', { name: 'Privacy policy' })).closest(
      'section',
    )!;
    expect(privacy).toHaveTextContent(/Delete account item in the account menu/);
  });
});

describe('App public gallery (T50)', () => {
  /** A published public project the gallery lists, in the shape the read returns. */
  function galleryProject() {
    return serverProject({
      name: 'Honeck Tchaikovsky 5',
      recordingTitle: 'Tschaikowsky: 5. Sinfonie — hr-Sinfonieorchester, Manfred Honeck',
      videoId: 'a_B02BZp-5Y',
      duration: 3036,
      markers: Array.from({ length: 21 }, (_, i) => marker(`g${i}`, 10 + i)),
    });
  }

  it('renders the public gallery at the front door /, one card per recording', async () => {
    const api = fakeProjectsApi();
    api.seed(galleryProject());
    renderApp({ api, initialEntry: '/' });

    const card = await screen.findByRole('link', { name: /Manfred Honeck/ });
    expect(card).toHaveAttribute('href', '/gallery/project-1');
    expect(card).toHaveTextContent('50:36');
    // The card carries no owner metadata — not the project name, not a count.
    expect(screen.queryByText('Honeck Tchaikovsky 5')).not.toBeInTheDocument();
    expect(screen.queryByText('21 markers')).not.toBeInTheDocument();
    expect(wordmark()).toBeInTheDocument();
  });

  it('opens a gallery card as the read-only view at /gallery/:id', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(galleryProject());
    const { currentPath } = renderApp({ api, initialEntry: '/' });

    await user.click(await screen.findByRole('link', { name: /Manfred Honeck/ }));
    await waitFor(() => expect(currentPath()).toBe('/gallery/project-1'));

    // The read-only surface never offers an edit affordance.
    expect(screen.queryByRole('button', { name: 'Add marker' })).not.toBeInTheDocument();
  });

  it('the wordmark moves between the workspace and the gallery', async () => {
    const user = userEvent.setup();
    const { auth } = renderApp();
    await signIn(user, auth);

    // The signed-in home is the workspace; the wordmark crosses to the front door.
    expect(screen.getByRole('heading', { name: 'No projects yet' })).toBeInTheDocument();
    await user.click(wordmark());
    expect(await screen.findByText('No public projects yet.')).toBeInTheDocument();
  });
});

describe('The gallery search (T87)', () => {
  /**
   * Two recordings with two projects each: the recording titles and the
   * project names overlap, so a title match and a row match are told apart.
   */
  function seedGallery(api: FakeProjectsApi) {
    const tchaikovsky = 'Tschaikowsky: 5. Sinfonie — hr-Sinfonieorchester, Manfred Honeck';
    const bruckner = 'Bruckner: 7. Sinfonie — hr-Sinfonieorchester, Daniel Harding';
    api.seed(
      serverProject({ id: 'p1', name: 'Honeck Tchaikovsky 5', recordingTitle: tchaikovsky, videoId: 'aaa', createdAt: 4_000 }),
    );
    api.seed(
      serverProject({ id: 'p2', name: 'First read', recordingTitle: tchaikovsky, videoId: 'aaa', createdAt: 3_000 }),
    );
    api.seed(
      serverProject({ id: 'p3', name: 'Bruckner 7, first read', recordingTitle: bruckner, videoId: 'bbb', createdAt: 2_000 }),
    );
    api.seed(
      serverProject({ id: 'p4', name: 'Second read', recordingTitle: bruckner, videoId: 'bbb', createdAt: 1_000 }),
    );
  }

  /** The navbar's search box. */
  function gallerySearch(): HTMLElement {
    return within(screen.getByRole('navigation')).getByRole('searchbox', {
      name: 'Search the gallery',
    });
  }

  it('grows a labelled 32px ink-ruled search on the rail’s centre line, collapsing when it no longer fits', () => {
    renderApp();
    expect(gallerySearch()).toHaveAttribute('type', 'search');

    // jsdom computes no layout, so the arrangement is pinned in the
    // stylesheet: where container queries work, the 480px field leaves its
    // track and centres on the navbar, so the input and its button stay
    // centred together rather than sitting off-centre between the ends'
    // unequal widths. The in-track, shrinkable field is the fallback.
    expect(navbarCss).toMatch(
      /\.app-nav-inner\s*\{[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\) auto/,
    );
    expect(navbarCss).toMatch(/\.app-nav-inner\s*\{[^}]*grid-template-areas:\s*'name search auth'/);
    expect(navbarCss).toMatch(/\.app-nav-search\s*\{[^}]*grid-area:\s*search/);
    expect(navbarCss).toMatch(/\.app-nav-search\s*\{[^}]*width:\s*100%/);
    expect(navbarCss).toMatch(/\.app-nav-search\s*\{[^}]*max-width:\s*480px/);
    expect(navbarCss).toMatch(
      /@supports \(container-type: inline-size\)\s*\{[\s\S]*?\.app-nav-search\s*\{[^}]*position:\s*absolute/,
    );
    expect(navbarCss).toMatch(/\.app-nav-search\s*\{[^}]*width:\s*480px/);
    expect(navbarCss).toMatch(/\.app-nav-search\s*\{[^}]*left:\s*50%/);
    expect(navbarCss).toMatch(/\.app-nav-search\s*\{[^}]*transform:\s*translate\(-50%, -50%\)/);
    // The narrow width is the disclosure, not a second row or a shrunken
    // field (T94): the rail is the query container, so the player's
    // height-capped rail collapses too.
    expect(navbarCss).not.toMatch(/grid-template-areas:\s*'name auth'\s*'search search'/);
    expect(navbarCss).toMatch(/\.app-nav-inner\s*\{[^}]*container-type:\s*inline-size/);
    expect(navbarCss).toMatch(
      /@container \(max-width: 1000px\)\s*\{[\s\S]*?\.app-nav-search-trigger\s*\{[^}]*display:\s*inline-grid/,
    );

    // One box rule: 32px, the softer ink at rest going to the full ink on
    // focus, the content face, the pencil on focus.
    expect(navbarCss).toMatch(/\.app-nav-search-input\s*\{[^}]*height:\s*32px/);
    expect(navbarCss).toMatch(/\.app-nav-search-input\s*\{[^}]*border:\s*1px solid var\(--ink-2\)/);
    expect(navbarCss).toMatch(/\.app-nav-search-input:focus-visible[^{]*\{[^}]*border-color:\s*var\(--ink\)/);
    expect(navbarCss).toMatch(/\.app-nav-search-input\s*\{[^}]*var\(--serif\)/);
    expect(navbarCss).toMatch(/\.app-nav-search-input:focus-visible[^{]*\{[^}]*var\(--pencil\)/);
  });

  it('filters on the gallery, writes ?q= with replace, and Back leaves the gallery', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    seedGallery(api);
    const { currentPath, currentSearch, go } = renderApp({ api, initialEntry: '/projects' });

    // The wordmark is a push into the gallery, so Back has somewhere to go.
    await user.click(wordmark());
    expect(await screen.findByRole('link', { name: /Manfred Honeck/ })).toBeInTheDocument();

    // A recording-title match keeps that recording's one card.
    await user.type(gallerySearch(), 'HONECK');
    expect(await screen.findByText('1 recording found.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Manfred Honeck/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Daniel Harding/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Honeck Tchaikovsky 5')).not.toBeInTheDocument();
    expect(gallerySearch()).toHaveValue('HONECK');
    expect(currentSearch()).toBe('?q=HONECK');

    // A project-name match still finds the recording, whose card names it.
    await user.clear(gallerySearch());
    await user.type(gallerySearch(), 'first read');
    expect(await screen.findByText('2 recordings found.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Manfred Honeck/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Daniel Harding/ })).toBeInTheDocument();
    expect(screen.queryByText('First read')).not.toBeInTheDocument();
    expect(screen.queryByText('Second read')).not.toBeInTheDocument();
    expect(currentSearch()).toBe('?q=first+read');

    // Typing replaced: Back goes to the page before the gallery, not through
    // partial queries.
    await go(-1);
    expect(currentPath()).toBe('/projects');
  });

  it('restores the filtered gallery from ?q= on a refresh', async () => {
    const api = fakeProjectsApi();
    seedGallery(api);
    renderApp({ api, initialEntry: '/?q=bruckner' });

    expect(await screen.findByRole('link', { name: /Daniel Harding/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Manfred Honeck/ })).not.toBeInTheDocument();
    expect(gallerySearch()).toHaveValue('bruckner');
  });

  it('carries an empty draft from elsewhere to the gallery on Enter', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    seedGallery(api);
    const { currentPath, currentSearch } = renderApp({ api, initialEntry: '/projects' });

    expect(gallerySearch()).toHaveValue('');
    await user.type(gallerySearch(), 'first read');

    // Off the gallery, typing is a draft: the URL stays put.
    expect(currentPath()).toBe('/projects');
    expect(currentSearch()).toBe('');

    await user.keyboard('{Enter}');
    await waitFor(() => expect(currentPath()).toBe('/'));
    expect(currentSearch()).toBe('?q=first+read');
    expect(await screen.findByText('2 recordings found.')).toBeInTheDocument();
    expect(gallerySearch()).toHaveValue('first read');
  });

  it('offers a 32px ink-ruled magnifier beside the field, named Search', () => {
    renderApp();

    expect(navButton('Search')).toHaveAttribute('type', 'submit');
    expect(navbarCss).toMatch(
      /\.app-nav-search-trigger,\s*\.app-nav-search-submit\s*\{[^}]*height:\s*32px/,
    );
    expect(navbarCss).toMatch(
      /\.app-nav-search-trigger,\s*\.app-nav-search-submit\s*\{[^}]*border:\s*1px solid var\(--ink\)/,
    );
    expect(navbarCss).toMatch(
      /\.app-nav-search-submit:hover,[\s\S]*?border-color:\s*var\(--pencil\)/,
    );
  });

  it('carries a draft to the gallery with the magnifier button', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    seedGallery(api);
    const { currentPath, currentSearch } = renderApp({ api, initialEntry: '/projects' });

    await user.type(gallerySearch(), 'first read');
    await user.click(navButton('Search'));

    await waitFor(() => expect(currentPath()).toBe('/'));
    expect(currentSearch()).toBe('?q=first+read');
    expect(await screen.findByText('2 recordings found.')).toBeInTheDocument();
  });

  it('submits the trimmed draft in place on the gallery, so Back still leaves', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    seedGallery(api);
    const { currentPath, currentSearch, go } = renderApp({ api, initialEntry: '/projects' });

    // The wordmark pushes into the gallery, so Back has somewhere to go.
    await user.click(wordmark());
    expect(await screen.findByRole('link', { name: /Manfred Honeck/ })).toBeInTheDocument();

    // Live typing keeps its untrimmed draft in the URL.
    await user.type(gallerySearch(), ' HONECK ');
    expect(currentSearch()).toBe('?q=+HONECK+');

    await user.click(navButton('Search'));

    // The button trims and replaces; Back still leaves the gallery.
    expect(currentSearch()).toBe('?q=HONECK');
    await go(-1);
    expect(currentPath()).toBe('/projects');
  });

  it('opens the narrow search from a magnifier, focuses the field, and closes on Escape', async () => {
    const user = userEvent.setup();
    renderApp({ initialEntry: '/' });

    const trigger = navButton('Open search');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('aria-controls', 'app-nav-search-panel');
    expect(navbarCss).toMatch(
      /@container \(max-width: 1000px\)\s*\{[\s\S]*?\.app-nav-search-trigger\s*\{[^}]*display:\s*inline-grid/,
    );
    expect(navbarCss).toMatch(
      /\.app-nav-search\[data-open='true'\] \.app-nav-search-panel\s*\{[^}]*display:\s*flex/,
    );

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(navButton('Close search')).toBe(trigger);
    expect(gallerySearch()).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('closes the narrow search when its submit is pressed', async () => {
    const user = userEvent.setup();
    renderApp({ initialEntry: '/' });

    const trigger = navButton('Open search');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    await user.type(gallerySearch(), 'bruckner');
    await user.click(navButton('Search'));

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes the narrow search on a click outside the form', async () => {
    const user = userEvent.setup();
    renderApp({ initialEntry: '/' });

    const trigger = navButton('Open search');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    await user.click(wordmark());

    expect(navButton('Open search')).toHaveAttribute('aria-expanded', 'false');
  });

  it('distinguishes an empty server from a query that matches nothing, and clears', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    seedGallery(api);
    const { currentSearch } = renderApp({ api, initialEntry: '/?q=nothing like this' });

    expect(await screen.findByText('No recordings match “nothing like this”.')).toBeInTheDocument();
    // Zero is still a result count, and the live region announces it.
    expect(screen.getByRole('status')).toHaveTextContent('0 recordings found.');

    await user.click(screen.getByRole('button', { name: 'Clear search' }));

    expect(await screen.findByRole('link', { name: /Manfred Honeck/ })).toBeInTheDocument();
    expect(currentSearch()).toBe('');
    expect(gallerySearch()).toHaveValue('');
  });

  it('says "No public projects yet." even when the URL carries a query', async () => {
    renderApp({ initialEntry: '/?q=anything' });

    expect(await screen.findByText('No public projects yet.')).toBeInTheDocument();
    expect(screen.queryByText(/No recordings match/)).not.toBeInTheDocument();
  });

  it('keeps no draft from one non-gallery page to the next', async () => {
    const user = userEvent.setup();
    const { navigateTo, currentSearch } = renderApp({ initialEntry: '/privacy' });

    await user.type(gallerySearch(), 'bruckner');
    expect(gallerySearch()).toHaveValue('bruckner');
    expect(currentSearch()).toBe('');

    await navigateTo('/terms');
    expect(gallerySearch()).toHaveValue('');
    expect(currentSearch()).toBe('');
  });
});

describe('The gallery wears the player’s direction (T88, T90)', () => {
  it('sets the title, card titles, and prose in the serif', () => {
    // The gallery is the front door and where the search lives, so its content
    // takes the document's face as the player's does.
    expect(galleryCss).toMatch(/\.gallery h2\s*\{[^}]*var\(--serif\)/);
    expect(galleryCss).toMatch(/\.gallery-card-title\s*\{[^}]*var\(--serif\)/);
    expect(galleryCss).toMatch(/\.gallery-empty\s*\{[^}]*var\(--serif\)/);
    expect(galleryCss).toMatch(/\.gallery-error\s*\{[^}]*var\(--serif\)/);
  });

  it('fills the page rail with a grid capped at three across, stepping down to two and one', () => {
    // The card grid takes the whole rail the shell bounds, rather than the old
    // list's 720px prose measure.
    expect(galleryCss).not.toMatch(/\.gallery\s*\{[^}]*max-width/);
    // The grid is an ordered list of cards, with the list's markers removed.
    expect(galleryCss).toMatch(/\.gallery-grid\s*\{[^}]*list-style:\s*none/);

    // Three across is the ceiling; the medium and narrow breakpoints step it
    // down. minmax(0, …) lets each track shrink, so nothing scrolls sideways.
    expect(galleryCss).toMatch(
      /\.gallery-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(galleryCss).toMatch(
      /@media \(max-width: 860px\)\s*\{[\s\S]*?\.gallery-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(galleryCss).toMatch(
      /@media \(max-width: 560px\)\s*\{[\s\S]*?\.gallery-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
    // No column count is ever fixed at a pixel width that could overflow.
    expect(galleryCss).not.toMatch(/grid-template-columns:\s*\d+px/);
  });

  it('frames the 16:9 still in ink with no box around the card', () => {
    expect(galleryCss).toMatch(/\.gallery-thumb\s*\{[^}]*aspect-ratio:\s*16 \/ 9/);
    expect(galleryCss).toMatch(/\.gallery-thumb\s*\{[^}]*border:\s*1px solid var\(--ink\)/);
    expect(galleryCss).toMatch(/\.gallery-thumb\s*\{[^}]*object-fit:\s*cover/);

    // The link is a card of facts, not a second ruled box.
    const cardRule = rulesOf(galleryCss).match(/\.gallery-card\s*\{([^}]*)\}/)![1];
    expect(cardRule).not.toMatch(/border|background/);
  });

  it('gives the recording title ink 600, clamped to two lines', () => {
    expect(galleryCss).toMatch(/\.gallery-card-title\s*\{[^}]*font-weight:\s*600|\.gallery-card-title\s*\{[^}]*font:\s*600/);
    expect(galleryCss).toMatch(/\.gallery-card-title\s*\{[^}]*-webkit-line-clamp:\s*2/);
    expect(galleryCss).toMatch(/\.gallery-card-title\s*\{[^}]*overflow:\s*hidden/);
    expect(galleryCss).toMatch(/\.gallery-card\s*\{[^}]*color:\s*var\(--ink\)/);
  });

  it('sets the duration chip in the sans, whole figures on ink', () => {
    expect(galleryCss).toMatch(/\.gallery-duration\s*\{[^}]*var\(--sans\)/);
    expect(galleryCss).toMatch(/\.gallery-duration\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
    expect(galleryCss).toMatch(/\.gallery-duration\s*\{[^}]*background:\s*var\(--ink\)/);
    expect(galleryCss).toMatch(/\.gallery-duration\s*\{[^}]*color:\s*var\(--paper\)/);
  });

  it('brings the frame, the title, and the retry to the pencil, never a fill', () => {
    // Hover and keyboard focus share the one accent; the platform's ring is
    // replaced so the pencil stays the only colour that means interaction.
    expect(galleryCss).toMatch(/\.gallery-card:hover \.gallery-thumb[^{]*\{[^}]*var\(--pencil\)/);
    expect(galleryCss).toMatch(
      /\.gallery-card:hover \.gallery-card-title[^{]*\{[^}]*var\(--pencil\)/,
    );
    expect(galleryCss).toMatch(/\.gallery-action:hover[^{]*\{[^}]*var\(--pencil\)/);
    expect(galleryCss).toMatch(
      /\.gallery-card:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--pencil\)/,
    );
    expect(galleryCss).toMatch(
      /\.gallery-action:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--pencil\)/,
    );
  });

  it('boxes the retry and Clear search in the sans and the direction’s ink', () => {
    // Retry and Clear search share the rule: chrome is a square 32px ink box,
    // the same control the navbar carries.
    expect(galleryCss).toMatch(/\.gallery-action\s*\{[^}]*height:\s*32px/);
    expect(galleryCss).toMatch(/\.gallery-action\s*\{[^}]*border:\s*1px solid var\(--ink\)/);
    expect(galleryCss).toMatch(/\.gallery-action\s*\{[^}]*var\(--sans\)/);
  });

  it('consumes only the shell’s tokens: no raw colour, no teal, no non-zero radius', () => {
    // `none` paints nothing; a background that ever arrives must be a token.
    for (const colour of coloursDeclaredIn(galleryCss).filter((value) => value !== 'none')) {
      expect(colour).toContain('var(--');
    }
    expect(galleryCss).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    expect(radiiDeclaredIn(galleryCss).filter((radius) => radius !== '0')).toEqual([]);
    // No band or tint is filled anywhere on the surface.
    for (const background of backgroundsDeclaredIn(galleryCss)) {
      expect(background === 'none' || background.startsWith('var(--')).toBe(true);
    }
  });
});

describe('App route-as-session project page (T45)', () => {
  it('renders a project page at /projects/:id — the player under the navbar, restored by a refresh', async () => {
    const api = fakeProjectsApi();
    const project = serverProject({ id: 'p1', name: 'Brahms Op. 118 No. 2', duration: 372 });
    api.seed(project);
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 372 })),
    });
    // A refresh at the project's URL: the router restores the page from the
    // path, and the page builds its own session — no app-level open state.
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1' });

    expect(await screen.findByRole('heading', { name: 'Brahms Op. 118 No. 2' })).toBeInTheDocument();
    // The player is shell chrome under the persistent navbar — the wordmark
    // and the signed-out account control frame it.
    expect(screen.getByRole('heading', { name: 'Rehearsal Marks' })).toBeInTheDocument();
    expect(navSignIn()).toBeInTheDocument();
    expect(container.querySelector('.player-ruler')).toBeInTheDocument();
    await waitForPlayerSettled();
    // A visit writes nothing — the server row is exactly what was read.
    expect(api.get('p1')).toEqual(expect.objectContaining({ markers: project.markers }));
  });

  it('gives the navbar and the page one wide frame on every route', async () => {
    // T84: the rail no longer follows the route. A recording is not prose, so
    // the player's viewport-derived frame is the app's frame; the measures a
    // text surface declares (gallery.css, landing.css) stay inside it. The
    // navbar and the page take the same class on every route the shell
    // serves, the player routes' own not-found arm included, so the two
    // cannot disagree by construction. (Player.test.tsx pins that the class
    // itself carries the wide, height-derived cap.)
    const api = fakeProjectsApi();
    api.seed(serverProject({ id: 'p1', name: 'Brahms Op. 118 No. 2', duration: 372 }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container, navigateTo } = renderApp({ api, controller, initialEntry: '/projects/p1' });
    await waitForPlayerSettled();

    // The rail classes as the DOM actually carries them, not a second
    // selector that could drift from the markup: both elements must carry the
    // one frame class, and nothing else that starts with `page-rail`.
    const railOf = (selector: string): string[] =>
      [...container.querySelector(selector)!.classList]
        .filter((name) => name.startsWith('page-rail'))
        .sort();

    const expectOneFrame = (): void => {
      expect(railOf('.app-nav-inner')).toEqual(['page-rail']);
      expect(railOf('.app-nav-inner')).toEqual(railOf('.app-page'));
    };

    // The owner's player.
    expectOneFrame();

    // A text page: it keeps its prose measure, but inside the same frame.
    await navigateTo('/privacy');
    expect(await screen.findByRole('heading', { name: 'Privacy policy' })).toBeInTheDocument();
    expectOneFrame();

    // The gallery, the workspace's anonymous landing, the read-only public
    // view, the markings page …
    await navigateTo('/');
    expect(await screen.findByRole('heading', { name: 'Gallery' })).toBeInTheDocument();
    expectOneFrame();

    await navigateTo('/projects');
    expect(
      await screen.findByRole('heading', {
        name: 'Mark your rehearsal, save it, come back to it.',
      }),
    ).toBeInTheDocument();
    expectOneFrame();

    await navigateTo('/gallery/p1');
    expect(await screen.findByRole('heading', { name: 'Brahms Op. 118 No. 2' })).toBeInTheDocument();
    await waitForPlayerSettled();
    expectOneFrame();

    await navigateTo('/projects/p1/markings');
    await waitForPlayerSettled();
    expectOneFrame();

    // … and a player route that names no row: the dead-URL surface takes the
    // same frame as the page it heads.
    await navigateTo('/projects/no-such-project');
    expect(
      await screen.findByRole('heading', { name: 'This project could not be found' }),
    ).toBeInTheDocument();
    expectOneFrame();
  });

  it('lets nothing in the navbar’s own stylesheet cap the rail it is handed', () => {
    // jsdom computes no layout, so this is a stylesheet-source fact, pinned the
    // way the rail's own definitions are (Player.test.tsx). The navbar's inner
    // element takes its width from the class the shell hands it; a max-width
    // declared here — or any rule more specific than .page-rail, which a
    // `.app-nav .app-nav-inner` selector would be — silently beats the rail
    // while the test above still sees the right class names on both.
    expect(navbarCss).not.toMatch(/\.app-nav-inner[^{]*\{[^}]*\b(?:max-)?width\s*:/);
  });

  it('opening a project from the list navigates to its page', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(serverProject({ id: 'p1', name: 'Brahms Op. 118 No. 2' }));
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 372 })),
    });
    const { auth, currentPath } = renderApp({ api, controller });
    await signIn(user, auth);

    await user.click(await screen.findByRole('button', { name: /^Brahms/ }));

    expect(await screen.findByRole('heading', { name: 'Brahms Op. 118 No. 2' })).toBeInTheDocument();
    // The open is a navigation — the project's page is the address bar's.
    // (The probe's location closure updates on an effect, hence the wait.)
    await waitFor(() => expect(currentPath()).toBe('/projects/p1'));
    await waitForPlayerSettled();
  });

  it('browser Back returns to the Projects list, and the visit wrote nothing', async () => {
    // Into the player: the load's measured duration differs from the stored
    // one, but under ADR-0006 duration is in-memory only — the autosave skips
    // the PATCH, so the server row is untouched however long the visit lasts.
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(serverProject({ id: 'p1', name: 'Brahms Op. 118 No. 2', duration: 372 }));
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 500 })),
    });
    const { auth, go } = renderApp({ api, controller });
    await signIn(user, auth);

    await user.click(await screen.findByRole('button', { name: /^Brahms/ }));
    await screen.findByRole('heading', { name: 'Brahms Op. 118 No. 2' });
    await waitForPlayerSettled();

    // Back is the exit: the page tears down, flushing its pending autosave,
    // then the workspace re-reads the list.
    await go(-1);
    await waitForWorkspaceRow('Brahms Op. 118 No. 2');

    // No write reached the server — duration, markers, and name all unchanged.
    expect(api.get('p1')).toEqual(expect.objectContaining({ duration: 372 }));
    expect(api.saveProject).not.toHaveBeenCalled();
  });

  it('navigating from one project page to another closes the first and opens the second', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(serverProject({ id: 'p1', name: 'Brahms Op. 118 No. 2' }));
    api.seed(serverProject({ id: 'p2', name: 'Bach Cello Suite', duration: 372 }));
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 372 })),
    });
    const { auth, navigateTo } = renderApp({ api, controller });
    await signIn(user, auth);

    await user.click(await screen.findByRole('button', { name: /^Brahms/ }));
    await screen.findByRole('heading', { name: 'Brahms Op. 118 No. 2' });

    // Straight to another project's page — the swap tears the first session
    // down and the second mounts its own.
    await navigateTo('/projects/p2');

    expect(await screen.findByRole('heading', { name: 'Bach Cello Suite' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Brahms Op. 118 No. 2' })).not.toBeInTheDocument();
    // Settle the second page's load inside act before the test ends.
    await waitForPlayerSettled();
  });

  it('shows the not-found page for a missing project, with a way back to the list', async () => {
    // A URL that names no record (a deleted project, an edited link) renders
    // the not-found page rather than a blank or broken surface — and the page
    // itself offers the way back, not just the navbar (T47).
    const user = userEvent.setup();
    const { auth } = renderApp({ initialEntry: '/projects/no-such-project' });
    await signIn(user, auth);

    expect(
      await screen.findByRole('heading', { name: 'This project could not be found' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Back to Projects' }));
    expect(await screen.findByRole('heading', { name: 'No projects yet' })).toBeInTheDocument();
  });

  it('a failed record read lands home with a notice, not the not-found page', async () => {
    // A read that fails is not "not found" — the server was unreachable, not
    // empty. The page falls back to the Projects home, the workspace's notice
    // says what went wrong, and the not-found page is not shown.
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    const { auth, navigateTo } = renderApp({ api });
    await signIn(user, auth);
    await screen.findByRole('heading', { name: 'No projects yet' });

    api.failNext('getProject');
    await navigateTo('/projects/p1');

    expect(await screen.findByRole('heading', { name: 'No projects yet' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't open that project. Try again.");
    expect(
      screen.queryByRole('heading', { name: 'This project could not be found' }),
    ).not.toBeInTheDocument();
  });

  it('an anonymous read failure lands on the landing with the notice shown', async () => {
    // A signed-out visitor has no workspace to hold the notice — the bounce
    // home is the anonymous landing, and the failure must not be lost there.
    const api = fakeProjectsApi();
    const { navigateTo } = renderApp({ api });
    await screen.findByRole('heading', { name: /mark your rehearsal/i });

    api.failNext('getProject');
    await navigateTo('/projects/p1');

    expect(
      await screen.findByRole('heading', { name: /mark your rehearsal/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't open that project. Try again.");
    expect(
      screen.queryByRole('heading', { name: 'This project could not be found' }),
    ).not.toBeInTheDocument();
  });

  it('does not flash the not-found page when a missing project is followed by a real one', async () => {
    // A stale missing flag from the previous id must never paint on a live
    // project's URL: navigating from a missing project to a real one (Back,
    // or a hand-navigated URL) shows the loading/player surface, not the
    // not-found page. The real project's read is held open so the flash
    // window — the committed render before the effect resets the flag — is
    // wide enough to observe.
    const api = fakeProjectsApi();
    api.seed(serverProject({ id: 'p1', name: 'Brahms Op. 118 No. 2' }));
    let releaseRead!: () => void;
    const pendingGet = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    let reads = 0;
    vi.mocked(api.getProject).mockImplementation(async (id) => {
      reads += 1;
      // Only the revisit of the real project is held open — the first read
      // (the missing id) and any other reads run straight through.
      if (id === 'p1' && reads > 1) await pendingGet;
      return api.get(id) ?? null;
    });
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 372 })),
    });
    const { auth, navigateTo } = renderApp({
      api,
      controller,
      initialEntry: '/projects/no-such-project',
    });
    await signIn(userEvent.setup(), auth);

    expect(
      await screen.findByRole('heading', { name: 'This project could not be found' }),
    ).toBeInTheDocument();

    await navigateTo('/projects/p1');

    // The real project's read is still in flight — the only surface that may
    // be showing is the loading placeholder, never the not-found page.
    expect(
      screen.queryByRole('heading', { name: 'This project could not be found' }),
    ).not.toBeInTheDocument();

    await act(async () => {
      releaseRead();
      // A full turn drains the held read's whole continuation — the mock
      // implementation's await, then the page's own setState — inside act.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(await screen.findByRole('heading', { name: 'Brahms Op. 118 No. 2' })).toBeInTheDocument();
    await waitForPlayerSettled();
  });

  it('the not-found escape replaces the dead URL, so browser Back does not re-enter it', async () => {
    // Escaping via the page's own link replaces the dead entry in history
    // (the old navigate-home-invariant): Back from the Projects list goes
    // past the dead URL rather than back into the not-found page.
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(serverProject({ id: 'p1', name: 'Brahms Op. 118 No. 2' }));
    const { auth, navigateTo, go } = renderApp({ api });
    await signIn(user, auth);
    await screen.findByText('Brahms Op. 118 No. 2');

    await navigateTo('/projects/no-such-project');
    expect(
      await screen.findByRole('heading', { name: 'This project could not be found' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Back to Projects' }));
    expect(await screen.findByText('Brahms Op. 118 No. 2')).toBeInTheDocument();

    await go(-1);

    expect(
      screen.queryByRole('heading', { name: 'This project could not be found' }),
    ).not.toBeInTheDocument();
    // Back landed on the entry before the dead URL — the Projects list.
    expect(screen.getByText('Brahms Op. 118 No. 2')).toBeInTheDocument();
  });

  it('a create that lands behind a navigation saves the project and does not yank the user', async () => {
    const { api, controller, release } = await createBehindNavigation();
    await release();

    // The project is saved and waiting in the list; the user stays on the legal page.
    expect(screen.getByRole('heading', { name: 'Privacy policy' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: VIDEO_TITLE })).not.toBeInTheDocument();
    const projects = await api.listMyProjects();
    expect(projects.map((p) => p.name)).toEqual([VIDEO_TITLE]);
    // No session ever opened — the controller is never created.
    expect(controller.load).not.toHaveBeenCalled();
  });
});

describe('App create-from-link lands on the markings page (T63, amending T46)', () => {
  it('lands a link create where the marking starts — the new project’s own markings URL, under the navbar', async () => {
    const user = userEvent.setup();
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 372 })),
    });
    const { api, auth, currentPath } = renderApp({ controller });
    await signIn(user, auth);

    await pasteLink(user, YOUTUBE_CANONICAL);

    // The page arrived knowing which recording it is: the shared surface
    // paints the new row's name in its title band. (That the recording also
    // plays here is the sibling test's assertion, not this heading's.)
    expect(await screen.findByRole('heading', { name: VIDEO_TITLE })).toBeInTheDocument();
    // The URL is the new project's own markings address — the created row's
    // id, not a hardcoded path — so the page is refreshable and shareable. It
    // is the page that can fill the project, which is what creating it meant.
    const [created] = await api.listMyProjects();
    await waitFor(() => expect(currentPath()).toBe(`/projects/${created.id}/markings`));
    // The persistent navbar still frames the player page.
    expect(accountTrigger()).toBeInTheDocument();
    // The load settles before the test finishes, so the page's autosave is not
    // left pending across the teardown.
    await waitForPlayerSettled();
  });

  it('a create that lands behind a navigation is waiting in the list when the user returns', async () => {
    const { api, release } = await createBehindNavigation();
    await release();

    // Not yanked: the user is still where they chose to go.
    expect(screen.getByRole('heading', { name: 'Privacy policy' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: VIDEO_TITLE })).not.toBeInTheDocument();

    // Their own return to Projects finds the saved project in the list.
    const user = userEvent.setup();
    await openAccountMenu(user);
    await user.click(screen.getByRole('link', { name: 'My projects' }));
    await waitForWorkspaceRow(VIDEO_TITLE);
    expect(await api.listMyProjects()).toHaveLength(1);
  });
});

describe('App — one code path (T73)', () => {
  /**
   * The prototype's wiring, named so a guard can look for it: `?variant=` was
   * how a direction was chosen, `data-direction` was how the shell marked the
   * one it was wearing, and the switcher was the dev-only control that set it.
   * The fold ships one code path — the direction is simply the app's style —
   * so all three must stay gone, and this is the test that says so.
   */
  const PROTOTYPE = ['[data-direction]', '[class*="prototype"]'];

  function expectNoPrototype(container: HTMLElement): void {
    for (const selector of PROTOTYPE) {
      expect(container.querySelector(selector)).toBeNull();
    }
    // The direction attribute was set on the document, not on a node inside
    // the app — so the shell itself is checked too.
    expect(document.documentElement.getAttribute('data-direction')).toBeNull();
  }

  it('ignores a variant parameter at a player URL', async () => {
    const api = fakeProjectsApi();
    api.seed(serverProject({ id: 'p1', name: 'Brahms Op. 118 No. 2', duration: 372 }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    // A variant the prototype would have honoured.
    const { container } = renderApp({ api, controller, initialEntry: '/projects/p1?variant=console' });

    expect(await screen.findByRole('heading', { name: 'Brahms Op. 118 No. 2' })).toBeInTheDocument();
    // The one page, whole: the readout is the surface the direction is
    // established on, and it renders without a parameter choosing for it.
    expect(screen.getByRole('region', { name: 'Practice readout' })).toBeInTheDocument();
    expectNoPrototype(container);
    await waitForPlayerSettled();
  });

  it('ignores a variant parameter on the gallery, where the switcher first lived', async () => {
    // The strongest reading of "one code path": a parameter the prototype would
    // have honoured does not merely fail to set an attribute — it changes
    // nothing at all. The page a `?variant=` URL draws is the page the plain
    // URL draws, byte for byte. The gallery's empty state is the surface to say
    // that on because it renders no clock and no async content, so the two
    // readings are comparable.
    const plain = renderApp({ initialEntry: '/' });
    expect(await screen.findByText('No public projects yet.')).toBeInTheDocument();
    const withoutParam = plain.container.innerHTML;
    plain.unmount();

    const variant = renderApp({ initialEntry: '/?variant=part' });
    expect(await screen.findByText('No public projects yet.')).toBeInTheDocument();
    expect(variant.container.innerHTML).toBe(withoutParam);
    expectNoPrototype(variant.container);
  });
});

describe('App — the panel wears the direction on every surface now (T78, T95)', () => {
  it('frames the panel on the player, the public view, and the markings page alike', async () => {
    // T78 drew the panel's frame and boxed mark for the practice routes alone,
    // keyed on the fold's scoping hook (`.practice-surface`, T77). T95 retires
    // that hook: the frame, the scrollbar and the movement bands are the whole
    // panel's now, on every route that hosts it, and the markings page is no
    // longer the one surface excepted. What still tells the surfaces apart is
    // the markup the panel itself chooses — the door and the boxed mark are
    // the browsing panel's alone, and the markings page's own add controls and
    // plain label are `MarkersPanel`'s authoring branch (`MarkersPanel.tsx`),
    // not a class this fold ever reached. This is where the three readings are
    // compared on the same project, in the DOM the app actually renders.
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(serverProject({ id: 'p1', name: 'Brahms Op. 118 No. 2', duration: 372 }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container, auth, navigateTo } = renderApp({ api, controller });
    await signIn(user, auth);

    // The owner's practice surface: the framed panel, with the door into the
    // markings page inside the frame with the heading it belongs to.
    await navigateTo('/projects/p1');
    await waitForPlayerSettled();
    const owner = container.querySelector('.player-markers');
    expect(owner).not.toBeNull();
    expect(owner!.querySelector('.player-markers-head .player-markings-open')).not.toBeNull();
    expect(owner!.querySelector('.player-marker-row .player-marker-mark')).not.toBeNull();

    // The read-only public view is a practice surface too — the same panel,
    // worn the same way, and reached by the other route.
    await navigateTo('/gallery/p1');
    await waitForPlayerSettled();
    expect(container.querySelector('.player-markers')).not.toBeNull();
    expect(container.querySelector('.player-marker-mark')).not.toBeNull();

    // The markings page's column is the authoring one: the same panel and the
    // same rows, with the add controls in place of the door. It wears the
    // fold's frame too now — there is no hook left to keep it off — and it is
    // the authoring markup, not a missing class, that still keeps the door and
    // the boxed mark off this page.
    await navigateTo('/projects/p1/markings');
    await waitForPlayerSettled();
    const authoring = container.querySelector('.player-markers');
    expect(authoring).not.toBeNull();
    expect(authoring!.querySelector('.markings-add-controls')).not.toBeNull();
    expect(authoring!.querySelector('.player-markings-open')).toBeNull();
    expect(container.querySelector('.player-marker-mark')).toBeNull();
  });
});

describe('App — the sheet stands under every recording surface (T77, T95)', () => {
  it('grounds all three routes that render a recording, the markings page included', async () => {
    // T77 drew the ground and the band for the practice routes alone, keyed on
    // the fold's one hook (`.practice-surface`) and withheld from the markings
    // page. T95 retires that hook: `RecordingSurface` no longer renders the
    // class at all, so the ground now follows the title band every recording
    // surface draws (`:has(.player-title)`), and the markings page — which
    // hosts that same surface (T55) — stands on the sheet too. Asserted at this
    // seam because it is a fact about which *pages* carry the ground, which the
    // stylesheet pins in Player.test.tsx do not say.
    const api = fakeProjectsApi();
    api.seed(serverProject({ id: 'p1', name: 'Brahms Op. 118 No. 2', duration: 372 }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container, navigateTo } = renderApp({ api, controller, initialEntry: '/projects/p1' });
    await waitForPlayerSettled();

    // The owner's player: the band stands with no scoping class on it.
    expect(container.querySelector('.practice-surface')).toBeNull();
    expect(container.querySelector('.player-title')).not.toBeNull();

    // The read-only public view is the same player, and takes the sheet with it
    // — the second of the three routes, and the one a rule written against the
    // owner's page alone would miss.
    await navigateTo('/gallery/p1');
    expect(await screen.findByRole('heading', { name: 'Brahms Op. 118 No. 2' })).toBeInTheDocument();
    await waitForPlayerSettled();
    expect(container.querySelector('.player-title')).not.toBeNull();

    // The authoring page renders the same recording surface, and now takes the
    // ground and the band's own direction with it too — the third route, and
    // the one this fold used to except.
    await navigateTo('/projects/p1/markings');
    await waitForPlayerSettled();
    expect(container.querySelector('.player-title')).not.toBeNull();
    expect(container.querySelector('.practice-surface')).toBeNull();
  });
});

describe('App — the stave is every recording surface’s strip (T79, T98)', () => {
  it('draws the stave on every route that renders a recording, and the plain bar on none of them', async () => {
    // The strip is the shared surface's *timeline slot*: every host fills it
    // with the stave now, the markings page included (T98) — so it is a fact
    // about the shared surface rather than about which route you are on, and
    // it is asserted on all three routes for exactly that reason.
    const api = fakeProjectsApi();
    api.seed(serverProject({ id: 'p1', name: 'Brahms Op. 118 No. 2', duration: 372 }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container, navigateTo } = renderApp({ api, controller, initialEntry: '/projects/p1' });
    await waitForPlayerSettled();

    // The owner's player: the stave, with the five hairlines the drawing is
    // ruled from, and no bar left beside it.
    expect(container.querySelector('.player-stave')).not.toBeNull();
    expect(container.querySelectorAll('.player-stave-line')).toHaveLength(5);
    expect(container.querySelector('.player-timeline-bar')).toBeNull();

    // The read-only public view is the same player reached by the other route,
    // and draws the same strip — a swap made on the owner's page alone would
    // pass everything above and fail here.
    await navigateTo('/gallery/p1');
    await waitForPlayerSettled();
    expect(container.querySelectorAll('.player-stave-line')).toHaveLength(5);
    expect(container.querySelector('.player-timeline-bar')).toBeNull();

    // The authoring page renders the same recording surface and now hands it
    // the same stave (T98): the surface the marks are authored on is not
    // half-restyled under the student (ADR-0007), in either direction.
    await navigateTo('/projects/p1/markings');
    await waitForPlayerSettled();
    expect(container.querySelectorAll('.player-stave-line')).toHaveLength(5);
    expect(container.querySelector('.player-timeline-bar')).toBeNull();
  });
});
