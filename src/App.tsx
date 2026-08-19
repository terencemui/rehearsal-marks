import { useEffect, useState } from 'react';
import { createAudioController } from './audio';
import type { AudioController, PeakData } from './audio';
import { createStorage, StorageError } from './storage';
import type { ProjectRecord, Storage } from './storage';
import { createProjectFromUpload } from './upload';
import { Player } from './ui/Player';
import { UploadPicker } from './ui/UploadPicker';

export interface AppProps {
  /** Test seam: overrides the wavesurfer-backed controller. */
  controllerFactory?: () => AudioController;
  /** Test seam: an already-opened storage; the app opens its own when absent. */
  storage?: Storage;
}

/** One open project session: the record, its peaks, and its controller. */
interface Session {
  project: ProjectRecord;
  peaks: PeakData | null;
  controller: AudioController;
}

/**
 * App shell for the first vertical: upload a recording and land in the player.
 * A picked file runs the upload pipeline (validate → decode → persist) and the
 * session takes over the screen; rejections show guidance and store nothing.
 */
function App({
  controllerFactory = createAudioController,
  storage: injectedStorage,
}: AppProps = {}) {
  const [storage, setStorage] = useState<Storage | null>(injectedStorage ?? null);
  const [session, setSession] = useState<Session | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (injectedStorage) return;
    let cancelled = false;
    let opened: Storage | null = null;
    void createStorage().then((created) => {
      if (cancelled) {
        created.close();
      } else {
        opened = created;
        setStorage(created);
      }
    });
    return () => {
      cancelled = true;
      opened?.close();
    };
  }, [injectedStorage]);

  async function handleFile(file: File): Promise<void> {
    if (storage === null) return;
    setUploadError(null);
    setUploading(true);
    try {
      const controller = controllerFactory();
      const outcome = await createProjectFromUpload(file, {
        extractPeaks: (blob) => controller.extractPeaks(blob),
        save: (record) => storage.projects.save(record),
      });
      if (!outcome.ok) {
        setUploadError(outcome.guidance);
        return;
      }
      setSession({ project: outcome.project, peaks: outcome.peaks, controller });
    } catch (error) {
      // The first save is the one storage write outside the player's status
      // line — surface its failures honestly instead of a silent unhandled
      // rejection.
      setUploadError(
        error instanceof StorageError && error.code === 'storage-full'
          ? 'Browser storage is full — free up space, then import again.'
          : 'Something went wrong importing your recording. Please try again.',
      );
    } finally {
      setUploading(false);
    }
  }

  if (session !== null && storage !== null) {
    return (
      <Player
        record={session.project}
        peaks={session.peaks}
        controller={session.controller}
        storage={storage}
      />
    );
  }

  return (
    <main>
      <h1>Rehearsal Marks</h1>
      <p>Pin your score's rehearsal marks to your recording.</p>
      <UploadPicker onFile={handleFile} error={uploadError} busy={uploading} />
    </main>
  );
}

export default App;
