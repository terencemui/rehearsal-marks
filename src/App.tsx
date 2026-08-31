import { useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { createAudioController } from './audio';
import type { AudioController } from './audio';
import { createDefaultAuthController, readAuthEnv } from './auth';
import type { AuthController, AuthState } from './auth';
import { createDefaultProjectsApi } from './projects/api';
import type { ProjectsApi } from './projects/api';
import type { SaveStatus } from './projects/autosave';
import type { ProjectSummary } from './projects/types';
import { fetchYouTubeTitle } from './youtube';
import { HelpTab } from './ui/HelpTab';
import { LandingScreen } from './ui/LandingScreen';
import { Navbar } from './ui/Navbar';
import { NotWiredUpScreen } from './ui/NotWiredUpScreen';
import { ProjectPage } from './ui/ProjectPage';
import { WorkspaceScreen } from './ui/WorkspaceScreen';
import './ui/app.css';

export interface AppProps {
  /** Test seam: overrides the audio controller. */
  controllerFactory?: () => AudioController;
  /** Test seam: the video-title lookup, so component tests never touch the network. */
  fetchTitle?: (canonicalUrl: string) => Promise<string | null>;
  /** Test seam: the server-project surface, so component tests never build a supabase-js client. */
  projectsApiFactory?: () => ProjectsApi;
  /**
   * Test seam: the Google sign-in surface, so component tests never construct
   * a supabase-js client — the same containment the audio tests get from
   * faking `window.YT`.
   */
  authFactory?: () => AuthController;
}

/**
 * The app's env gate (T51): an unconfigured deployment — no Supabase project
 * wired up — renders the whole-app "not wired up" screen and builds no
 * controller, no auth client, no projects client. Everything that needs the
 * env lives in `WiredApp`, below, so this gate can render before any hook and
 * the two never violate the rules of hooks.
 */
export function App({
  controllerFactory,
  fetchTitle,
  projectsApiFactory,
  authFactory,
}: AppProps = {}) {
  if (readAuthEnv() === null) return <NotWiredUpScreen />;
  return (
    <WiredApp
      controllerFactory={controllerFactory}
      fetchTitle={fetchTitle}
      // createDefaultProjectsApi() returns null only when the env is
      // unconfigured — which App's gate has just ruled out — so the default
      // is non-null here.
      projectsApiFactory={projectsApiFactory ?? (() => createDefaultProjectsApi()!)}
      authFactory={authFactory}
    />
  );
}

export interface WiredAppProps {
  controllerFactory?: () => AudioController;
  fetchTitle?: (canonicalUrl: string) => Promise<string | null>;
  projectsApiFactory?: () => ProjectsApi;
  authFactory?: () => AuthController;
}

/**
 * The app shell (T43, T44, T45): owns the server-project surface, the auth
 * controller, and the workspace's durable state (the list, the save line, the
 * notices, the create surface's rejection and busy state — everything that
 * must survive the page surfaces' unmounts), and coordinates the three
 * separable modules — the workspace surface (create, list, rename, delete,
 * visibility), the help reference, and the routed project page. The app is
 * served by a history-mode router (T44): `/` is the Projects home (the
 * anonymous landing when signed out, the workspace when signed in), `/help`
 * the discoverable reference, `/projects/:id` the project page, and any
 * unknown path falls back to `/`. A persistent navbar — the app name, the
 * Projects and Help links with active states, and the user sign-in — renders
 * on every page, inside the shared page rail. Opening a project is navigation
 * now (T45): the page is its own session, restored by a refresh of its URL,
 * and browser Back — or a navbar link — is the exit, flushing the session's
 * pending autosave before the list is re-read, so the workspace never shows
 * stale data.
 */
function WiredApp({
  controllerFactory = createAudioController,
  fetchTitle = fetchYouTubeTitle,
  // Only reachable when App's env gate passed, so the API is never null here.
  projectsApiFactory = () => createDefaultProjectsApi()!,
  authFactory = createDefaultAuthController,
}: WiredAppProps = {}) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [status, setStatus] = useState<SaveStatus>('idle');
  /**
   * The routed page — the location is the shell's page: navigation swaps the
   * workspace surface for Help or a project page, and bumps the navigation
   * token that a slow create reads before it lands.
   */
  const location = useLocation();
  const [notice, setNotice] = useState<string | null>(null);
  /** The user session — the header's sign-in state and the home page's fork. Anonymous first paint. */
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
   * Serializes the workspace mutations (a link create, rename, delete,
   * visibility toggle). These are one-at-a-time user actions, and the
   * alternative — a rename racing a fresh create or a delete racing a rename —
   * silently reverts or hides the loser's data. (An open is instant navigation
   * now (T45): it holds no lock.)
   */
  const workingRef = useRef(false);
  /**
   * The session controller for the app's lifetime — created on mount,
   * destroyed on unmount. Auth state lives here in App state only: it never
   * touches the project surface, so signing in or out cannot disturb a
   * project being read.
   */
  const authRef = useRef<AuthController | null>(null);
  /** The server-project surface for the app's lifetime — created on mount like the auth controller. */
  const projectsApiRef = useRef<ProjectsApi | null>(null);

  /** Re-reads the workspace list; a failed read surfaces as a notice, never a rejection. */
  async function refreshProjects(): Promise<void> {
    const api = projectsApiRef.current;
    if (api === null) return;
    try {
      setProjects(await api.listMyProjects());
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
  // a re-rendering parent must not recycle the surface mid-mount. The
  // projects surface holds no subscriptions, so there is nothing to destroy;
  // it is dropped on unmount the same way.
  useEffect(() => {
    projectsApiRef.current = projectsApiFactory();
    return () => {
      projectsApiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only by design
  }, []);

  // The workspace list follows the session: loaded on every sign-in
  // (including a restored one), cleared on sign-out. The list is a
  // convenience — a failed read surfaces as a notice, never a crash. The rows
  // live here, not in the workspace surface, so they survive its unmounts.
  useEffect(() => {
    if (authState.kind !== 'signed-in') {
      setProjects([]);
      setStatus('idle');
      setNotice(null);
      return;
    }
    void refreshProjects();
  }, [authState.kind]);

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

  /** Ends the session; the app returns to the anonymous landing. */
  function handleSignOut(): void {
    void authRef.current?.signOut();
  }

  /** Deletes the signed-in user's account and its projects (T26). */
  function handleDeleteAccount(): void {
    void authRef.current?.deleteAccount();
  }

  /**
   * The project page's exit channel (T45): when a page unmounts (browser Back,
   * a navbar link, a swap to another project page), it reports the final flush's
   * result, and the shell restores the workspace's save line and re-reads the
   * list — an edit landed during the visit is persisted before the list reads
   * it, so the workspace never shows stale data. (Signed out, there is no list
   * to re-read — the landing owns the home page then.)
   */
  function handleExitStatus(exitStatus: SaveStatus): void {
    setStatus(exitStatus);
    if (authState.kind === 'signed-in') void refreshProjects();
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
          <Route
            path="/"
            element={
              // The signed-in home is the workspace; signed out, the landing.
              // The workspace needs the server surface, which the mount effect
              // creates before any signed-in paint — the null guard below is
              // the same "not ready" gate the storage-first shell had.
              authState.kind === 'signed-in' ? (
                projectsApiRef.current === null ? null : (
                  <WorkspaceScreen
                    projectsApi={projectsApiRef.current}
                    projects={projects}
                    status={status}
                    notice={notice}
                    onStatus={setStatus}
                    onNotice={setNotice}
                    refreshProjects={refreshProjects}
                    fetchTitle={fetchTitle}
                    getNavigateToken={() => navigateTokenRef.current}
                    workingRef={workingRef}
                    linkError={linkError}
                    onLinkError={setLinkError}
                    creatingFromLink={creatingFromLink}
                    onCreatingFromLink={setCreatingFromLink}
                  />
                )
              ) : (
                <LandingScreen onSignIn={handleSignIn} notice={notice} />
              )
            }
          />
          <Route path="/help" element={<HelpTab />} />
          <Route
            path="/projects/:id"
            element={
              projectsApiRef.current === null ? null : (
                <ProjectPage
                  projectsApi={projectsApiRef.current}
                  controllerFactory={controllerFactory}
                  onExitStatus={handleExitStatus}
                  onNotice={setNotice}
                />
              )
            }
          />
          {/* A URL nobody recognises lands on the Projects home (T44). */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </main>
  );
}

export default App;
