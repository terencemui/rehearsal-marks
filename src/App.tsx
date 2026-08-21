import { useEffect, useRef, useState } from 'react';
import { createAudioController } from './audio';
import type { AudioController } from './audio';
import { createDefaultAuthController } from './auth';
import type { AuthController, AuthState } from './auth';
import { CommonsError } from './commons/errors';
import { labelSetValuesFromProjectFile } from './commons/labelSet';
import type { LabelSetRow } from './commons/labelSet';
import { readCommonsConfig } from './commons/load';
import { createDefaultCommonsWrite } from './commons/write';
import type { CommonsWriteController } from './commons/write';
import { projectFileFromRecord } from './commons/labelSet';
import { validateProjectName } from './projects/summary';
import { createAutosave, createStorage, saveStatusFor, StorageError } from './storage';
import type { Autosave, ProjectRecord, ProjectSummary, SaveStatus, Storage } from './storage';
import { createProjectFromYouTubeLink, fetchYouTubeTitle, loadCommunityLabelSet } from './youtube';
import type { CommunityLabelSet } from './youtube/community';
import { ContributorControl } from './ui/Contributor';
import { CreateProject } from './ui/CreateProject';
import { HelpTab } from './ui/HelpTab';
import { Player } from './ui/Player';
import { ProjectsScreen } from './ui/ProjectsScreen';
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
}

/** One open project session: the autosave and its controller. */
interface Session {
  autosave: Autosave;
  controller: AudioController;
}

type Tab = 'projects' | 'help';

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

/** The submissions list as a lookup by project id — the badges' source. */
function rowsById(rows: LabelSetRow[]): Record<string, LabelSetRow> {
  return Object.fromEntries(rows.map((row) => [row.id, row]));
}

/**
 * The app shell: the Projects tab is home — the link-only create, the list,
 * rename, and delete; Help is the discoverable reference. Opening a project
 * drops into the player; leaving flushes the session's autosave before the
 * list is re-read, so the workspace never shows stale data.
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
}: AppProps = {}) {
  const [storage, setStorage] = useState<Storage | null>(injectedStorage ?? null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [tab, setTab] = useState<Tab>('projects');
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [notice, setNotice] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  /**
   * The link field's own failure channel: the create surface shows each
   * rejection beside the input that caused it.
   */
  const [linkError, setLinkError] = useState<string | null>(null);
  const [creatingFromLink, setCreatingFromLink] = useState(false);
  /** The contributor session — the header's sign-in state. Anonymous first paint. */
  const [authState, setAuthState] = useState<AuthState>({ kind: 'anonymous' });
  /**
   * The signed-in contributor's Commons rows by project id — the row badges'
   * source, refreshed on every sign-in and every submission. Null while
   * signed out (no rows exist to show).
   */
  const [commonsRows, setCommonsRows] = useState<Record<string, LabelSetRow> | null>(null);
  /** The row whose Commons submission runs, if any — rows are inert then. */
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  /**
   * Serializes session creation and every workspace mutation (upload, open,
   * rename, delete). These are one-at-a-time user actions, and the
   * alternative — an open racing a rename or a fresh upload racing an open —
   * silently reverts or hides the loser's data.
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
  /** Bumped whenever the tab changes; an in-flight open checks it before committing. */
  const openTokenRef = useRef(0);

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
  // failure surfaced, never a crash.
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

  useEffect(() => {
    // Mount and every tab switch invalidate an in-flight open: the player
    // must never yank the user off a tab they navigated to while a read
    // was still running.
    openTokenRef.current += 1;
  }, [tab]);

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
   * Submits (or re-submits) a YouTube project's label set to the Commons —
   * the moderation gate's intake. A signed-out contributor is routed to
   * sign-in first: contributing prompts Sign in with Google, viewing never
   * requires one. The submission lands `pending` (or `published` for a
   * contributor with a track record — the server decides, and the badges
   * refresh from its answer).
   */
  async function handleSubmitToCommons(id: string): Promise<void> {
    if (authState.kind !== 'signed-in') {
      setNotice('Sign in with Google to submit your label set.');
      void authRef.current?.signInWithGoogle();
      return;
    }
    if (storage === null || workingRef.current) return;
    workingRef.current = true;
    setSubmittingId(id);
    setNotice(null);
    try {
      const record = await storage.projects.get(id);
      if (record === undefined) {
        // A stale row (another tab deleted it) — quietly re-sync the list.
        await refreshProjects(storage);
        return;
      }
      const commons = commonsWriteRef.current;
      if (commons === null) return;
      await commons.submit(
        labelSetValuesFromProjectFile(projectFileFromRecord(record)),
        commonsRows?.[id],
      );
      setNotice(
        commonsRows?.[id] !== undefined
          ? 'Submission updated.'
          : 'Submitted to the Commons.',
      );
      setCommonsRows(rowsById(await commons.listMySubmissions()));
    } catch (error) {
      // A Commons rejection is its own message (rate limit, ban, a label set
      // the store will not hold); everything else is the transport's failure.
      setNotice(
        error instanceof CommonsError
          ? error.message
          : 'Something went wrong submitting your label set. Please try again.',
      );
    } finally {
      workingRef.current = false;
      setSubmittingId(null);
    }
  }

  /**
   * The create surface's one input: a pasted YouTube link becomes a project
   * and opens the player session. Nothing decodes and nothing is hashed —
   * there is no audio here — so the whole path is the link rules plus one
   * title lookup.
   */
  async function handleLink(url: string): Promise<void> {
    if (storage === null || workingRef.current) return;
    workingRef.current = true;
    setLinkError(null);
    setCreatingFromLink(true);
    const controller = controllerFactory();
    const token = openTokenRef.current;
    try {
      const outcome = await createProjectFromYouTubeLink(url, {
        fetchTitle,
        loadCommunityLabels,
        save: (record) => storage.projects.save(record),
      });
      if (!outcome.ok) {
        // The controller never entered a session — release it.
        controller.destroy();
        setLinkError(outcome.guidance);
        return;
      }
      if (token !== openTokenRef.current) {
        // The user switched tabs while the title lookup ran (up to ten
        // seconds) — the project is saved and waiting in the list, but
        // yanking them off the tab they navigated to is not ours to do.
        controller.destroy();
        await refreshProjects(storage);
        return;
      }
      // A link create that lands is a fresh start for the surface.
      setSession({
        autosave: createAutosave(outcome.project, {
          save: (record) => storage.projects.save(record),
        }),
        controller,
      });
    } catch (error) {
      controller.destroy();
      setLinkError(
        error instanceof StorageError && error.code === 'storage-full'
          ? 'Browser storage is full — free up space, then try the link again.'
          : 'Something went wrong creating the project. Please try again.',
      );
    } finally {
      workingRef.current = false;
      setCreatingFromLink(false);
    }
  }

  /** Reopens a stored project into the ruler-only player. */
  async function openProject(id: string): Promise<void> {
    if (storage === null || session !== null || workingRef.current) return;
    workingRef.current = true;
    setOpeningId(id);
    setNotice(null);
    const token = openTokenRef.current;
    try {
      const record = await storage.projects.get(id);
      if (record === undefined) {
        // A stale row (another tab deleted it) — quietly re-sync the list.
        await refreshProjects(storage);
        return;
      }
      const controller = controllerFactory();
      if (token !== openTokenRef.current) {
        // The user switched tabs while the read ran — drop the open.
        controller.destroy();
        return;
      }
      setSession({
        autosave: createAutosave(record, { save: (next) => storage.projects.save(next) }),
        controller,
      });
    } catch {
      setNotice("Couldn't open that project. Try again.");
    } finally {
      workingRef.current = false;
      setOpeningId(null);
    }
  }

  /** Back from the player: settle pending writes, then re-read the list. */
  async function closeSession(): Promise<void> {
    if (session === null || storage === null) return;
    // Settles before the player unmounts, so its teardown flush is a no-op
    // and the list below reads the final state. A failed final write must
    // still be heard — the workspace status line takes it over.
    let exitFailure: unknown = null;
    try {
      await session.autosave.flush();
    } catch (error) {
      exitFailure = error;
    }
    setSession(null);
    setTab('projects');
    setStatus(exitFailure === null ? 'idle' : saveStatusFor(exitFailure));
    await refreshProjects(storage);
  }

  async function renameProject(id: string, name: string): Promise<void> {
    if (storage === null || workingRef.current) return;
    workingRef.current = true;
    try {
      let record: ProjectRecord | undefined;
      try {
        record = await storage.projects.get(id);
      } catch {
        setNotice('Something went wrong reading that project. Please reload.');
        return;
      }
      if (record === undefined) {
        await refreshProjects(storage);
        return;
      }
      const validation = validateProjectName(name, record.name);
      if (!validation.ok) return;
      setStatus('saving');
      try {
        await storage.projects.save({ ...record, name: validation.name, updatedAt: Date.now() });
        setStatus('saved');
      } catch (error) {
        setStatus(saveStatusFor(error));
      }
      await refreshProjects(storage);
    } finally {
      workingRef.current = false;
    }
  }

  async function deleteProject(id: string): Promise<void> {
    if (storage === null || workingRef.current) return;
    workingRef.current = true;
    try {
      setStatus('saving');
      try {
        await storage.projects.remove(id);
        setStatus('saved');
      } catch {
        // A delete is not a save — report it as its own thing rather than
        // through the save vocabulary (whose storage-full branch can never
        // fire here: deletes consume no quota).
        setStatus('idle');
        setNotice('Something went wrong deleting the project. Try again.');
      }
      await refreshProjects(storage);
    } finally {
      workingRef.current = false;
    }
  }

  // Every workspace pipeline holds the working lock while it runs; each
  // control must be disabled across all of them, or an action made mid-flight
  // is silently dropped by the lock guard.
  const workspaceBusy = creatingFromLink || openingId !== null;

  if (session !== null) {
    return (
      // Keyed by project: a fresh recording must start a fresh player — the
      // zoom level, marker state, and selection are per-session, never
      // carried across recordings.
      <Player
        key={session.autosave.get().id}
        autosave={session.autosave}
        controller={session.controller}
        onExit={() => void closeSession()}
      />
    );
  }

  return (
    <main>
      <header className="app-header">
        <div>
          <h1>Rehearsal Marks</h1>
          <p>Pin your score's rehearsal marks to your recording.</p>
        </div>
        <ContributorControl
          state={authState}
          onSignIn={handleSignIn}
          onSignOut={handleSignOut}
          onDeleteAccount={handleDeleteAccount}
        />
      </header>
      <div role="tablist" aria-label="Workspace" className="tabs">
        <button type="button" role="tab" aria-selected={tab === 'projects'} onClick={() => setTab('projects')}>
          Projects
        </button>
        <button type="button" role="tab" aria-selected={tab === 'help'} onClick={() => setTab('help')}>
          Help
        </button>
      </div>
      {tab === 'projects' && storage !== null && (
        <>
          <CreateProject
            onLink={(url) => void handleLink(url)}
            onLinkEdit={() => setLinkError(null)}
            linkError={linkError}
            busy={workspaceBusy}
            creatingFromLink={creatingFromLink}
          />
          <ProjectsScreen
            projects={projects}
            status={status}
            openingId={openingId}
            notice={notice}
            busy={workspaceBusy}
            onOpen={(id) => void openProject(id)}
            onRename={(id, name) => void renameProject(id, name)}
            onDelete={(id) => void deleteProject(id)}
            authKind={authState.kind}
            commonsRows={commonsRows}
            submittingId={submittingId}
            onSubmitToCommons={(id) => void handleSubmitToCommons(id)}
            onSignIn={handleSignIn}
          />
        </>
      )}
      {tab === 'help' && <HelpTab />}
    </main>
  );
}

export default App;
