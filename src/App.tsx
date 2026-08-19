import { useEffect, useMemo, useRef, useState } from 'react';
import { createAudioController, decodePeaksOrNull } from './audio';
import type { AudioController, PeakData } from './audio';
import { errorMessage } from './domain';
import { parseCatalog, resolveUrl } from './library/catalog';
import type { CatalogEntry } from './library/catalog';
import { LibraryError } from './library/errors';
import { downloadAndCache, fetchLabelset, seededProjectId, seedProject } from './library/load';
import { exportLabelSetJson, exportProjectZip, importLabelSet, importProjectZip, sanitizeDownloadName } from './portability';
import { validateProjectName } from './projects/summary';
import { createAutosave, createStorage, saveStatusFor, sha256, StorageError } from './storage';
import type { Autosave, ProjectRecord, ProjectSummary, SaveStatus, Storage } from './storage';
import { createProjectFromUpload } from './upload';
import { LibraryScreen } from './ui/LibraryScreen';
import { triggerDownload } from './ui/download';
import { HelpTab } from './ui/HelpTab';
import { ImportPicker } from './ui/ImportPicker';
import { Player } from './ui/Player';
import { ProjectsScreen } from './ui/ProjectsScreen';
import { UploadPicker } from './ui/UploadPicker';
import './ui/app.css';

export interface AppProps {
  /** Test seam: overrides the wavesurfer-backed controller. */
  controllerFactory?: () => AudioController;
  /** Test seam: an already-opened storage; the app opens its own when absent. */
  storage?: Storage;
  /** Test seam: captures downloads instead of handing them to the browser. */
  download?: (blob: Blob, filename: string) => void;
}

/** One open project session: the autosave, its peaks, and its controller. */
interface Session {
  autosave: Autosave;
  peaks: PeakData | null;
  controller: AudioController;
  /**
   * When set, the player streams this URL instead of the record's audio
   * blob — the library's first load, where playback must start while the
   * download still runs. The blob lands in the record behind the scenes.
   */
  streamUrl?: string | null;
  /** Replaces the player's ruler note (the library stream explains itself differently). */
  rulerNote?: string;
}

type Tab = 'projects' | 'library' | 'help';

/** The catalog manifest's path, resolved against where the app is served. */
const CATALOG_URL = new URL(import.meta.env.BASE_URL + 'library.json', window.location.href).toString();

/**
 * The streaming session's audio placeholder: playback runs off `streamUrl`,
 * so the record never reads this blob — it exists only so the record's
 * shape stays whole until the verified download replaces it. The deferred
 * save below guarantees it is never persisted.
 */
const EMPTY_BLOB = new Blob();

/**
 * The library's fetch surface, translating every network failure into the
 * LibraryError the tab surfaces. Catalog and label sets come back as text;
 * the audio comes back as a blob for hashing. Every fetch carries a
 * timeout: a request that never settles must not leave the tab loading
 * forever — or a streaming session's save waiting indefinitely.
 */
const TEXT_FETCH_TIMEOUT_MS = 15_000;
const AUDIO_FETCH_TIMEOUT_MS = 120_000;

async function fetchLibraryText(url: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(TEXT_FETCH_TIMEOUT_MS) });
  } catch {
    throw fetchFailure();
  }
  if (!response.ok) throw fetchFailure();
  return response.text();
}

async function fetchLibraryAudio(url: string): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(AUDIO_FETCH_TIMEOUT_MS) });
  } catch {
    throw fetchFailure();
  }
  if (!response.ok) throw fetchFailure();
  return response.blob();
}

function fetchFailure(): LibraryError {
  return new LibraryError(
    "The library couldn't be reached. Check your connection and try again.",
    'fetch-failed',
  );
}

/**
 * The app shell: the Projects tab is home — the list, upload, rename,
 * delete, export, and import. The Library tab (T11) lists the community
 * catalog and loads entries into editable projects; Help (T13) is the
 * discoverable reference. Opening a project (upload or click) drops into
 * the player; leaving flushes the session's autosave before the list is
 * re-read, so the workspace never shows stale data.
 */
function App({
  controllerFactory = createAudioController,
  storage: injectedStorage,
  download = triggerDownload,
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
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null);
  /**
   * The Library tab's failure channels, kept separate so one cannot wipe the
   * other: the catalog fetch owns `catalogNotice` (cleared on success),
   * loads own `libraryNotice` (cleared when a new load starts) — a failed
   * download's notice must survive later successful catalog fetches.
   */
  const [catalogNotice, setCatalogNotice] = useState<string | null>(null);
  const [libraryNotice, setLibraryNotice] = useState<string | null>(null);
  const [loadingEntryId, setLoadingEntryId] = useState<string | null>(null);
  /** Bumped by the catalog's retry button — refetches without a tab round-trip. */
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [importingZip, setImportingZip] = useState(false);
  const [importingLabelsId, setImportingLabelsId] = useState<string | null>(null);

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
  /**
   * Entries whose first-load download is still in flight. The guard keeps a
   * second Load — possible after the user exits the streaming session and
   * the seeded project does not exist yet — from running the whole first-
   * load flow again and seeding a duplicate once both downloads land.
   */
  const pendingLibrarySeedsRef = useRef(new Set<string>());

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

  // The Library tab fetches the manifest on every visit (normal HTTP caching
  // keeps repeat visits cheap, and a redeployed catalog shows up on the next
  // visit). A failure parks the tab in its error state; Retry bumps the
  // attempt counter to refetch without a tab round-trip.
  useEffect(() => {
    if (tab !== 'library' || storage === null) return;
    let cancelled = false;
    void fetchLibraryText(CATALOG_URL)
      .then((text) => parseCatalog(text))
      .then((entries) => {
        if (cancelled) return;
        setCatalog(entries);
        // A past catalog failure clears only once a fetch actually succeeds.
        setCatalogNotice(null);
      })
      .catch((error) => {
        if (!cancelled) setCatalogNotice(errorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [tab, storage, catalogAttempt]);

  /**
   * The "Loaded" join: entry audio URL → seeded project id. The match is
   * the recording's sha256 (the stable identity seeding stamps into the
   * project), so the join survives a catalog redeploy that moves the audio
   * URL — the same rule `loadLibraryEntry` applies before seeding.
   */
  const loadedProjects = useMemo(() => {
    const bySource = new Map<string, string>();
    if (catalog === null) return bySource;
    for (const entry of catalog) {
      const seededId = seededProjectId(projects, entry);
      if (seededId !== undefined) bySource.set(entry.audioUrl, seededId);
    }
    return bySource;
  }, [projects, catalog]);

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
      // Opens come from the Projects list and the Library tab's "Loaded —
      // Open" — the failure must reach whichever tab issued it.
      setNotice("Couldn't open that project. Try again.");
      setLibraryNotice("Couldn't open that project. Try again.");
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

  /**
   * Loads a library entry. An already-seeded entry just opens its project —
   * never a duplicate. A cached entry (a repeat load) seeds instantly and
   * offline from the verified cache. A first load streams the audio URL into
   * the player immediately while the download runs, verifies against the
   * catalog's sha256, caches it, and lets the seeded project gain the blob
   * behind the playing stream.
   */
  async function loadLibraryEntry(entry: CatalogEntry): Promise<void> {
    if (storage === null || workingRef.current) return;
    const seeded = seededProjectId(projects, entry);
    if (seeded !== undefined) {
      void openProject(seeded);
      return;
    }
    // A first-load download already in flight for this entry: its seed will
    // land on its own — a second run would seed a duplicate.
    if (pendingLibrarySeedsRef.current.has(entry.id)) return;
    workingRef.current = true;
    setLoadingEntryId(entry.id);
    // A fresh load attempt starts clean — an old failure must not stick to
    // a different entry's row.
    setLibraryNotice(null);
    const controller = controllerFactory();
    const token = openTokenRef.current;
    try {
      const cached = await storage.library.get(entry.id);
      if (cached !== undefined) {
        // Repeat load: the verified cache has audio + label set — instant,
        // and entirely offline: the cache is checked before any fetch, so
        // nothing here touches the network.
        const record = seedProject(entry, cached.labelset, cached.audio, Date.now());
        // Peaks first: a decode failure (the browser's AudioContext cap)
        // must not leave a seeded project behind with no session to show
        // for it — nothing is persisted unless the session can open.
        let peaks = peaksCacheRef.current.get(entry.id);
        if (peaks === undefined) {
          try {
            peaks = await decodePeaksOrNull((blob) => controller.extractPeaks(blob), record.audio);
          } catch (error) {
            controller.destroy();
            throw error;
          }
          peaksCacheRef.current.set(entry.id, peaks);
        }
        await storage.projects.save(record);
        // Cache under both keys: the record id for future opens, the entry
        // id so a later re-seed of the same recording skips the decode too.
        peaksCacheRef.current.set(record.id, peaks);
        if (token !== openTokenRef.current) {
          controller.destroy();
          return;
        }
        setSession({
          autosave: createAutosave(record, { save: (next) => storage.projects.save(next) }),
          peaks,
          controller,
        });
        await refreshProjects(storage);
        return;
      }
      // First load: the small label set comes down first — it is the entry's
      // markers and identity — then the player streams the URL now
      // (ruler-only: the waveform needs the blob's decode pass, which lands
      // next session). The record is provisional: its placeholder blob must
      // never be persisted, so every autosave write awaits the verified
      // download before touching storage — and reports "Saving…" honestly
      // while it waits, instead of claiming a save that never happened.
      pendingLibrarySeedsRef.current.add(entry.id);
      const labelsetUrl = resolveUrl(CATALOG_URL, entry.labelsetUrl);
      const labelset = await fetchLabelset({ ...entry, labelsetUrl }, fetchLibraryText);
      const provisional = seedProject(entry, labelset, EMPTY_BLOB, Date.now());
      let settleDownload: (audio: Blob) => void;
      let failDownload: (error: unknown) => void;
      const downloadOutcome = new Promise<Blob>((resolve, reject) => {
        settleDownload = resolve;
        failDownload = reject;
      });
      // A failed download with no pending save (the user never edited) must
      // not reject into the void as an unhandled rejection — the Library
      // notice is its report; the awaited-save path still sees the error.
      downloadOutcome.catch(() => {});
      const autosave = createAutosave(provisional, {
        save: async (record) => {
          // Pending until the download settles: on success the verified
          // blob is stamped in and the record persists; on failure every
          // pending write rejects, so the status line surfaces the error
          // instead of reporting edits that were never written.
          const audio = await downloadOutcome;
          await storage.projects.save({ ...record, audio });
        },
      });
      if (token !== openTokenRef.current) {
        controller.destroy();
        pendingLibrarySeedsRef.current.delete(entry.id);
        return;
      }
      setSession({
        autosave,
        peaks: null,
        controller,
        streamUrl: entry.audioUrl,
        rulerNote:
          'Streaming from the library — the waveform appears next time you open this recording.',
      });
      void downloadAndCache(entry, labelset, {
        fetchAudio: fetchLibraryAudio,
        sha256,
        saveCache: (cachedEntry) => storage.library.save(cachedEntry),
      })
        .then(async (audio) => {
          pendingLibrarySeedsRef.current.delete(entry.id);
          settleDownload(audio);
          // The player keeps streaming the URL; only the persisted record
          // gains the verified blob. Mutating the autosave writes it —
          // whether the session is still open or the user already left.
          autosave.mutate((record) => ({ ...record, audio }));
          await autosave.flush();
          await refreshProjects(storage);
        })
        .catch((error) => {
          pendingLibrarySeedsRef.current.delete(entry.id);
          failDownload(error);
          // The session (if any) keeps streaming; the seeded project just
          // never exists. The status line inside the player shows the error
          // through the rejected autosave write; this notice survives for
          // the Library tab.
          setLibraryNotice(errorMessage(error));
        });
    } catch (error) {
      controller.destroy();
      pendingLibrarySeedsRef.current.delete(entry.id);
      setLibraryNotice(
        error instanceof StorageError && error.code === 'storage-full'
          ? 'Browser storage is full — free up space, then try loading again.'
          : errorMessage(error),
      );
    } finally {
      workingRef.current = false;
      setLoadingEntryId(null);
    }
  }

  /** Imports a picked zip as a brand-new project — import can only create. */
  async function handleImportZip(file: File): Promise<void> {
    if (storage === null || workingRef.current) return;
    workingRef.current = true;
    setImportingZip(true);
    setNotice(null);
    try {
      // Names come from a fresh list read, not the render-closure state: the
      // workspace can be interactive before the first list resolves, and a
      // failed list read leaves the state stale — naming against either would
      // let an import duplicate an existing project's name.
      const names = (await storage.projects.list()).map((p) => p.name);
      const outcome = await importProjectZip(file, {
        existingNames: names,
        save: (record) => storage.projects.save(record),
      });
      if (!outcome.ok) {
        setNotice(outcome.guidance);
        return;
      }
      await refreshProjects(storage);
      // The import's write succeeded — clear any stale failure text left by
      // an earlier rename's save, exactly as renameProject's success does.
      setStatus('saved');
    } catch (error) {
      setNotice(
        error instanceof StorageError && error.code === 'storage-full'
          ? 'Browser storage is full — free up space, then import again.'
          : 'Something went wrong importing the project. Please try again.',
      );
    } finally {
      workingRef.current = false;
      setImportingZip(false);
    }
  }

  /** Downloads the full project as one zip — a read-only action, no working lock. */
  async function handleExport(id: string): Promise<void> {
    if (storage === null) return;
    setNotice(null);
    try {
      const record = await storage.projects.get(id);
      if (record === undefined) {
        // A stale row (another tab deleted it) — quietly re-sync the list.
        await refreshProjects(storage);
        return;
      }
      download(await exportProjectZip(record), `${sanitizeDownloadName(record.name)}.zip`);
    } catch {
      setNotice('Something went wrong exporting the project. Try again.');
    }
  }

  /** Downloads the label-set-only JSON — the community contribution format. */
  async function handleExportLabels(id: string): Promise<void> {
    if (storage === null) return;
    setNotice(null);
    try {
      const record = await storage.projects.get(id);
      if (record === undefined) {
        await refreshProjects(storage);
        return;
      }
      download(
        new Blob([exportLabelSetJson(record)], { type: 'application/json' }),
        `${sanitizeDownloadName(record.name)}.labels.json`,
      );
    } catch {
      setNotice('Something went wrong exporting the labels. Try again.');
    }
  }

  /** Applies a picked label set to one project, gated on recording identity. */
  async function handleImportLabels(id: string, file: File): Promise<void> {
    if (storage === null || workingRef.current) return;
    workingRef.current = true;
    setImportingLabelsId(id);
    setNotice(null);
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
      const outcome = importLabelSet(await file.text(), record.audioMeta.sha256);
      if (!outcome.ok) {
        setNotice(outcome.guidance);
        return;
      }
      setStatus('saving');
      try {
        await storage.projects.save({ ...record, markers: outcome.markers, updatedAt: Date.now() });
        setStatus('saved');
      } catch (error) {
        setStatus(saveStatusFor(error));
      }
      await refreshProjects(storage);
    } catch {
      // Everything user-caused is an outcome and every storage write has its
      // own branch; what lands here is the file read itself — still the user's
      // failure to see, never a silent unhandled rejection.
      setNotice('Something went wrong importing the label set. Please try again.');
    } finally {
      workingRef.current = false;
      setImportingLabelsId(null);
    }
  }

  // Every workspace pipeline holds the working lock while it runs; each picker
  // must be disabled across all of them, or a pick made mid-flight is silently
  // dropped by the lock guard.
  const workspaceBusy =
    uploading || openingId !== null || importingZip || importingLabelsId !== null;

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
        streamUrl={session.streamUrl}
        rulerNote={session.rulerNote}
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
          <UploadPicker onFile={handleFile} error={uploadError} busy={workspaceBusy} />
          <ImportPicker onFile={handleImportZip} busy={workspaceBusy} />
          <ProjectsScreen
            projects={projects}
            status={status}
            openingId={openingId}
            notice={notice}
            busy={workspaceBusy}
            onOpen={(id) => void openProject(id)}
            onRename={(id, name) => void renameProject(id, name)}
            onDelete={(id) => void deleteProject(id)}
            onExport={(id) => void handleExport(id)}
            onExportLabels={(id) => void handleExportLabels(id)}
            onImportLabels={(id, file) => void handleImportLabels(id, file)}
            importingLabelsId={importingLabelsId}
            onBrowseLibrary={() => setTab('library')}
          />
        </>
      )}
      {tab === 'library' &&
        (catalog === null ? (
          <section>
            <h2>Library</h2>
            {catalogNotice !== null ? (
              <>
                <p role="alert" className="library-notice">
                  {catalogNotice}
                </p>
                <button type="button" onClick={() => setCatalogAttempt((n) => n + 1)}>
                  Try again
                </button>
              </>
            ) : (
              <p>Loading the catalog…</p>
            )}
            {libraryNotice !== null && (
              <p role="alert" className="library-notice">
                {libraryNotice}
              </p>
            )}
          </section>
        ) : (
          <LibraryScreen
            entries={catalog}
            loadedProjects={loadedProjects}
            loadingId={loadingEntryId}
            notice={libraryNotice}
            onLoad={(entry) => void loadLibraryEntry(entry)}
            onOpen={(id) => void openProject(id)}
          />
        ))}
      {tab === 'help' && <HelpTab />}
    </main>
  );
}

export default App;
