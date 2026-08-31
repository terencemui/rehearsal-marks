import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { createAudioController } from './audio';
import type { AudioController } from './audio';
import { createDefaultAuthController } from './auth';
import type { AuthController, AuthState } from './auth';
import { CommonsError } from './commons/errors';
import { rowsById } from './commons/labelSet';
import type { LabelSetRow } from './commons/labelSet';
import { readCommonsConfig } from './commons/load';
import { createDefaultCommonsWrite } from './commons/write';
import type { CommonsWriteController } from './commons/write';
import { createDefaultProjectsApi } from './projects';
import type { ProjectsApi } from './projects';
import { createStorage } from './storage';
import type { ProjectSummary, SaveStatus, Storage } from './storage';
import { fetchYouTubeTitle, loadCommunityLabelSet } from './youtube';
import type { CommunityLabelSet } from './youtube/community';
import { GalleryScreen } from './ui/GalleryScreen';
import { HelpTab } from './ui/HelpTab';
import { Navbar } from './ui/Navbar';
import { NotWiredUp } from './ui/NotWiredUp';
import { ProjectPage } from './ui/ProjectPage';
import { PublicProjectView } from './ui/PublicProjectView';
import { WorkspaceScreen } from './ui/WorkspaceScreen';
import './ui/app.css';

export interface AppProps {
  /** Test seam: overrides the audio controller. */
  controllerFactory?: () => AudioController;
  /** Test seam: an already-opened storage; the app opens its own when absent. */
  storage?: Storage;
  /** Test seam: the video-title lookup, so component tests never touch the network. */
  fetchTitle?: (canonicalUrl: string) => Promise<string | null>;
  /**
   * Test seam: the community label-set lookup — same reason as fetchTitle.
   * The default is the real transport: an anonymous query against the hosted
   * Commons (ADR-0001), which reads as no labels when the app is not wired
   * to a Supabase project or the Commons is unreachable.
   */
  loadCommunityLabels?: (videoId: string) => Promise<CommunityLabelSet | null>;
  /**
   * Test seam: the contributor sign-in surface, so component tests never
   * construct a supabase-js client — the same containment the audio tests
   * get from faking `window.YT`.
   */
  authFactory?: () => AuthController;
  /**
   * Test seam: the Commons write surface (submit + own-submissions reads),
   * so component tests never construct a supabase-js client — the same
   * containment the auth and audio tests get from their fakes.
   */
  commonsWriteFactory?: () => CommonsWriteController;
  /**
   * Test seam: the anonymous projects read surface (T50), so component tests
   * never touch PostgREST. Null means the deployment isn't wired to a
   * Supabase project — the gallery routes render the "not wired up" screen.
   */
  projectsApiFactory?: () => ProjectsApi | null;
}

/**
 * The app's fetch surface for the Commons' anonymous reads, translating every
 * network failure into the CommonsError a label-set read degrades to. Every
 * fetch carries a timeout: a hung query must not hold a link create hostage.
 */
const COMMONS_FETCH_TIMEOUT_MS = 5_000;

/** Fetches a URL as text with the read timeout; network and HTTP failures become `failure`. */
async function fetchTextWithTimeout(
  url: string,
  failure: () => Error,
  timeoutMs: number,
  headers?: Record<string, string>,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers });
  } catch {
    throw failure();
  }
  if (!response.ok) throw failure();
  return response.text();
}

/** The Commons' anonymous reads; the caller supplies the anon-key headers the query needs. */
function fetchCommonsText(url: string, headers?: Record<string, string>): Promise<string> {
  return fetchTextWithTimeout(url, commonsFailure, COMMONS_FETCH_TIMEOUT_MS, headers);
}

/** The Commons' read failure — the create pipeline degrades it to an unlabeled video. */
function commonsFailure(): CommonsError {
  return new CommonsError(
    "The Commons couldn't be reached. Check your connection and try again.",
    'fetch-failed',
  );
}

/**
 * The app shell (T43, T44, T45): owns storage, the contributor controllers, and
 * the workspace's durable state (the list, the save line, the notices, the
 * create surface's rejection and busy state, and the Commons badges — everything
 * that must survive the page surfaces' unmounts), and coordinates the two
 * separable modules — the workspace surface (create, list, rename, delete,
 * submission) and the routed project page. The app is served by a history-mode
 * router (T44): `/` is the front door — the public gallery (T50), or the
 * "not wired up" screen without a configured backend — `/projects` the
 * owner's workspace, `/help` the discoverable reference, `/projects/:id` the
 * project page, `/gallery/:id` the read-only view over a published public
 * project, and any unknown path falls back to `/`. A persistent navbar — the
 * app name, the Gallery, Projects, and Help links with active
 * states, and the contributor sign-in — renders on every page, inside the
 * shared page rail. Opening a project is navigation now (T45): the page is its
 * own session, restored by a refresh of its URL, and browser Back — or a navbar
 * link — is the exit, flushing the session's one write (the measured duration)
 * before the list is re-read, so the workspace never shows stale data.
 */
function App({
  controllerFactory = createAudioController,
  storage: injectedStorage,
  fetchTitle = fetchYouTubeTitle,
  // The community transport, per ADR-0001: an anonymous query against the
  // hosted Commons, run behind the create pipeline's seam. A project not
  // wired to a Supabase project — or a Commons that cannot be reached —
  // reads as no labels: an unlabeled video starts in Label mode with the
  // empty state explained, exactly as an index fetch failure did.
  loadCommunityLabels = (videoId) =>
    loadCommunityLabelSet(videoId, {
      config: readCommonsConfig(),
      fetchText: fetchCommonsText,
    }),
  authFactory = createDefaultAuthController,
  // The Commons write surface, per ADR-0001: the signed-in contributor's
  // submissions ride the same env and the same unconfigured degradation as
  // sign-in — a deployment without a Supabase project offers no Commons.
  commonsWriteFactory = createDefaultCommonsWrite,
  // The anonymous projects read surface, per ADR-0006: the gallery and the
  // read-only view ride the anon key with no session. Unconfigured (no
  // Supabase env) it is null — the honest "not wired up" case the shell
  // renders as its own screen, never a broken gallery.
  projectsApiFactory = createDefaultProjectsApi,
}: AppProps = {}) {
  const [storage, setStorage] = useState<Storage | null>(injectedStorage ?? null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [status, setStatus] = useState<SaveStatus>('idle');
  /**
   * The routed page — the location is the shell's page: navigation swaps the
   * workspace surface for Help or a project page, and bumps the navigation
   * token that a slow create reads before it lands.
   */
  const location = useLocation();
  const [notice, setNotice] = useState<string | null>(null);
  /** The contributor session — the header's sign-in state. Anonymous first paint. */
  const [authState, setAuthState] = useState<AuthState>({ kind: 'anonymous' });
  /**
   * The link field's own failure channel: the create surface shows each
   * rejection beside the input that caused it. Lifted with the rest of the
   * workspace's durable state — a create rejection must survive a tab
   * switch, or the guidance vanishes from under the bad input it explains.
   */
  const [linkError, setLinkError] = useState<string | null>(null);
  /**
   * True while a link create runs — the create surface's busy line. Lifted
   * so the surface's buttons stay inert across its unmounts: an in-flight
   * create holds the working lock, and re-enabling the button mid-flight
   * would only produce a second action the lock silently drops.
   */
  const [creatingFromLink, setCreatingFromLink] = useState(false);
  /**
   * The signed-in contributor's Commons rows by project id — the row badges'
   * source, refreshed on every sign-in and every submission. Null while
   * signed out (no rows exist to show). Lifted so the badges survive the
   * surface's unmounts — and so a re-submit always sees the existing row,
   * keeping re-submission an UPDATE rather than a second moderation row.
   */
  const [commonsRows, setCommonsRows] = useState<Record<string, LabelSetRow> | null>(null);
  /** The row whose Commons submission runs, if any — rows are inert then. Lifted for the same reason as creatingFromLink. */
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  /**
   * Serializes the workspace mutations (a link create, rename, delete) and the
   * Commons submission. These are one-at-a-time user actions, and the
   * alternative — a rename racing a fresh create or a delete racing a rename —
   * silently reverts or hides the loser's data. (An open is instant navigation
   * now (T45): it holds no lock.)
   */
  const workingRef = useRef(false);
  /**
   * The session controller for the app's lifetime — created on mount,
   * destroyed on unmount. Auth state lives here in App state only: it never
   * touches storage, so signing in or out cannot disturb local projects.
   */
  const authRef = useRef<AuthController | null>(null);
  /**
   * The Commons write controller for the app's lifetime — created on mount
   * like the auth controller. It holds no subscriptions, so there is nothing
   * to destroy; it is dropped on unmount the same way.
   */
  const commonsWriteRef = useRef<CommonsWriteController | null>(null);

  /**
   * The anonymous projects read surface for the app's lifetime. Stateless —
   * no subscriptions to recycle, no session events to drop — so the mount-only
   * rule that guards the auth and Commons controllers doesn't apply: one
   * memoized read surface, stable across the shell's re-renders. A gallery
   * keyed on a freshly-made api object would refetch on every parent render.
   */
  // eslint-disable-next-line react-hooks/exhaustive-deps -- created once, like the controllers
  const projectsApi = useMemo(() => projectsApiFactory(), []);

  /** Re-reads the workspace list; a failed read surfaces as a notice, never a rejection. */
  async function refreshProjects(source: Storage): Promise<void> {
    try {
      setProjects(await source.projects.list());
    } catch {
      setNotice('Something went wrong reading the project list. Please reload.');
    }
  }

  // Runs once per mount, never per render: an inline `authFactory` from a
  // re-rendering parent can't recycle the controller mid-mount and drop
  // in-flight session events — the first factory wins for the mount.
  // (StrictMode's effect replay destroys and re-creates the controller,
  // which is exactly the fresh start a dev remount wants.)
  useEffect(() => {
    const controller = authFactory();
    authRef.current = controller;
    const unsubscribe = controller.subscribe(setAuthState);
    // The snapshot, not the first subscription callback: a restored session
    // must be painted before the backend's own event arrives.
    setAuthState(controller.getState());
    return () => {
      authRef.current = null;
      unsubscribe();
      controller.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only by design
  }, []);

  // The same mount-only rule as the auth controller: an inline factory from
  // a re-rendering parent must not recycle the controller mid-mount.
  useEffect(() => {
    const commons = commonsWriteFactory();
    commonsWriteRef.current = commons;
    return () => {
      commonsWriteRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only by design
  }, []);

  // The contributor's own submissions follow the session: loaded on every
  // sign-in (including a restored one), cleared on sign-out. The list is a
  // convenience — a failed read leaves the rows unknown (no badges) with the
  // failure surfaced, never a crash. The rows live here, not in the workspace
  // surface: they must survive its unmounts, and a re-submit must always see
  // the existing row so it stays an UPDATE, never a second moderation row.
  useEffect(() => {
    if (authState.kind !== 'signed-in') {
      setCommonsRows(null);
      return;
    }
    let cancelled = false;
    void commonsWriteRef.current
      ?.listMySubmissions()
      .then((rows) => {
        if (!cancelled) setCommonsRows(rowsById(rows));
      })
      .catch(() => {
        if (!cancelled) setNotice("Couldn't load your Commons submissions.");
      });
    return () => {
      cancelled = true;
    };
  }, [authState.kind]);

  useEffect(() => {
    if (injectedStorage) {
      void refreshProjects(injectedStorage);
      return;
    }
    let cancelled = false;
    let opened: Storage | null = null;
    void createStorage().then((created) => {
      if (cancelled) {
        created.close();
      } else {
        opened = created;
        setStorage(created);
        void refreshProjects(created);
      }
    });
    return () => {
      cancelled = true;
      opened?.close();
    };
  }, [injectedStorage]);

  /**
   * The navigation token (T45): a link create captures it before its slow title
   * lookup and navigates to the new project's page only if the user hasn't
   * already moved on. Bumped on every pathname change — an in-flight create
   * that lands behind a navigation the user made must save the project and let
   * them find it in the list, never yank them off the page they chose.
   */
  const navigateTokenRef = useRef(0);
  // Bumped on every pathname change — a slow create reads it before it lands.
  useEffect(() => {
    navigateTokenRef.current += 1;
  }, [location.pathname]);

  /** Starts the Google OAuth flow; the session lands when the flow returns. */
  function handleSignIn(): void {
    void authRef.current?.signInWithGoogle();
  }

  /** Ends the session; the app returns to anonymous browsing. */
  function handleSignOut(): void {
    void authRef.current?.signOut();
  }

  /** Deletes the contributor's account and its label sets (T26). */
  function handleDeleteAccount(): void {
    void authRef.current?.deleteAccount();
  }

  /**
   * The project page's exit channel (T45): when a page unmounts (browser Back,
   * a navbar link, a swap to another project page), it reports the final flush's
   * result, and the shell restores the workspace's save line and re-reads the
   * list — a duration learned during the visit is persisted before the list
   * reads it, so the workspace never shows stale data.
   */
  function handleExitStatus(status: SaveStatus): void {
    setStatus(status);
    if (storage !== null) void refreshProjects(storage);
  }

  return (
    <main>
      <Navbar
        authState={authState}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
        onDeleteAccount={handleDeleteAccount}
      />
      <div className="page-rail app-page">
        <Routes>
          {/* The front door (T50): the public gallery, or the honest "not
              wired up" screen when the deployment carries no Supabase config. */}
          <Route
            path="/"
            element={
              projectsApi !== null ? (
                <GalleryScreen api={projectsApi} />
              ) : (
                <NotWiredUp />
              )
            }
          />
          {/* The owner's workspace lives at /projects (T50) — still the
              legacy IndexedDB projects until the write side moves server-side. */}
          <Route
            path="/projects"
            element={
              storage !== null ? (
                <WorkspaceScreen
                  storage={storage}
                  projects={projects}
                  status={status}
                  notice={notice}
                  onStatus={setStatus}
                  onNotice={setNotice}
                  refreshProjects={refreshProjects}
                  fetchTitle={fetchTitle}
                  loadCommunityLabels={loadCommunityLabels}
                  authState={authState}
                  onSignIn={handleSignIn}
                  commonsWrite={commonsWriteRef.current}
                  getNavigateToken={() => navigateTokenRef.current}
                  workingRef={workingRef}
                  linkError={linkError}
                  onLinkError={setLinkError}
                  creatingFromLink={creatingFromLink}
                  onCreatingFromLink={setCreatingFromLink}
                  commonsRows={commonsRows}
                  onCommonsRows={setCommonsRows}
                  submittingId={submittingId}
                  onSubmittingId={setSubmittingId}
                />
              ) : null
            }
          />
          <Route path="/help" element={<HelpTab />} />
          <Route
            path="/projects/:id"
            element={
              storage !== null ? (
                <ProjectPage
                  storage={storage}
                  controllerFactory={controllerFactory}
                  onExitStatus={handleExitStatus}
                  onNotice={setNotice}
                />
              ) : null
            }
          />
          {/* The read-only view over a published public project (T50), or the
              "not wired up" screen without a backend to read from. */}
          <Route
            path="/gallery/:id"
            element={
              projectsApi !== null ? (
                <PublicProjectView
                  api={projectsApi}
                  controllerFactory={controllerFactory}
                />
              ) : (
                <NotWiredUp />
              )
            }
          />
          {/* A URL nobody recognises lands on the front door, the gallery (T44). */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </main>
  );
}

export default App;
