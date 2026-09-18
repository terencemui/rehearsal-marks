import { useEffect } from 'react';
import { createMemoryRouter, RouterProvider, useLocation, useNavigate } from 'react-router';
import { act, render } from '@testing-library/react';
import { onTestFinished, vi } from 'vitest';
import App from '../App';
import { mockAuth } from './auth-fixture';
import { mockController } from './controller-fixture';
import { fakeProjectsApi } from './projects-fixture';
import type { FakeProjectsApi } from './projects-fixture';

/**
 * The recording the app-level tests are about: the video a test pastes as a
 * link, the canonical form of that link, and the title the fake lookup returns
 * unless a test overrides it.
 *
 * The video ID must match `serverProject`'s default (server-project-fixture):
 * tests seed that project and then paste this link, so the peek and the
 * created-row identity assertions compare the two. A literal rather than a
 * computed `serverProject().videoId` because this file's JSX makes it
 * component-shaped, and a non-literal export here trips
 * react-refresh/only-export-components — so the coupling is stated, not
 * enforced. Change one default and those tests fail together.
 */
export const VIDEO_ID = 'dQw4w9WgXcQ';
export const YOUTUBE_CANONICAL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
export const VIDEO_TITLE = 'Brahms — Intermezzo Op. 118 No. 2';

/** The renderApp knobs — every App seam, named so a test reaches one without
 * skipping the others. */
export interface RenderAppOptions {
  /** The audio-controller seam, like App's controllerFactory. */
  controller?: ReturnType<typeof mockController>;
  /** The server-project surface, like App's projectsApiFactory. */
  api?: FakeProjectsApi;
  /** The video-title lookup, so tests never reach the network. */
  fetchTitle?: (canonicalUrl: string) => Promise<string | null>;
  /** The Google sign-in seam, like App's authFactory. */
  auth?: ReturnType<typeof mockAuth>;
  /** The starting URL the memory router serves — the refresh/landing case. */
  initialEntry?: string;
}

/**
 * Renders the app on a fake server project surface with mocked seams, served
 * by a memory-backed data router (T60) — the one App-level seam, so the tests
 * control the starting URL and can drive Back and Forward (T44), and so a page
 * that refuses to be left (T60) can be caught in the act. App's env gate (T51)
 * needs a wired env to reach the shell at all, so every test stubs one; the
 * api and auth seams keep the test off the network — no supabase-js client is
 * ever constructed.
 *
 * The highest seam the app has, so it lives in the shared fixtures (T54)
 * rather than in App's own test file: it is where behaviour that spans the
 * shell's pages is observable, and the shared way to drive the app at a real
 * URL through the real router. (App's env gate is the one case that still
 * renders by hand, since this helper always stubs a wired env.)
 */
export function renderApp({
  controller = mockController(),
  api = fakeProjectsApi(),
  fetchTitle = async () => VIDEO_TITLE,
  auth = mockAuth(),
  // The workspace home is the signed-in entry (T51); the gallery at the front
  // door `/` is the anonymous entry, tested with its own initialEntry.
  initialEntry = '/projects',
}: RenderAppOptions = {}) {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
  // The stubs are this render's, so their cleanup is this render's too —
  // registered against the running test rather than the module, so a file that
  // imports only the constants above never picks up a global unstub hook. (It
  // needs a test's context: rendering at module scope or in beforeAll throws
  // rather than quietly leaking.)
  onTestFinished(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  /** The memory history's Back/Forward, driven like the browser's buttons. */
  let go: (delta: number) => void = () => {};
  /** Programmatic navigation to a path — the memory router's address bar. */
  let navigateTo: (path: string) => void = () => {};
  /**
   * The memory router's committed pathname — a mutable holder the returned
   * getter reads at call time. A getter that captured the location in an effect
   * closure would freeze the initial path (the object literal copies the
   * closure reference), so the probe writes the path here and the returned
   * `currentPath` reads it fresh. (The pathname alone: no route in the app
   * carries a query or a fragment, so there is nothing else to record.)
   */
  const pathRef: { current: string } = { current: initialEntry };
  /** A probe inside the router that hands the helpers the navigate function and
   * the live location. Every drive is wrapped in an async act for the same
   * reason throughout: the page a navigation lands on commits after the act's
   * own turn, and a synchronous act would read the DOM before it did. */
  function HistoryProbe() {
    const navigate = useNavigate();
    const location = useLocation();
    useEffect(() => {
      // The navigation is awaited, not merely started: a data router resolves
      // `navigate` when the navigation settles, and a blocked one settles as
      // blocked — so a test that drives the app into a leave prompt knows the
      // router is holding still by the time it asserts.
      go = async (delta: number) => {
        await act(async () => {
          await navigate(delta);
        });
      };
      navigateTo = async (path: string) => {
        await act(async () => {
          await navigate(path);
        });
      };
      pathRef.current = location.pathname;
    }, [navigate, location]);
    return null;
  }
  // A memory-backed data router (T60), matching the app's own — `main.tsx`
  // carries why the router is a data one rather than a declarative one. The
  // splat route leaves `App`'s internal `<Routes>` to do the real matching,
  // exactly as the running app does.
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <>
            <HistoryProbe />
            <App
              controllerFactory={() => controller}
              projectsApiFactory={() => api}
              // Stubbed by default so no test reaches YouTube's oEmbed
              // endpoint, and no test constructs a supabase-js client.
              fetchTitle={fetchTitle}
              authFactory={() => auth.controller}
            />
          </>
        ),
      },
    ],
    { initialEntries: [initialEntry] },
  );
  const view = render(<RouterProvider router={router} />);
  return {
    ...view,
    api,
    controller,
    auth: auth.backend,
    go,
    navigateTo,
    currentPath: () => pathRef.current,
  };
}
