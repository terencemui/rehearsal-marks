import { useEffect } from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { labelSetRow } from './test/commons-fixture';
import { createStorage } from './storage';
import type { Storage } from './storage';
import { createAuthController } from './auth';
import { mockAuth } from './test/auth-fixture';
import { mockCommonsWrite } from './test/commons-write-fixture';
import { mockController } from './test/controller-fixture';
import { youtubeLoad } from './test/load-fixture';
import { projectRecord } from './test/project-fixture';
import { closeTestStorages, testStorage } from './test/storage-fixture';
import { waitForPlayerSettled } from './test/settle-player';
import type { CommunityLabelSet } from './youtube/community';
import App from './App';

/** The renderApp knobs — every App seam, named so a test reaches one without
 * skipping the others. */
interface RenderAppOptions {
  /** The audio-controller seam, like App's controllerFactory. */
  controller?: ReturnType<typeof mockController>;
  /** An already-opened storage; the app opens its own when absent. */
  storage?: Storage;
  /** The video-title lookup, so tests never reach the network. */
  fetchTitle?: (canonicalUrl: string) => Promise<string | null>;
  /** The community label-set lookup. */
  loadCommunityLabels?: (videoId: string) => Promise<CommunityLabelSet | null>;
  /** The Commons write seam, like App's commonsWriteFactory. */
  commons?: ReturnType<typeof mockCommonsWrite>;
  /** The starting URL the memory router serves — the refresh/landing case. */
  initialEntry?: string;
}

/** Renders the app on a fresh fake-indexeddb database with a mocked seam,
 * served by a memory router — the one App-level seam, so the tests control
 * the starting URL and can drive Back and Forward (T44). */
async function renderApp({
  controller = mockController(),
  storage,
  fetchTitle = async () => VIDEO_TITLE,
  loadCommunityLabels = async () => null,
  commons = mockCommonsWrite(),
  initialEntry = '/',
}: RenderAppOptions = {}) {
  const opened = storage ?? (await testStorage());
  const auth = mockAuth();
  /** The memory history's Back/Forward, driven like the browser's buttons. */
  let go: (delta: number) => void = () => {};
  /** Programmatic navigation to a path — the memory router's address bar. */
  let navigateTo: (path: string) => void = () => {};
  /**
   * The memory router's committed path — a mutable holder the returned getter
   * reads at call time. A getter that captured the location in an effect
   * closure would freeze the initial path (the object literal copies the
   * closure reference), so the probe writes the path here and the returned
   * `currentPath` reads it fresh.
   */
  const pathRef: { current: string } = { current: '/' };
  /** A probe inside the router that hands the helpers the navigate function and
   * the live location. The async act with a microtask yield is deliberate: React
   * 19 defers the history listener's location update, and a synchronous act would
   * read the DOM before the new page commits. */
  function HistoryProbe() {
    const navigate = useNavigate();
    const location = useLocation();
    useEffect(() => {
      go = async (delta: number) => {
        await act(async () => {
          navigate(delta);
          await Promise.resolve();
        });
      };
      navigateTo = async (path: string) => {
        await act(async () => {
          navigate(path);
          await Promise.resolve();
        });
      };
      pathRef.current = location.pathname;
    }, [navigate, location]);
    return null;
  }
  const view = render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <HistoryProbe />
      <App
        controllerFactory={() => controller}
        storage={opened}
        // Stubbed by default so no test reaches YouTube's oEmbed endpoint or
        // the community index, and no test constructs a supabase-js client.
        fetchTitle={fetchTitle}
        loadCommunityLabels={loadCommunityLabels}
        authFactory={() => auth.controller}
        commonsWriteFactory={() => commons.controller}
      />
    </MemoryRouter>,
  );
  return {
    ...view,
    storage: opened,
    controller,
    auth: auth.backend,
    commons: commons.backend,
    go,
    navigateTo,
    currentPath: () => pathRef.current,
  };
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
 * continuation (title → labels → token check → list refresh) inside act, so the
 * tests assert only the aftermath.
 */
async function createBehindNavigation(): Promise<{
  storage: Storage;
  controller: ReturnType<typeof mockController>;
  release: () => Promise<void>;
}> {
  const user = userEvent.setup();
  const storage = await testStorage();
  let releaseTitle!: () => void;
  const pendingTitle = new Promise<void>((resolve) => {
    releaseTitle = resolve;
  });
  const controller = mockController({
    load: vi.fn(async () => ({ duration: 372 })),
  });
  await renderApp({
    controller,
    storage,
    fetchTitle: async () => {
      await pendingTitle;
      return VIDEO_TITLE;
    },
  });
  await pasteLink(user, YOUTUBE_CANONICAL);
  // The title lookup is still in flight; the user navigates away to Help.
  await user.click(screen.getByRole('link', { name: 'Help' }));
  expect(screen.getByRole('heading', { name: 'Help' })).toBeInTheDocument();
  return {
    storage,
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

describe('App create from a YouTube link', () => {
  it('opens a freshly pasted link in Label mode, and the player is read-only over the empty timeline', async () => {
    // End to end, the behaviour the stamped mode and the player have to agree
    // on: a project with an empty timeline is still a label-mode record (the
    // create pipeline stamps it), and the T39 player is read-only over markers
    // whatever the mode — no transport, no posture toggle, no Add marker.
    const user = userEvent.setup();
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 372 })),
    });
    const { storage } = await renderApp({ controller });

    await pasteLink(user, YOUTUBE_CANONICAL);

    await screen.findByRole('heading', { name: VIDEO_TITLE });
    expect(screen.queryByRole('button', { name: 'Play' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Playback' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Label' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add marker' })).not.toBeInTheDocument();

    const [summary] = await storage.projects.list();
    expect((await storage.projects.get(summary.id))!.playerMode).toBe('label');
  });

  it('copies a loaded community label set in, and the player shows the copied marks', async () => {
    // The labeled-performance story: a video someone already marked loads its
    // label set at creation, so the project is immediately practiceable — the
    // marks render as marker rows, and the T39 player is read-only over them.
    const user = userEvent.setup();
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 604.2 })),
    });
    const community: CommunityLabelSet = {
      markers: [{ id: 'm1', time: 10, aliases: ['Recap'], createdAt: 1 }],
      movements: [],
      duration: 604.2,
    };
    const { storage } = await renderApp({
      controller,
      fetchTitle: async () => VIDEO_TITLE,
      loadCommunityLabels: async () => community,
    });

    await pasteLink(user, YOUTUBE_CANONICAL);

    await screen.findByRole('heading', { name: VIDEO_TITLE });
    // The copied marks render as marker rows — the first label in time order.
    expect(await screen.findByRole('button', { name: /A — Recap/ })).toBeInTheDocument();
    // No posture toggle, no Add marker — the transport is gone (T39).
    expect(screen.queryByRole('button', { name: 'Playback' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add marker' })).not.toBeInTheDocument();

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
      <MemoryRouter>
        <App
          controllerFactory={() => controller}
          storage={opened}
          fetchTitle={async () => VIDEO_TITLE}
        />
      </MemoryRouter>,
    );

    await pasteLink(user, YOUTUBE_CANONICAL);

    await screen.findByRole('heading', { name: VIDEO_TITLE });
    expect(await screen.findByRole('button', { name: /A — Recap/ })).toBeInTheDocument();
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
      <MemoryRouter>
        <App
          controllerFactory={() => controller}
          storage={opened}
          fetchTitle={async () => VIDEO_TITLE}
        />
      </MemoryRouter>,
    );

    await pasteLink(user, YOUTUBE_CANONICAL);

    await screen.findByRole('heading', { name: VIDEO_TITLE });
    // No posture toggle and no empty-timeline note — the player is read-only
    // and the lack of labels is simply what the empty timeline is.
    expect(screen.queryByRole('button', { name: 'Label' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Playback' })).not.toBeInTheDocument();
    expect(screen.queryByText(/no community labels loaded/i)).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    const [summary] = await opened.projects.list();
    expect((await opened.projects.get(summary.id))!.markers).toEqual([]);
  });

  it('lands in the same player session an upload does', async () => {
    const user = userEvent.setup();
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 372 })),
    });
    const { storage } = await renderApp({ controller });

    await pasteLink(user, YOUTUBE_CANONICAL);

    // The player, named after the video, with the split view an upload gets.
    expect(await screen.findByRole('heading', { name: VIDEO_TITLE })).toBeInTheDocument();
    // The load settles through the one marker a render helper waits on — the
    // root's `data-settled` flag, set on the success and failure paths alike
    // (the heading appears on mount, before the load lands).
    await waitForPlayerSettled();

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
    const { storage } = await renderApp({ controller: mockController(), fetchTitle: async () => null });

    await pasteLink(user, YOUTUBE_CANONICAL);

    // Offline, or a video whose title is not public: the project is still the
    // user's to keep, named by something they can recognize and rename.
    expect(await screen.findByRole('heading', { name: `YouTube video ${VIDEO_ID}` })).toBeInTheDocument();
    expect(await storage.projects.list()).toHaveLength(1);
  });

  it('surfaces a save failure on the link input', async () => {
    const user = userEvent.setup();
    const storage = await testStorage();
    const brokenStorage: Storage = {
      ...storage,
      projects: {
        ...storage.projects,
        save: async () => {
          throw new Error('IndexedDB unavailable');
        },
      },
    };
    await renderApp({ controller: mockController(), storage: brokenStorage });

    await pasteLink(user, YOUTUBE_CANONICAL);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/something went wrong creating the project/i);
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
    const { container } = await renderApp({ controller, storage });

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
    await renderApp({ controller: mockController(), storage });

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
    expect(screen.getByRole('link', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Help' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Library' })).not.toBeInTheDocument();
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
    await renderApp({ controller, storage });

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

    // The navbar's Projects link is the way home now — the player carries no
    // nav of its own (T45).
    await user.click(screen.getByRole('link', { name: 'Projects' }));

    await waitForWorkspaceRow(VIDEO_TITLE);
    expect(await storage.projects.list()).toHaveLength(1);
  });

  it('renames inline, persists, and moves the renamed project to the top', async () => {
    const user = userEvent.setup();
    const storage = await testStorage();
    await storage.projects.save(projectRecord({ id: 'older', name: 'Older', updatedAt: 1_000 }));
    await storage.projects.save(projectRecord({ id: 'newer', name: 'Newer', updatedAt: 2_000 }));
    await renderApp({ controller: mockController(), storage });
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
    await renderApp({ controller: mockController(), storage });
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

  it('shows the save-failed state when a rename hits a failing store', async () => {
    const user = userEvent.setup();
    const storage = await testStorage();
    await storage.projects.save(projectRecord());
    const brokenStorage: Storage = {
      ...storage,
      projects: {
        ...storage.projects,
        save: async () => {
          throw new Error('IndexedDB unavailable');
        },
      },
    };
    await renderApp({ controller: mockController(), storage: brokenStorage });
    await screen.findByText('Brahms Op. 118 No. 2');

    const row = screen.getByRole('listitem');
    await user.click(within(row).getByRole('button', { name: 'Rename' }));
    const input = screen.getByRole('textbox', { name: 'Project name' });
    await user.clear(input);
    await user.type(input, 'New Name{enter}');

    expect(await screen.findByRole('status')).toHaveTextContent('Save failed.');
  });

  it('persists projects across a page reload', async () => {
    const name = `reload-${crypto.randomUUID()}`;
    const first = await createStorage({ name });
    await first.projects.save(projectRecord());
    first.close();

    // A reload: a fresh App opens a fresh connection to the same database.
    const reopened = await createStorage({ name });
    await renderApp({ controller: mockController(), storage: reopened });
    expect(await screen.findByText('Brahms Op. 118 No. 2')).toBeInTheDocument();
    reopened.close();
  });

  it('navigates between the workspace pages, and the navbar marks the active page', async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(screen.getByRole('link', { name: 'Help' }));
    expect(screen.getByRole('heading', { name: 'Help' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Help' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Projects' })).not.toHaveAttribute('aria-current');

    await user.click(screen.getByRole('link', { name: 'Projects' }));
    expect(screen.getByRole('heading', { name: 'No projects yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Help' })).not.toHaveAttribute('aria-current');
  });

  it('drops an in-flight page read when the user navigates away', async () => {
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
    await renderApp({ controller, storage: slowStorage });
    await screen.findByText('Brahms Op. 118 No. 2');

    // The row click navigates to the project page; its record read is slow.
    await user.click(screen.getByRole('button', { name: /Brahms/ }));
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

  it('surfaces a failed final save on exit', async () => {
    const user = userEvent.setup();
    const storage = await testStorage();
    let saves = 0;
    // The create's first save succeeds; every later save hits a failing store.
    const flaky: Storage = {
      ...storage,
      projects: {
        ...storage.projects,
        save: async (record) => {
          saves += 1;
          if (saves > 1) throw new Error('IndexedDB unavailable');
          await storage.projects.save(record);
        },
      },
    };
    const controller = mockController({
      // A different duration guarantees the player schedules a write.
      load: vi.fn(async () => ({ duration: 42 })),
    });
    await renderApp({ controller, storage: flaky });
    await pasteLink(user, YOUTUBE_CANONICAL);
    await screen.findByRole('heading', { name: VIDEO_TITLE });
    // The player's only write — the measured-duration stamp — fails against
    // the flaky store. With the in-player status line gone (T37), wait on the
    // write itself before leaving the player.
    await vi.waitFor(() => expect(saves).toBeGreaterThanOrEqual(2));

    // The navbar's Projects link leaves the player; the page's teardown flush
    // fails too, and the shell's exit channel reports the failure on the
    // workspace's save line.
    await user.click(screen.getByRole('link', { name: 'Projects' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Save failed.');
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
    await renderApp({ controller: mockController(), storage: broken });
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
    await user.click(screen.getByRole('link', { name: 'Projects' }));
    await waitForWorkspaceRow(VIDEO_TITLE);

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
    expect(screen.getByRole('link', { name: 'Projects' })).toBeInTheDocument();
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
      <MemoryRouter>
        <App
          controllerFactory={() => mockController()}
          storage={storage}
          authFactory={() => createAuthController(null)}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Sign-in isn't set up yet")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Projects' })).toBeInTheDocument();
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
    const { storage, auth } = await renderApp({
      controller,
      commons,
    });
    await pasteLink(user, YOUTUBE_CANONICAL);
    await screen.findByRole('heading', { name: VIDEO_TITLE });
    await user.click(screen.getByRole('link', { name: 'Projects' }));
    await waitForWorkspaceRow(VIDEO_TITLE);
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
        movements: [],
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
    const { auth } = await renderApp({ controller, commons });
    await pasteLink(user, YOUTUBE_CANONICAL);
    await screen.findByRole('heading', { name: VIDEO_TITLE });
    await user.click(screen.getByRole('link', { name: 'Projects' }));
    await waitForWorkspaceRow(VIDEO_TITLE);

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

describe('App durable workspace state (T43)', () => {
  /** A project on the workspace and the contributor signed in over it. */
  async function seededSubmittedProject(
    user: ReturnType<typeof userEvent.setup>,
  ): Promise<{
    storage: Storage;
    commons: ReturnType<typeof mockCommonsWrite>;
    auth: ReturnType<typeof mockAuth>['backend'];
  }> {
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const storage = await testStorage();
    await storage.projects.save(
      projectRecord({ id, name: 'Brahms on YouTube', videoId: VIDEO_ID, duration: 604.2 }),
    );
    const commons = mockCommonsWrite([
      labelSetRow({
        id,
        title: 'Brahms on YouTube',
        duration: 604.2,
        publication_status: 'pending',
      }),
    ]);
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 604.2 })),
    });
    const { auth } = await renderApp({ controller, storage, commons });

    await user.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    act(() => auth.setContributor({ id: 'c1', name: 'Ava Cellist', email: 'ava@example.com' }));
    // The badge loads once from the seeded submissions.
    await screen.findByText('Pending review');
    return { storage, commons, auth };
  }

  it('keeps the contributor’s Commons badges across a player visit, without a re-fetch', async () => {
    const user = userEvent.setup();
    const { commons } = await seededSubmittedProject(user);
    expect(commons.backend.listMyLabelSets).toHaveBeenCalledTimes(1);

    // Into the player and back — the workspace surface unmounts and remounts.
    await user.click(screen.getByRole('button', { name: /Brahms on YouTube/ }));
    await screen.findByRole('heading', { name: 'Brahms on YouTube' });
    await user.click(screen.getByRole('link', { name: 'Projects' }));
    await waitForWorkspaceRow('Brahms on YouTube');

    // The badge and the update affordance are still there — the rows are the
    // shell's durable state, not the surface's, so nothing re-fetched on return.
    expect(screen.getByText('Pending review')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update submission' })).toBeInTheDocument();
    expect(commons.backend.listMyLabelSets).toHaveBeenCalledTimes(1);
  });

  it('re-submitting after a player visit updates the existing moderation row', async () => {
    const user = userEvent.setup();
    const { commons } = await seededSubmittedProject(user);

    // Round-trip through the player, then re-submit.
    await user.click(screen.getByRole('button', { name: /Brahms on YouTube/ }));
    await screen.findByRole('heading', { name: 'Brahms on YouTube' });
    await user.click(screen.getByRole('link', { name: 'Projects' }));
    await waitForWorkspaceRow('Brahms on YouTube');

    await user.click(screen.getByRole('button', { name: 'Update submission' }));

    // The rows survived the round-trip, so the submit saw the existing row and
    // updated it — re-submission is an UPDATE, never a second moderation row.
    await waitFor(() => expect(commons.backend.updateLabelSet).toHaveBeenCalled());
    expect(commons.backend.insertLabelSet).not.toHaveBeenCalled();
    expect(commons.backend.rows).toHaveLength(1);
    expect(await screen.findByText('Submission updated.')).toBeInTheDocument();
  });

  it('keeps a create rejection’s guidance across a tab switch', async () => {
    const user = userEvent.setup();
    await renderApp();

    await pasteLink(user, 'https://example.com/not-a-video');
    expect(await screen.findByRole('alert')).toHaveTextContent(/YouTube video link/);

    await user.click(screen.getByRole('link', { name: 'Help' }));
    expect(screen.getByRole('heading', { name: 'Help' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Projects' }));

    // The rejection still explains the bad input that sits in the field.
    expect(screen.getByRole('alert')).toHaveTextContent(/YouTube video link/);
    expect(screen.getByLabelText(/paste a YouTube link/i)).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('App pages and the persistent navbar (T44)', () => {
  it('renders the Projects home at /, framed by the persistent navbar', async () => {
    await renderApp();
    // The create surface is the home page's headline affordance; the navbar —
    // the app name, the page links, and the sign-in — frames it, with the
    // Projects link marking the active page.
    expect(screen.getByRole('region', { name: 'Create project' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Rehearsal Marks' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Help' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument();
  });

  it('renders the Help page at /help with the same persistent navbar', async () => {
    // A refresh while on /help lands straight back on Help — the router
    // restores the page from the URL, not from app state.
    await renderApp({ initialEntry: '/help' });
    expect(screen.getByRole('heading', { name: 'Help' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Rehearsal Marks' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Help' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument();
  });

  it('lands an unknown path on the Projects home', async () => {
    await renderApp({ initialEntry: '/no-such-page' });
    expect(await screen.findByRole('heading', { name: 'No projects yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute('aria-current', 'page');
  });

  it('browser Back and Forward move between the workspace pages', async () => {
    const user = userEvent.setup();
    const { go } = await renderApp();
    expect(screen.getByRole('heading', { name: 'No projects yet' })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Help' }));
    expect(screen.getByRole('heading', { name: 'Help' })).toBeInTheDocument();

    // Back to the Projects home, then forward to Help again.
    await go(-1);
    expect(screen.getByRole('heading', { name: 'No projects yet' })).toBeInTheDocument();
    await go(1);
    expect(screen.getByRole('heading', { name: 'Help' })).toBeInTheDocument();
  });
});

describe('App route-as-session project page (T45)', () => {
  it('renders a project page at /projects/:id — the player under the navbar, restored by a refresh', async () => {
    const storage = await testStorage();
    const record = projectRecord({ id: 'p1', name: 'Brahms Op. 118 No. 2', duration: 372 });
    await storage.projects.save(record);
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 372 })),
    });
    // A refresh at the project's URL: the router restores the page from the
    // path, and the page builds its own session — no app-level open state.
    const { container } = await renderApp({ controller, storage, initialEntry: '/projects/p1' });

    expect(await screen.findByRole('heading', { name: 'Brahms Op. 118 No. 2' })).toBeInTheDocument();
    // The player is shell chrome under the persistent navbar — the app name,
    // the page links, and the sign-in all frame it.
    expect(screen.getByRole('heading', { name: 'Rehearsal Marks' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Help' })).toBeInTheDocument();
    expect(container.querySelector('.player-ruler')).toBeInTheDocument();
    await waitForPlayerSettled();
    // The session read the stored record — a visit never writes anything else.
    expect(await storage.projects.get(record.id)).toEqual(
      expect.objectContaining({ markers: record.markers }),
    );
  });

  it('opening a project from the list navigates to its page', async () => {
    const user = userEvent.setup();
    const storage = await testStorage();
    await storage.projects.save(projectRecord({ id: 'p1', name: 'Brahms Op. 118 No. 2' }));
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 372 })),
    });
    const { currentPath } = await renderApp({ controller, storage });

    await user.click(await screen.findByRole('button', { name: /Brahms/ }));

    expect(await screen.findByRole('heading', { name: 'Brahms Op. 118 No. 2' })).toBeInTheDocument();
    // The open is a navigation — the project's page is the address bar's.
    // (The probe's location closure updates on an effect, hence the wait.)
    await waitFor(() => expect(currentPath()).toBe('/projects/p1'));
  });

  it('browser Back returns to the Projects list, flushing the pending write', async () => {
    const user = userEvent.setup();
    const storage = await testStorage();
    const record = projectRecord({ id: 'p1', name: 'Brahms Op. 118 No. 2', duration: 372 });
    await storage.projects.save(record);
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 500 })),
    });
    const { go } = await renderApp({ controller, storage });

    // Into the player: the load's measured duration differs from the stored
    // one, so the player schedules its one write — the duration stamp.
    await user.click(await screen.findByRole('button', { name: /Brahms/ }));
    await screen.findByRole('heading', { name: 'Brahms Op. 118 No. 2' });
    await waitForPlayerSettled();

    // Back is the exit: the page tears down, flushing its one pending write
    // before the workspace re-reads the list.
    await go(-1);
    await waitForWorkspaceRow('Brahms Op. 118 No. 2');
    await vi.waitFor(async () => {
      expect((await storage.projects.get(record.id))!.duration).toBe(500);
    });
    const [summary] = await storage.projects.list();
    expect(summary.duration).toBe(500);
  });

  it('navigating from one project page to another closes the first and opens the second', async () => {
    const user = userEvent.setup();
    const storage = await testStorage();
    await storage.projects.save(projectRecord({ id: 'p1', name: 'Brahms Op. 118 No. 2' }));
    await storage.projects.save(projectRecord({ id: 'p2', name: 'Bach Cello Suite', duration: 372 }));
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 372 })),
    });
    const { navigateTo } = await renderApp({ controller, storage });

    await user.click(await screen.findByRole('button', { name: /Brahms/ }));
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
    await renderApp({ initialEntry: '/projects/no-such-project' });

    expect(
      await screen.findByRole('heading', { name: 'This project could not be found' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Back to Projects' }));
    expect(await screen.findByRole('heading', { name: 'No projects yet' })).toBeInTheDocument();
  });

  it('a failed record read lands home with a notice, not the not-found page', async () => {
    // A read that fails is not "not found" — the store was unreachable, not
    // empty. The page falls back to the Projects home, the workspace's notice
    // says what went wrong, and the not-found page is not shown (T47 keeps
    // the T45 behavior for a transient storage error).
    const storage = await testStorage();
    const brokenStorage: Storage = {
      ...storage,
      projects: {
        ...storage.projects,
        get: async () => {
          throw new Error('IndexedDB unavailable');
        },
      },
    };
    await renderApp({
      controller: mockController(),
      storage: brokenStorage,
      initialEntry: '/projects/p1',
    });

    expect(await screen.findByRole('heading', { name: 'No projects yet' })).toBeInTheDocument();
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
    const storage = await testStorage();
    await storage.projects.save(projectRecord({ id: 'p1', name: 'Brahms Op. 118 No. 2' }));
    let releaseRead!: () => void;
    const pendingGet = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    let reads = 0;
    const slowStorage: Storage = {
      ...storage,
      projects: {
        ...storage.projects,
        get: async (id) => {
          reads += 1;
          // Only the revisit of the real project is held open — the first
          // read (the missing id) and any other reads run straight through.
          if (id === 'p1' && reads > 1) await pendingGet;
          return storage.projects.get(id);
        },
      },
    };
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 372 })),
    });
    const { navigateTo } = await renderApp({
      controller,
      storage: slowStorage,
      initialEntry: '/projects/no-such-project',
    });

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
    });
    expect(await screen.findByRole('heading', { name: 'Brahms Op. 118 No. 2' })).toBeInTheDocument();
  });

  it('the not-found escape replaces the dead URL, so browser Back does not re-enter it', async () => {
    // Escaping via the page's own link replaces the dead entry in history
    // (the old navigate-home-invariant): Back from the Projects list goes
    // past the dead URL rather than back into the not-found page.
    const user = userEvent.setup();
    const storage = await testStorage();
    await storage.projects.save(projectRecord({ id: 'p1', name: 'Brahms Op. 118 No. 2' }));
    const { navigateTo, go } = await renderApp({ controller: mockController(), storage });
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
    const { storage, controller, release } = await createBehindNavigation();
    await release();

    // The project is saved and waiting in the list; the user stays on Help.
    expect(screen.getByRole('heading', { name: 'Help' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: VIDEO_TITLE })).not.toBeInTheDocument();
    const projects = await storage.projects.list();
    expect(projects.map((p) => p.name)).toEqual([VIDEO_TITLE]);
    // No session ever opened — the controller is never created.
    expect(controller.load).not.toHaveBeenCalled();
  });
});

describe('App create-from-link navigates to the project page (T46)', () => {
  it('lands a link create on the new project’s page — its own URL, the player under the navbar', async () => {
    const user = userEvent.setup();
    const controller = mockController({
      load: vi.fn(async () => ({ duration: 372 })),
    });
    const { storage, currentPath } = await renderApp({ controller });

    await pasteLink(user, YOUTUBE_CANONICAL);

    // The player renders on the new project's page.
    expect(await screen.findByRole('heading', { name: VIDEO_TITLE })).toBeInTheDocument();
    // The URL is the new project's own address — the created row's id, not a
    // hardcoded path — so the page is refreshable and shareable.
    const [created] = await storage.projects.list();
    await waitFor(() => expect(currentPath()).toBe(`/projects/${created.id}`));
    // The persistent navbar still frames the player page.
    expect(screen.getByRole('link', { name: 'Projects' })).toBeInTheDocument();
    // The load settles before the test finishes, so the player's one write (the
    // measured-duration stamp) is not left pending across the storage teardown.
    await waitForPlayerSettled();
  });

  it('a create that lands behind a navigation is waiting in the list when the user returns', async () => {
    const { storage, release } = await createBehindNavigation();
    await release();

    // Not yanked: the user is still where they chose to go.
    expect(screen.getByRole('heading', { name: 'Help' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: VIDEO_TITLE })).not.toBeInTheDocument();

    // Their own return to Projects finds the saved project in the list.
    const user = userEvent.setup();
    await user.click(screen.getByRole('link', { name: 'Projects' }));
    await waitForWorkspaceRow(VIDEO_TITLE);
    expect(await storage.projects.list()).toHaveLength(1);
  });
});
