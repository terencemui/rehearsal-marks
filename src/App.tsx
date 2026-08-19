import { useEffect, useRef, useState } from 'react';
import { createAudioController, decodePeaksOrNull } from './audio';
import type { AudioController, PeakData } from './audio';
import { validateProjectName } from './projects/summary';
import { createAutosave, createStorage, saveStatusFor, StorageError } from './storage';
import type { Autosave, ProjectRecord, ProjectSummary, SaveStatus, Storage } from './storage';
import { createProjectFromUpload } from './upload';
import { HelpTab } from './ui/HelpTab';
import { Player } from './ui/Player';
import { ProjectsScreen } from './ui/ProjectsScreen';
import { UploadPicker } from './ui/UploadPicker';
import './ui/app.css';

export interface AppProps {
  /** Test seam: overrides the wavesurfer-backed controller. */
  controllerFactory?: () => AudioController;
  /** Test seam: an already-opened storage; the app opens its own when absent. */
  storage?: Storage;
}

/** One open project session: the autosave, its peaks, and its controller. */
interface Session {
  autosave: Autosave;
  peaks: PeakData | null;
  controller: AudioController;
}

type Tab = 'projects' | 'library' | 'help';

/**
 * The app shell: the Projects tab is home — the list, upload, rename,
 * delete, and reopen — with Help as the discoverable reference and Library
 * as a placeholder until its ticket lands. Opening a project (upload or
 * click) drops into the player; leaving flushes the session's autosave
 * before the list is re-read, so the workspace never shows stale data.
 */
function App({
  controllerFactory = createAudioController,
  storage: injectedStorage,
}: AppProps = {}) {
  const [storage, setStorage] = useState<Storage | null>(injectedStorage ?? null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [tab, setTab] = useState<Tab>('projects');
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [notice, setNotice] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  /**
   * Serializes session creation and every workspace mutation (upload, open,
   * rename, delete). These are one-at-a-time user actions, and the
   * alternative — an open racing a rename or a fresh upload racing an open —
   * silently reverts or hides the loser's data.
   */
  const workingRef = useRef(false);
  /** Bumped whenever the tab changes; an in-flight open checks it before committing. */
  const openTokenRef = useRef(0);
  /** Decoded peaks per project, so reopening never re-decodes an unchanged blob. */
  const peaksCacheRef = useRef(new Map<string, PeakData | null>());

  /** Re-reads the workspace list; a failed read surfaces as a notice, never a rejection. */
  async function refreshProjects(source: Storage): Promise<void> {
    try {
      setProjects(await source.projects.list());
    } catch {
      setNotice('Something went wrong reading the project list. Please reload.');
    }
  }

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
    // must never yank the user off a tab they navigated to while a decode
    // was still running.
    openTokenRef.current += 1;
  }, [tab]);

  async function handleFile(file: File): Promise<void> {
    if (storage === null || workingRef.current) return;
    workingRef.current = true;
    setUploadError(null);
    setUploading(true);
    const controller = controllerFactory();
    try {
      const outcome = await createProjectFromUpload(file, {
        extractPeaks: (blob) => controller.extractPeaks(blob),
        save: (record) => storage.projects.save(record),
      });
      if (!outcome.ok) {
        // The controller never entered a session — release it.
        controller.destroy();
        setUploadError(outcome.guidance);
        return;
      }
      peaksCacheRef.current.set(outcome.project.id, outcome.peaks);
      setSession({
        autosave: createAutosave(outcome.project, {
          save: (record) => storage.projects.save(record),
        }),
        peaks: outcome.peaks,
        controller,
      });
    } catch (error) {
      // The first save is the one storage write outside the player's status
      // line — surface its failures honestly instead of a silent unhandled
      // rejection. The controller never entered a session — release it.
      controller.destroy();
      setUploadError(
        error instanceof StorageError && error.code === 'storage-full'
          ? 'Browser storage is full — free up space, then import again.'
          : 'Something went wrong importing your recording. Please try again.',
      );
    } finally {
      workingRef.current = false;
      setUploading(false);
    }
  }

  /** Reopens a stored project: peaks re-decode, a decode failure means ruler-only. */
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
      let peaks = peaksCacheRef.current.get(id);
      if (peaks === undefined) {
        try {
          peaks = await decodePeaksOrNull((blob) => controller.extractPeaks(blob), record.audio);
          peaksCacheRef.current.set(id, peaks);
        } catch (error) {
          controller.destroy();
          throw error;
        }
      }
      if (token !== openTokenRef.current) {
        // The user switched tabs while the decode ran — drop the open.
        controller.destroy();
        return;
      }
      setSession({
        autosave: createAutosave(record, { save: (next) => storage.projects.save(next) }),
        peaks,
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
        peaksCacheRef.current.delete(id);
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

  if (session !== null) {
    return (
      // Keyed by project: a fresh recording must start a fresh player — the
      // zoom level, marker state, and selection are per-session, never
      // carried across recordings.
      <Player
        key={session.autosave.get().id}
        autosave={session.autosave}
        peaks={session.peaks}
        controller={session.controller}
        onExit={() => void closeSession()}
      />
    );
  }

  return (
    <main>
      <h1>Rehearsal Marks</h1>
      <p>Pin your score's rehearsal marks to your recording.</p>
      <div role="tablist" aria-label="Workspace" className="tabs">
        <button type="button" role="tab" aria-selected={tab === 'projects'} onClick={() => setTab('projects')}>
          Projects
        </button>
        <button type="button" role="tab" aria-selected={tab === 'library'} onClick={() => setTab('library')}>
          Library
        </button>
        <button type="button" role="tab" aria-selected={tab === 'help'} onClick={() => setTab('help')}>
          Help
        </button>
      </div>
      {tab === 'projects' && storage !== null && (
        <>
          <UploadPicker
            onFile={handleFile}
            error={uploadError}
            busy={uploading || openingId !== null}
          />
          <ProjectsScreen
            projects={projects}
            status={status}
            openingId={openingId}
            notice={notice}
            onOpen={(id) => void openProject(id)}
            onRename={(id, name) => void renameProject(id, name)}
            onDelete={(id) => void deleteProject(id)}
            onBrowseLibrary={() => setTab('library')}
          />
        </>
      )}
      {tab === 'library' && (
        <section>
          <h2>Library</h2>
          <p>The community library arrives in a later update.</p>
        </section>
      )}
      {tab === 'help' && <HelpTab />}
    </main>
  );
}

export default App;
