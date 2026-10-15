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

/** The navbar's sign-in control — the landing's own button is a second, distinct one. */
function navSignIn(): HTMLElement {
  return within(screen.getByRole('navigation')).getByRole('button', {
    name: 'Sign in with Google',
  });
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
  await screen.findByText('Signed in as Ava Cellist');
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
 * Help while it is still in flight — the shared "create lands behind a
 * navigation" setup (T45, T46). Returns the release, which drains the create's
 * continuation (title → server create → token check → list refresh) inside
 * act, so the tests assert only the aftermath.
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
  const { auth } = renderApp({
    api,
    controller,
    fetchTitle: async () => {
      await pendingTitle;
      return VIDEO_TITLE;
    },
  });
  await signIn(user, auth);
  await pasteLink(user, YOUTUBE_CANONICAL);
  // The title lookup is still in flight; the user navigates away to Help.
  await user.click(screen.getByRole('link', { name: 'Help' }));
  expect(screen.getByRole('heading', { name: 'Help' })).toBeInTheDocument();
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
    expect(screen.getByRole('link', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Help' })).toBeInTheDocument();
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

    // The navbar's Projects link is the way home now — the player carries no
    // nav of its own (T45).
    await user.click(screen.getByRole('link', { name: 'Projects' }));

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

  it('navigates between the workspace pages, and the navbar marks the active page', async () => {
    const user = userEvent.setup();
    const { auth } = renderApp();
    await signIn(user, auth);

    await user.click(screen.getByRole('link', { name: 'Help' }));
    expect(screen.getByRole('heading', { name: 'Help' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Help' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Projects' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Gallery' })).not.toHaveAttribute('aria-current');

    await user.click(screen.getByRole('link', { name: 'Projects' }));
    expect(screen.getByRole('heading', { name: 'No projects yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Help' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Gallery' })).not.toHaveAttribute('aria-current');

    // The front-door link jumps to the public gallery.
    await user.click(screen.getByRole('link', { name: 'Gallery' }));
    expect(await screen.findByText('No public projects yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Gallery' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Projects' })).not.toHaveAttribute('aria-current');
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
    await user.click(screen.getByRole('link', { name: 'Help' }));
    await act(async () => {
      releaseRead();
    });

    // The player must not yank the user off the page they navigated to. The
    // page read is cancelled by the unmount, so the session never builds and
    // the controller is never created in the first place — nothing leaks.
    expect(screen.getByRole('heading', { name: 'Help' })).toBeInTheDocument();
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

  it('signs in with Google and shows the user in the header', async () => {
    const user = userEvent.setup();
    const { auth } = renderApp();

    await user.click(navSignIn());

    expect(auth.signInWithGoogle).toHaveBeenCalledOnce();
    // The redirect round-trip lands the session through the backend's events.
    act(() => auth.setUser({ id: 'u1', name: 'Ava Cellist', email: 'ava@example.com' }));

    expect(await screen.findByText('Signed in as Ava Cellist')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    // The sign-in prompt is gone once the user is signed in.
    expect(screen.queryByRole('button', { name: 'Sign in with Google' })).not.toBeInTheDocument();
  });

  it('signing out returns to the anonymous landing', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(serverProject());
    const { auth } = renderApp({ api });
    await signIn(user, auth);
    await screen.findByText('Brahms Op. 118 No. 2');

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

    await user.click(navSignIn());
    act(() => auth.setUser({ id: 'u1', name: 'Ava Cellist', email: 'ava@example.com' }));
    await screen.findByText('Signed in as Ava Cellist');

    auth.failNextSignOut();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/signed out on this device/i);
    expect(await screen.findByRole('heading', { name: /Mark your rehearsal/ })).toBeInTheDocument();
    expect(navSignIn()).toBeInTheDocument();
  });

  it('a signed-in user can delete their account, confirming the one-way door first', async () => {
    const user = userEvent.setup();
    const { auth } = renderApp();

    await user.click(navSignIn());
    act(() => auth.setUser({ id: 'u1', name: 'Ava Cellist', email: 'ava@example.com' }));
    await screen.findByText('Signed in as Ava Cellist');

    // The destructive action hides behind an explicit confirmation that
    // says what the account deletion removes — it never fires by accident.
    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    expect(screen.getByText(/every project you've created/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete forever' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete forever' }));

    expect(auth.deleteAccount).toHaveBeenCalledOnce();
    // The deletion lands anonymous: the sign-in prompt is back.
    expect(await screen.findByRole('heading', { name: /Mark your rehearsal/ })).toBeInTheDocument();
    expect(navSignIn()).toBeInTheDocument();
  });

  it('cancelling the confirmation leaves the user signed in and does not delete', async () => {
    const user = userEvent.setup();
    const { auth } = renderApp();

    await user.click(navSignIn());
    act(() => auth.setUser({ id: 'u1', name: 'Ava Cellist', email: 'ava@example.com' }));
    await screen.findByText('Signed in as Ava Cellist');

    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(auth.deleteAccount).not.toHaveBeenCalled();
    expect(screen.getByText('Signed in as Ava Cellist')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete forever' })).not.toBeInTheDocument();
  });

  it('a failed account deletion keeps the user signed in with an honest notice', async () => {
    const user = userEvent.setup();
    const { auth } = renderApp();

    await user.click(navSignIn());
    act(() => auth.setUser({ id: 'u1', name: 'Ava Cellist', email: 'ava@example.com' }));
    await screen.findByText('Signed in as Ava Cellist');

    auth.failNextAccountDelete();
    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    await user.click(screen.getByRole('button', { name: 'Delete forever' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/didn't work/i);
    // Nothing was deleted: the user is still signed in and the confirmation
    // stays, so they can see the reason and retry or cancel.
    expect(screen.getByText('Signed in as Ava Cellist')).toBeInTheDocument();
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

    await user.click(screen.getByRole('link', { name: 'Help' }));
    expect(screen.getByRole('heading', { name: 'Help' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Projects' }));

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
    expect(screen.getByRole('link', { name: 'Gallery' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Help' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No projects yet' })).toBeInTheDocument();
  });

  it('renders the Help page at /help with the same persistent navbar', async () => {
    const user = userEvent.setup();
    const { auth } = renderApp();
    await signIn(user, auth);

    await user.click(screen.getByRole('link', { name: 'Help' }));
    expect(screen.getByRole('heading', { name: 'Help' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Rehearsal Marks' })).toBeInTheDocument();
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

    await user.click(screen.getByRole('link', { name: 'Help' }));
    expect(screen.getByRole('heading', { name: 'Help' })).toBeInTheDocument();

    await go(-1);
    expect(screen.getByRole('heading', { name: 'No projects yet' })).toBeInTheDocument();

    await go(1);
    expect(screen.getByRole('heading', { name: 'Help' })).toBeInTheDocument();
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

  it('renders the public gallery at the front door /, grouped by recording', async () => {
    const api = fakeProjectsApi();
    api.seed(galleryProject());
    renderApp({ api, initialEntry: '/' });

    expect(await screen.findByRole('heading', { name: /Manfred Honeck/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Honeck Tchaikovsky 5/ })).toBeInTheDocument();
    expect(screen.getByText('21 markers')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Gallery' })).toHaveAttribute('aria-current', 'page');
  });

  it('opens a gallery entry as the read-only view at /gallery/:id', async () => {
    const user = userEvent.setup();
    const api = fakeProjectsApi();
    api.seed(galleryProject());
    const { currentPath } = renderApp({ api, initialEntry: '/' });

    await user.click(await screen.findByRole('button', { name: /Honeck Tchaikovsky 5/ }));
    await waitFor(() => expect(currentPath()).toBe('/gallery/project-1'));

    // The read-only surface never offers an edit affordance.
    expect(screen.queryByRole('button', { name: 'Add marker' })).not.toBeInTheDocument();
  });

  it('the navbar Gallery link moves between the workspace and the gallery', async () => {
    const user = userEvent.setup();
    const { auth } = renderApp();
    await signIn(user, auth);

    // The signed-in home is the workspace; the Gallery link crosses to the front door.
    expect(screen.getByRole('heading', { name: 'No projects yet' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Gallery' }));
    expect(await screen.findByText('No public projects yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Gallery' })).toHaveAttribute('aria-current', 'page');
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
    // The player is shell chrome under the persistent navbar — the app name,
    // the page links, and the sign-in all frame it.
    expect(screen.getByRole('heading', { name: 'Rehearsal Marks' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Help' })).toBeInTheDocument();
    expect(container.querySelector('.player-ruler')).toBeInTheDocument();
    await waitForPlayerSettled();
    // A visit writes nothing — the server row is exactly what was read.
    expect(api.get('p1')).toEqual(expect.objectContaining({ markers: project.markers }));
  });

  it('the navbar heads the page with that page’s own rail — wide or narrow', async () => {
    // The defect this closes (T74): the page took the wide rail on a player
    // route and the navbar did not, so on a wide window the frame was narrower
    // than the content it headed, and on a short one it was wider. The two are
    // one shared rail, so the agreement is asserted as one thing — whatever
    // rail the page takes, the navbar takes — across every kind of route the
    // shell serves, the player routes' own not-found arm included: a rail
    // follows the route pattern, not the surface's luck. This test is also
    // where the page's own rail is pinned, and it is the only one that pins
    // the navbar's.
    const api = fakeProjectsApi();
    api.seed(serverProject({ id: 'p1', name: 'Brahms Op. 118 No. 2', duration: 372 }));
    const controller = mockController({ load: vi.fn(async () => ({ duration: 372 })) });
    const { container, navigateTo } = renderApp({ api, controller, initialEntry: '/projects/p1' });
    await waitForPlayerSettled();

    // The rail classes as the DOM actually carries them, rather than a restated
    // expectation: a rule that named the classes again could pass while the two
    // elements disagreed on them. Sorted, because the class attribute's order
    // is not a thing the page and the navbar are agreeing about — only which
    // rail they take is.
    const railOf = (selector: string): string[] =>
      [...container.querySelector(selector)!.classList]
        .filter((name) => name.startsWith('page-rail'))
        .sort();

    // The owner's player: the wide rail runs the navbar's full width too.
    expect(railOf('.app-nav-inner')).toEqual(['page-rail', 'page-rail-wide']);
    expect(railOf('.app-nav-inner')).toEqual(railOf('.app-page'));

    // The text pages keep the reading measure the rail was built for, above
    // and below the frame alike.
    await navigateTo('/help');
    expect(await screen.findByRole('heading', { name: 'Help' })).toBeInTheDocument();
    expect(railOf('.app-nav-inner')).toEqual(['page-rail']);
    expect(railOf('.app-nav-inner')).toEqual(railOf('.app-page'));

    // The read-only public view is a player too, and widens with it.
    await navigateTo('/gallery/p1');
    expect(await screen.findByRole('heading', { name: 'Brahms Op. 118 No. 2' })).toBeInTheDocument();
    await waitForPlayerSettled();
    expect(railOf('.app-nav-inner')).toEqual(['page-rail', 'page-rail-wide']);
    expect(railOf('.app-nav-inner')).toEqual(railOf('.app-page'));

    // The markings page is the third player route — it widens the same way.
    await navigateTo('/projects/p1/markings');
    await waitForPlayerSettled();
    expect(railOf('.app-nav-inner')).toEqual(['page-rail', 'page-rail-wide']);
    expect(railOf('.app-nav-inner')).toEqual(railOf('.app-page'));

    // And a player route that names no row: the URL is still a player route,
    // so the dead-URL surface is as wide as the page it heads.
    await navigateTo('/projects/no-such-project');
    expect(
      await screen.findByRole('heading', { name: 'This project could not be found' }),
    ).toBeInTheDocument();
    expect(railOf('.app-nav-inner')).toEqual(['page-rail', 'page-rail-wide']);
    expect(railOf('.app-nav-inner')).toEqual(railOf('.app-page'));
  });

  it('lets nothing in the navbar’s own stylesheet cap the rail it is handed', () => {
    // jsdom computes no layout, so this is a stylesheet-source fact, pinned the
    // way the rail's own definitions are (Player.test.tsx). The navbar's inner
    // element takes its width from the class the shell hands it; a max-width
    // declared here — or any rule more specific than .page-rail-wide, which a
    // `.app-nav .app-nav-inner` selector would be — silently beats the wide
    // rail while the test above still sees the right class names on both.
    expect(navbarCss).not.toMatch(/\.app-nav-inner[^{]*\{[^}]*\b(?:max-)?width\s*:/);
  });

  it('widens the read-only public view too — it is the same player', async () => {
    const api = fakeProjectsApi();
    api.seed(serverProject({ id: 'p1', name: 'Brahms Op. 118 No. 2' }));
    const { container } = renderApp({ api, initialEntry: '/gallery/p1' });

    expect(await screen.findByRole('heading', { name: 'Brahms Op. 118 No. 2' })).toBeInTheDocument();
    expect(container.querySelector('.page-rail-wide.app-page')).toBeInTheDocument();
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

    // The project is saved and waiting in the list; the user stays on Help.
    expect(screen.getByRole('heading', { name: 'Help' })).toBeInTheDocument();
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
    expect(screen.getByRole('link', { name: 'Projects' })).toBeInTheDocument();
    // The load settles before the test finishes, so the page's autosave is not
    // left pending across the teardown.
    await waitForPlayerSettled();
  });

  it('a create that lands behind a navigation is waiting in the list when the user returns', async () => {
    const { api, release } = await createBehindNavigation();
    await release();

    // Not yanked: the user is still where they chose to go.
    expect(screen.getByRole('heading', { name: 'Help' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: VIDEO_TITLE })).not.toBeInTheDocument();

    // Their own return to Projects finds the saved project in the list.
    const user = userEvent.setup();
    await user.click(screen.getByRole('link', { name: 'Projects' }));
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

describe('App — the panel wears the direction on the practice surfaces only (T78)', () => {
  it('frames the panel on the player and the public view, and not on the markings page', async () => {
    // The panel is one component on two surfaces, and the fold's one hook is
    // the distinction it already takes: a surface that passes `authoring` gets
    // the authoring panel, a practice surface gets the direction's. This is
    // where the two readings are compared on the same project, in the DOM the
    // app actually renders — the route each surface is reached by, the class on
    // the panel's root, the boxed mark, and the head each one carries.
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
    const owner = container.querySelector('.player-markers-practice');
    expect(owner).not.toBeNull();
    expect(owner!.querySelector('.player-markers-head .player-markings-open')).not.toBeNull();
    expect(owner!.querySelector('.player-marker-row .player-marker-mark')).not.toBeNull();

    // The read-only public view is a practice surface too — the same panel,
    // worn the same way.
    await navigateTo('/gallery/p1');
    await waitForPlayerSettled();
    expect(container.querySelector('.player-markers-practice')).not.toBeNull();
    expect(container.querySelector('.player-marker-mark')).not.toBeNull();

    // The markings page's column is the authoring one: the same panel and the
    // same rows, with the add controls in place of the door — and neither the
    // frame nor the box, which is the whole of what this ticket did to it.
    await navigateTo('/projects/p1/markings');
    await waitForPlayerSettled();
    const authoring = container.querySelector('.player-markers');
    expect(authoring).not.toBeNull();
    expect(authoring).not.toHaveClass('player-markers-practice');
    expect(authoring!.querySelector('.markings-add-controls')).not.toBeNull();
    expect(authoring!.querySelector('.player-markings-open')).toBeNull();
    expect(container.querySelector('.player-marker-mark')).toBeNull();
  });
});
