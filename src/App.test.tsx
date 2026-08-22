import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { labelSetRow } from './test/commons-fixture';
import { createStorage, StorageError } from './storage';
import type { ProjectRecord, Storage } from './storage';
import { createAuthController } from './auth';
import { mockAuth } from './test/auth-fixture';
import { mockCommonsWrite } from './test/commons-write-fixture';
import { mockController } from './test/controller-fixture';
import { youtubeLoad } from './test/load-fixture';
import { projectRecord } from './test/project-fixture';
import { closeTestStorages, testStorage } from './test/storage-fixture';
import type { CommunityLabelSet } from './youtube/community';
import App from './App';

/** Renders the app on a fresh fake-indexeddb database with a mocked seam. */
async function renderApp(
  controller = mockController(),
  storage?: Storage,
  fetchTitle: (canonicalUrl: string) => Promise<string | null> = async () => VIDEO_TITLE,
  loadCommunityLabels: (videoId: string) => Promise<CommunityLabelSet | null> = async () => null,
  commons = mockCommonsWrite(),
) {
  const opened = storage ?? (await testStorage());
  const auth = mockAuth();
  const view = render(
    <App
      controllerFactory={() => controller}
      storage={opened}
      // Stubbed by default so no test reaches YouTube's oEmbed endpoint or
      // the community index, and no test constructs a supabase-js client.
      fetchTitle={fetchTitle}
      loadCommunityLabels={loadCommunityLabels}
      authFactory={() => auth.controller}
      commonsWriteFactory={() => commons.controller}
    />,
  );
  return { ...view, storage: opened, controller, auth: auth.backend, commons: commons.backend };
}

const VIDEO_ID = 'dQw4w9WgXcQ';
const YOUTUBE_CANONICAL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
const VIDEO_TITLE = 'Brahms — Intermezzo Op. 118 No. 2';

/** The minimal fetch surface App.tsx consumes. */
function jsonResponse(body: string) {
  return { ok: true, text: async () => body, blob: async () => new Blob([body]) };
}

afterEach(async () => {
  await closeTestStorages();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** Types a link into the create surface's link input and submits it. */
async function pasteLink(user: ReturnType<typeof userEvent.setup>, url: string) {
  await user.type(screen.getByLabelText(/paste a YouTube link/i), url);
  await user.click(screen.getByRole('button', { name: /create from link/i }));
}

describe('App create from a YouTube link', () => {
  it('opens a freshly pasted link in Label mode, with the marking tools in reach', async () => {
    // End to end, the behaviour the stamped mode and the player's fallback
    // have to agree on: a project with an empty timeline must not open
    // read-only, or there is no visible way to place the first mark.
    const user = userEvent.setup();
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 372 })),
    });
    const { storage } = await renderApp(controller);

    await pasteLink(user, YOUTUBE_CANONICAL);

    await screen.findByRole('heading', { name: VIDEO_TITLE });
    expect(screen.getByRole('button', { name: 'Label' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Add marker' })).toBeInTheDocument();

    const [summary] = await storage.projects.list();
    expect((await storage.projects.get(summary.id))!.playerMode).toBe('label');
  });

  it('copies a loaded community label set in and opens in Playback mode', async () => {
    // The labeled-performance story: a video someone already marked loads its
    // label set at creation, so the project is immediately practiceable — the
    // marks render, the posture is Playback, and no editing tools show.
    const user = userEvent.setup();
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 604.2 })),
    });
    const community: CommunityLabelSet = {
      markers: [{ id: 'm1', time: 10, aliases: ['Recap'], createdAt: 1 }],
      duration: 604.2,
    };
    const { storage } = await renderApp(
      controller,
      undefined,
      async () => VIDEO_TITLE,
      async () => community,
    );

    await pasteLink(user, YOUTUBE_CANONICAL);

    await screen.findByRole('heading', { name: VIDEO_TITLE });
    expect(screen.getByRole('button', { name: 'Playback' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByRole('button', { name: 'Add marker' })).not.toBeInTheDocument();
    // The copied marks render as flags — the first label in time order.
    expect(await screen.findByRole('button', { name: 'A' })).toBeInTheDocument();

    const [summary] = await storage.projects.list();
    const stored = (await storage.projects.get(summary.id))!;
    expect(stored.markers).toEqual(community.markers);
    expect(stored.playerMode).toBe('playback');
    expect(stored.duration).toBe(604.2);
  });

  it('consults the hosted Commons by default and copies a published set in', async () => {
    // The real transport, end to end: a wired app (Vite env set) queries the
    // Commons at creation, and a published set for the video becomes the
    // project's own editable copy, opening in Playback mode. No loadCommunityLabels
    // prop is passed — this is the app's default wiring.
    vi.stubEnv('VITE_SUPABASE_URL', 'https://abccompany.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key-1');
    const row = labelSetRow({ title: VIDEO_TITLE });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/rest/v1/label_sets')) {
        return jsonResponse(JSON.stringify([row]));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 604.2 })),
    });
    const opened = await testStorage();
    render(
      <App
        controllerFactory={() => controller}
        storage={opened}
        fetchTitle={async () => VIDEO_TITLE}
      />,
    );

    await pasteLink(user, YOUTUBE_CANONICAL);

    await screen.findByRole('heading', { name: VIDEO_TITLE });
    expect(screen.getByRole('button', { name: 'Playback' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(await screen.findByRole('button', { name: 'A' })).toBeInTheDocument();
    // The one query was the anonymous published read, keyed on the video ID.
    const [requested] = fetchMock.mock.calls[0] as [string];
    expect(requested).toContain(`video_id=eq.${VIDEO_ID}`);
    expect(requested).toContain('publication_status=eq.published');
    const [summary] = await opened.projects.list();
    const stored = (await opened.projects.get(summary.id))!;
    expect(stored.markers).toEqual(row.markers);
    expect(stored.playerMode).toBe('playback');
  });

  it('reads a missing Commons config as no labels, without touching the network', async () => {
    // The default transport is inert without Vite env — a dev build or a
    // test run never queries anything, and a link create lands in the
    // unmatched path with the empty state explained. Stub the vars empty so
    // a local .env.local cannot wire the transport in: this test is about
    // the unconfigured app, whatever the machine carries.
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    const fetchMock = vi.fn(async () => {
      throw new Error('unexpected fetch');
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 372 })),
    });
    const opened = await testStorage();
    render(
      <App
        controllerFactory={() => controller}
        storage={opened}
        fetchTitle={async () => VIDEO_TITLE}
      />,
    );

    await pasteLink(user, YOUTUBE_CANONICAL);

    await screen.findByRole('heading', { name: VIDEO_TITLE });
    expect(screen.getByRole('button', { name: 'Label' })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByText(/no community labels loaded/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    const [summary] = await opened.projects.list();
    expect((await opened.projects.get(summary.id))!.markers).toEqual([]);
  });

  it('lands in the same player session an upload does', async () => {
    const user = userEvent.setup();
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 372 })),
    });
    const { storage } = await renderApp(controller);

    await pasteLink(user, YOUTUBE_CANONICAL);

    // The player, named after the video, with the transport an upload gets.
    expect(await screen.findByRole('heading', { name: VIDEO_TITLE })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled();
    expect(screen.getByLabelText('Volume')).toBeInTheDocument();
    expect(await screen.findByText(/Playing from YouTube/)).toBeInTheDocument();

    // A YouTube record stores no audio bytes — the URL is the whole input.
    const [stored] = await storage.projects.list();
    expect(stored.name).toBe(VIDEO_TITLE);
    expect((await storage.projects.get(stored.id))!.videoId).toBe(VIDEO_ID);
  });

  it('records the video ID as identity whatever form was pasted', async () => {
    const user = userEvent.setup();
    const { storage } = await renderApp();

    await pasteLink(user, `https://youtu.be/${VIDEO_ID}?t=42`);

    await screen.findByRole('heading', { name: VIDEO_TITLE });
    const [stored] = await storage.projects.list();
    expect((await storage.projects.get(stored.id))!.videoId).toBe(VIDEO_ID);
  });

  it.each([
    ['a playlist', 'https://www.youtube.com/playlist?list=PLabcdef', /playlist/i],
    ['a malformed link', 'https://example.com/not-a-video', /YouTube video link/],
  ])('rejects %s with guidance and stores nothing', async (_case, url, expected) => {
    const user = userEvent.setup();
    const { storage } = await renderApp();

    await pasteLink(user, url);

    expect(await screen.findByRole('alert')).toHaveTextContent(expected);
    // Still on the workspace — a rejection never opens a player.
    expect(screen.getByRole('heading', { name: 'Rehearsal Marks' })).toBeInTheDocument();
    expect(await storage.projects.list()).toEqual([]);
  });

  it('still creates the project when the title cannot be read', async () => {
    const user = userEvent.setup();
    const { storage } = await renderApp(mockController(), undefined, async () => null);

    await pasteLink(user, YOUTUBE_CANONICAL);

    // Offline, or a video whose title is not public: the project is still the
    // user's to keep, named by something they can recognize and rename.
    expect(await screen.findByRole('heading', { name: `YouTube video ${VIDEO_ID}` })).toBeInTheDocument();
    expect(await storage.projects.list()).toHaveLength(1);
  });

  it('surfaces a full-storage failure on the link input', async () => {
    const user = userEvent.setup();
    const storage = await testStorage();
    const fullStorage: Storage = {
      ...storage,
      projects: {
        ...storage.projects,
        save: async () => {
          throw new StorageError('Browser storage is full.', 'storage-full');
        },
      },
    };
    await renderApp(mockController(), fullStorage);

    await pasteLink(user, YOUTUBE_CANONICAL);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/storage is full/i);
    // The guidance belongs to the field that produced it: the link input is
    // marked invalid.
    expect(screen.getByLabelText(/paste a YouTube link/i)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('heading', { name: 'Rehearsal Marks' })).toBeInTheDocument();
  });

  it('reopens a stored YouTube project', async () => {
    const user = userEvent.setup();
    const storage = await testStorage();
    await storage.projects.save(
      projectRecord({ name: 'Brahms on YouTube', videoId: VIDEO_ID, duration: 372 }),
    );
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 372 })),
    });
    const { container } = await renderApp(controller, storage);

    await user.click(await screen.findByRole('button', { name: /Brahms on YouTube/ }));

    await screen.findByRole('heading', { name: 'Brahms on YouTube' });
    // Reopening is the other way into a YouTube session: the same arm of the
    // seam, loading the stored URL — there is no blob on this path.
    expect(youtubeLoad(vi.mocked(controller.load).mock.calls[0][0]).url).toBe(YOUTUBE_CANONICAL);
    expect(container.querySelector('.player-ruler')).toBeInTheDocument();
  });

  it('offers the YouTube link input on the create surface, and no file picker', async () => {
    await renderApp();

    const surface = await screen.findByRole('region', { name: 'Create project' });
    expect(surface).toContainElement(screen.getByRole('button', { name: /create from link/i }));
    expect(surface).toContainElement(screen.getByLabelText(/paste a YouTube link/i));
    expect(screen.queryByRole('button', { name: 'Create project' })).not.toBeInTheDocument();
  });
});

describe('App Projects workspace', () => {
  it('lists stored projects with name, duration, marker count, and last-modified on start', async () => {
    const storage = await testStorage();
    await storage.projects.save(projectRecord());
    await renderApp(mockController(), storage);

    expect(await screen.findByText('Brahms Op. 118 No. 2')).toBeInTheDocument();
    // The row's meta: duration · marker count · last-modified. The fixture's
    // updatedAt is more than eight weeks old — the date fallback.
    expect(screen.getByText(/2:03\.456 · 2 markers · 2023-11-14/)).toBeInTheDocument();
    // Byte size left the record shape, and the total line with it.
    expect(screen.queryByText(/Total used/)).not.toBeInTheDocument();
  });

  it('shows the empty state pointing at pasting a YouTube link, and no library surface', async () => {
    const { storage } = await renderApp();

    expect(screen.getByRole('heading', { name: 'No projects yet' })).toBeInTheDocument();
    expect(screen.getByText(/paste a YouTube link above to start marking/i)).toBeInTheDocument();
    // The Library tab and its browse surface are gone — the link is the only way in.
    expect(screen.getByRole('tab', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Help' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Library' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /browse the library/i })).not.toBeInTheDocument();

    storage.close();
  });

  it('reopens a project and plays it from its canonical URL, markers intact', async () => {
    const user = userEvent.setup();
    const storage = await testStorage();
    const record = projectRecord();
    await storage.projects.save(record);
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 123.456 })),
    });
    await renderApp(controller, storage);

    await user.click(await screen.findByRole('button', { name: /Brahms/ }));

    // The player opened on the stored record: no decode (there is no audio),
    // the load is the YouTube arm's canonical URL, and the stored markers
    // come with the record.
    expect(await screen.findByRole('heading', { name: 'Brahms Op. 118 No. 2' })).toBeInTheDocument();
    const loadOptions = youtubeLoad(vi.mocked(controller.load).mock.calls[0][0]);
    expect(loadOptions.url).toBe(`https://www.youtube.com/watch?v=${record.videoId}`);
    expect(await storage.projects.get(record.id)).toEqual(
      expect.objectContaining({ markers: record.markers }),
    );
  });

  it('returns to the workspace from the player and lists the new project', async () => {
    const user = userEvent.setup();
    const { storage } = await renderApp();

    await pasteLink(user, YOUTUBE_CANONICAL);
    await screen.findByRole('heading', { name: VIDEO_TITLE });

    await user.click(screen.getByRole('button', { name: 'Projects' }));

    // The tablist only renders in the workspace, so waiting for it guarantees
    // the player (and its same-named heading) is gone before asserting on the
    // list row — otherwise the title query can land on a node about to detach.
    await screen.findByRole('tablist');
    expect(screen.getByRole('listitem')).toHaveTextContent(VIDEO_TITLE);
    expect(await storage.projects.list()).toHaveLength(1);
  });

  it('renames inline, persists, and moves the renamed project to the top', async () => {
    const user = userEvent.setup();
    const storage = await testStorage();
    await storage.projects.save(projectRecord({ id: 'older', name: 'Older', updatedAt: 1_000 }));
    await storage.projects.save(projectRecord({ id: 'newer', name: 'Newer', updatedAt: 2_000 }));
    await renderApp(mockController(), storage);
    await screen.findByText('Newer');

    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]).getByText('Newer')).toBeInTheDocument();

    await user.click(within(rows[1]).getByRole('button', { name: 'Rename' }));
    const input = screen.getByRole('textbox', { name: 'Project name' });
    await user.clear(input);
    await user.type(input, 'Brahms 2{enter}');

    await screen.findByText('Brahms 2');
    const stored = await storage.projects.get('older');
    expect(stored!.name).toBe('Brahms 2');
    expect(stored!.updatedAt).toBeGreaterThan(2_000);
    // The rename re-stamps updatedAt, so the renamed row is now newest.
    const reordered = screen.getAllByRole('listitem');
    expect(within(reordered[0]).getByText('Brahms 2')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });

  it('deletes after confirmation and empties the workspace', async () => {
    const user = userEvent.setup();
    const storage = await testStorage();
    await storage.projects.save(projectRecord());
    await renderApp(mockController(), storage);
    await screen.findByText('Brahms Op. 118 No. 2');

    const row = screen.getByRole('listitem');
    await user.click(within(row).getByRole('button', { name: 'Delete' }));
    expect(
      screen.getByText('Delete “Brahms Op. 118 No. 2”? This cannot be undone.'),
    ).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByRole('heading', { name: 'No projects yet' })).toBeInTheDocument();
    expect(await storage.projects.list()).toEqual([]);
  });

  it('shows the storage-full state when a rename hits a full store', async () => {
    const user = userEvent.setup();
    const storage = await testStorage();
    await storage.projects.save(projectRecord());
    const fullStorage: Storage = {
      ...storage,
      projects: {
        ...storage.projects,
        save: async () => {
          throw new StorageError('Browser storage is full.', 'storage-full');
        },
      },
    };
    await renderApp(mockController(), fullStorage);
    await screen.findByText('Brahms Op. 118 No. 2');

    const row = screen.getByRole('listitem');
    await user.click(within(row).getByRole('button', { name: 'Rename' }));
    const input = screen.getByRole('textbox', { name: 'Project name' });
    await user.clear(input);
    await user.type(input, 'New Name{enter}');

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Storage full — free up space to keep saving.',
    );
  });

  it('persists projects across a page reload', async () => {
    const name = `reload-${crypto.randomUUID()}`;
    const first = await createStorage({ name });
    await first.projects.save(projectRecord());
    first.close();

    // A reload: a fresh App opens a fresh connection to the same database.
    const reopened = await createStorage({ name });
    await renderApp(mockController(), reopened);
    expect(await screen.findByText('Brahms Op. 118 No. 2')).toBeInTheDocument();
    reopened.close();
  });

  it('switches between the workspace tabs', async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(screen.getByRole('tab', { name: 'Help' }));
    expect(screen.getByRole('heading', { name: 'Help' })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Projects' }));
    expect(screen.getByRole('heading', { name: 'No projects yet' })).toBeInTheDocument();
  });

  it('drops an in-flight open when the user switches tabs', async () => {
    const user = userEvent.setup();
    const storage = await testStorage();
    await storage.projects.save(projectRecord());
    let releaseRead!: () => void;
    const pendingGet = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 123.456 })),
    });
    const slowStorage: Storage = {
      ...storage,
      projects: {
        ...storage.projects,
        get: async (id) => {
          await pendingGet;
          return storage.projects.get(id);
        },
      },
    };
    await renderApp(controller, slowStorage);
    await screen.findByText('Brahms Op. 118 No. 2');

    await user.click(screen.getByRole('button', { name: /Brahms/ }));
    await user.click(screen.getByRole('tab', { name: 'Help' }));
    await act(async () => {
      releaseRead();
    });

    // The player must not yank the user off the tab they navigated to. The
    // session never commits, so the controller it would have owned is never
    // created in the first place — nothing leaks.
    expect(screen.getByRole('heading', { name: 'Help' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Brahms Op. 118 No. 2' })).not.toBeInTheDocument();
  });

  it('surfaces a failed final save on exit instead of claiming Saved', async () => {
    const user = userEvent.setup();
    const storage = await testStorage();
    let saves = 0;
    // The create's first save succeeds; every later save hits a full store.
    const flaky: Storage = {
      ...storage,
      projects: {
        ...storage.projects,
        save: async (record) => {
          saves += 1;
          if (saves > 1) throw new StorageError('Browser storage is full.', 'storage-full');
          await storage.projects.save(record);
        },
      },
    };
    const controller = mockController({
      // A different duration guarantees the player schedules a write.
      load: vi.fn(async () => ({ duration: 42 })),
    });
    await renderApp(controller, flaky);
    await pasteLink(user, YOUTUBE_CANONICAL);
    await screen.findByRole('heading', { name: VIDEO_TITLE });
    // Wait for the debounced write to fail inside the player first.
    await screen.findByText('Storage full — free up space to keep saving.');

    await user.click(screen.getByRole('button', { name: 'Projects' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Storage full — free up space to keep saving.',
    );
  });

  it('reports a failed delete as its own notice, not as a save error', async () => {
    const user = userEvent.setup();
    const storage = await testStorage();
    await storage.projects.save(projectRecord());
    const broken: Storage = {
      ...storage,
      projects: {
        ...storage.projects,
        remove: async () => {
          throw new Error('IndexedDB unavailable');
        },
      },
    };
    await renderApp(mockController(), broken);
    await screen.findByText('Brahms Op. 118 No. 2');

    const row = screen.getByRole('listitem');
    await user.click(within(row).getByRole('button', { name: 'Delete' }));
    await user.click(within(row).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong deleting the project.',
    );
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    expect(await storage.projects.list()).toHaveLength(1);
  });
});

describe('App contributor sign-in', () => {
  it('shows Sign in with Google to an anonymous visitor, who can use the whole app', async () => {
    const { storage } = await renderApp();
    const user = userEvent.setup();

    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument();

    // No account, no prompt: an anonymous visitor creates and gets a project.
    await pasteLink(user, YOUTUBE_CANONICAL);
    expect(await screen.findByRole('heading', { name: VIDEO_TITLE })).toBeInTheDocument();
    expect(await storage.projects.list()).toHaveLength(1);
  });

  it('signs in with Google and shows the contributor in the header', async () => {
    const { auth } = await renderApp();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Sign in with Google' }));

    expect(auth.signInWithGoogle).toHaveBeenCalledOnce();
    // The redirect round-trip lands the session through the backend's events.
    act(() => auth.setContributor({ id: 'c1', name: 'Ava Cellist', email: 'ava@example.com' }));

    expect(await screen.findByText('Signed in as Ava Cellist')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    // The sign-in prompt is gone once the contributor is signed in.
    expect(screen.queryByRole('button', { name: 'Sign in with Google' })).not.toBeInTheDocument();
  });

  it('signing out returns to anonymous browsing and leaves local projects untouched', async () => {
    const { storage, auth } = await renderApp();
    const user = userEvent.setup();

    await pasteLink(user, YOUTUBE_CANONICAL);
    await screen.findByRole('heading', { name: VIDEO_TITLE });
    // Back to the workspace with the saved project.
    await user.click(screen.getByRole('button', { name: 'Projects' }));
    await screen.findByText(VIDEO_TITLE);

    await user.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    act(() => auth.setContributor({ id: 'c1', name: 'Ava Cellist', email: 'ava@example.com' }));
    await screen.findByText('Signed in as Ava Cellist');
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    // Anonymous again, and the workspace row is exactly what it was before.
    expect(await screen.findByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument();
    const projects = await storage.projects.list();
    expect(projects.map((p) => p.name)).toEqual([VIDEO_TITLE]);
  });

  it('degrades a failed sign-in to anonymous browsing with a notice', async () => {
    const { auth } = await renderApp();
    const user = userEvent.setup();

    auth.failNextSignIn();
    await user.click(screen.getByRole('button', { name: 'Sign in with Google' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/didn't work/i);
    // The app never blocked on the failure: the workspace is still live.
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Workspace' })).toBeInTheDocument();
  });

  it('a failed sign-out lands anonymous with a partial-sign-out notice — the session was removed', async () => {
    // supabase-js removes the local session (firing SIGNED_OUT) before the
    // API error surfaces, so the honest state is anonymous plus the notice
    // that the server side was not reached.
    const { auth } = await renderApp();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    act(() => auth.setContributor({ id: 'c1', name: 'Ava Cellist', email: 'ava@example.com' }));
    await screen.findByText('Signed in as Ava Cellist');

    auth.failNextSignOut();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/signed out on this device/i);
    expect(await screen.findByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument();
  });

  it('a signed-in contributor can delete their account, confirming the one-way door first', async () => {
    const { auth } = await renderApp();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    act(() => auth.setContributor({ id: 'c1', name: 'Ava Cellist', email: 'ava@example.com' }));
    await screen.findByText('Signed in as Ava Cellist');

    // The destructive action hides behind an explicit confirmation that
    // says what the account deletion removes — it never fires by accident.
    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    expect(screen.getByText(/every label set you've contributed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete forever' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete forever' }));

    expect(auth.deleteAccount).toHaveBeenCalledOnce();
    // The deletion lands anonymous: the sign-in prompt is back.
    expect(await screen.findByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument();
  });

  it('cancelling the confirmation leaves the contributor signed in and does not delete', async () => {
    const { auth } = await renderApp();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    act(() => auth.setContributor({ id: 'c1', name: 'Ava Cellist', email: 'ava@example.com' }));
    await screen.findByText('Signed in as Ava Cellist');

    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(auth.deleteAccount).not.toHaveBeenCalled();
    expect(screen.getByText('Signed in as Ava Cellist')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete forever' })).not.toBeInTheDocument();
  });

  it('a failed account deletion keeps the contributor signed in with an honest notice', async () => {
    const { auth } = await renderApp();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    act(() => auth.setContributor({ id: 'c1', name: 'Ava Cellist', email: 'ava@example.com' }));
    await screen.findByText('Signed in as Ava Cellist');

    auth.failNextAccountDelete();
    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    await user.click(screen.getByRole('button', { name: 'Delete forever' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/didn't work/i);
    // Nothing was deleted: the contributor is still signed in and the
    // confirmation stays, so they can see the reason and retry or cancel.
    expect(screen.getByText('Signed in as Ava Cellist')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete forever' })).toBeInTheDocument();
  });

  it('an unconfigured deployment says sign-in is unavailable and keeps browsing', async () => {
    const storage = await testStorage();
    render(
      <App
        controllerFactory={() => mockController()}
        storage={storage}
        authFactory={() => createAuthController(null)}
      />,
    );

    expect(await screen.findByText("Sign-in isn't set up yet")).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Workspace' })).toBeInTheDocument();
    // No sign-in affordance on an unconfigured deployment — nothing to press.
    expect(screen.queryByRole('button', { name: 'Sign in with Google' })).not.toBeInTheDocument();
  });
});

describe('App Commons submission', () => {
  /** A YouTube project on the workspace, with the contributor signed in. */
  async function seededYouTubeProject(
    user: ReturnType<typeof userEvent.setup>,
    commons: ReturnType<typeof mockCommonsWrite>,
  ): Promise<string> {
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 604.2 })),
    });
    const { storage, auth } = await renderApp(
      controller,
      undefined,
      undefined,
      undefined,
      commons,
    );
    await pasteLink(user, YOUTUBE_CANONICAL);
    await screen.findByRole('heading', { name: VIDEO_TITLE });
    await user.click(screen.getByRole('button', { name: 'Projects' }));
    await screen.findByText(VIDEO_TITLE);
    act(() => auth.setContributor({ id: 'c1', name: 'Ava Cellist', email: 'ava@example.com' }));
    await screen.findByText('Signed in as Ava Cellist');
    const [summary] = await storage.projects.list();
    return summary.id;
  }

  it('a signed-in contributor’s submission reaches the Commons and the answer becomes the badge', async () => {
    const user = userEvent.setup();
    const commons = mockCommonsWrite();
    const id = await seededYouTubeProject(user, commons);

    await user.click(screen.getByRole('button', { name: 'Submit to Commons' }));

    await waitFor(() =>
      expect(commons.backend.insertLabelSet).toHaveBeenCalledWith({
        id,
        video_id: VIDEO_ID,
        title: VIDEO_TITLE,
        duration: 604.2,
        markers: [],
      }),
    );
    // The refresh after the insert answers with the moderation gate's default.
    expect(await screen.findByText('Pending review')).toBeInTheDocument();
  });

  it('a signed-out contributor’s click routes to sign-in and never reaches the Commons', async () => {
    const user = userEvent.setup();
    const commons = mockCommonsWrite();
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 604.2 })),
    });
    const { auth } = await renderApp(controller, undefined, undefined, undefined, commons);
    await pasteLink(user, YOUTUBE_CANONICAL);
    await screen.findByRole('heading', { name: VIDEO_TITLE });
    await user.click(screen.getByRole('button', { name: 'Projects' }));
    await screen.findByText(VIDEO_TITLE);

    await user.click(screen.getByRole('button', { name: 'Sign in to submit' }));

    // The click starts the sign-in flow; the submission itself waits for it.
    expect(auth.signInWithGoogle).toHaveBeenCalledOnce();
    expect(commons.backend.insertLabelSet).not.toHaveBeenCalled();
  });

  it('surfaces a rate-limited submission as the moderation gate’s own rejection', async () => {
    const user = userEvent.setup();
    const commons = mockCommonsWrite();
    await seededYouTubeProject(user, commons);
    // The transport maps the PostgREST error's message by prefix (RATE_LIMITED).
    commons.backend.failNextInsert(
      'RATE_LIMITED: This account has submitted 3 label sets in the last 7 days — the limit. Try again later.',
    );

    await user.click(screen.getByRole('button', { name: 'Submit to Commons' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/3 label sets in the last 7 days/);
    // The rejection is not a badge state — no row was created.
    expect(screen.queryByText('Pending review')).not.toBeInTheDocument();
  });
});
