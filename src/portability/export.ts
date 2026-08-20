import { serializeProjectFile, youtubeAudioMeta } from '../domain';
import type { ProjectFileData } from '../domain';
import type { ProjectRecord } from '../storage';
import { buildProjectZip } from './zip';

/**
 * The outbound side of portability: full-project zips for uploads, bare
 * project JSON for YouTube (no audio to bundle), and label-set-only JSON —
 * all derived from the same stored record and the same serialization.
 */

/** The record's data fields, as the project-file format wants them. */
function fileData(record: ProjectRecord): ProjectFileData {
  return {
    project: {
      id: record.id,
      name: record.name,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      source: record.source,
    },
    markers: record.markers,
    // A YouTube file carries the recording identity that applies — the
    // canonical URL, the known duration, and the title — and leaves empty
    // everything that describes stored bytes, whatever the record carries.
    audioMeta: record.source === 'youtube' ? youtubeAudioMeta(record.audioMeta) : record.audioMeta,
  };
}

/** The full project as one zip: project.json + the audio file. */
export async function exportProjectZip(record: ProjectRecord): Promise<Blob> {
  // A YouTube project has no audio to bundle, so a zip export is impossible.
  // Callers are expected to check the source and offer the label-set export
  // instead — this is the backstop that keeps a missed check loud.
  if (record.audio === null) {
    throw new Error('A YouTube project has no audio to bundle into a zip.');
  }
  return buildProjectZip(exportLabelSetJson(record), record.audio, record.audioMeta.filename);
}

/**
 * The label-set-only export — the community contribution format. Bare
 * `project.json` carrying recording identity, so a reviewer can audit the
 * set and the app can verify it against the right recording on import.
 * For a YouTube record this same file doubles as the full project export.
 */
export function exportLabelSetJson(record: ProjectRecord): string {
  return serializeProjectFile(fileData(record));
}

/**
 * The YouTube full-project export: the same bare project JSON as the label
 * set — there is no audio to bundle, so no zip, and the file doubles as the
 * community contribution format. The guard keeps a missed source check loud:
 * an uploaded record's audio would otherwise be silently dropped.
 */
export function exportProjectJson(record: ProjectRecord): string {
  if (record.source !== 'youtube') {
    throw new Error('An uploaded project has audio to bundle — its export is the zip, not bare JSON.');
  }
  return exportLabelSetJson(record);
}

/** Windows routes these exact basenames (case-insensitive, before the first dot) to devices, not files. */
const RESERVED_DOWNLOAD_BASE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * A project name safe to use as a download filename: path separators,
 * reserved characters, and control characters become spaces, trailing dots
 * are stripped (Windows would refuse the download otherwise), the result is
 * capped well under the filesystem path limits (Windows' 260-char MAX_PATH
 * minus the download directory, plus room for the extension), and Windows
 * device names fall back to "project" — 'CON.zip' would otherwise route to
 * the console device and the download would silently land nowhere.
 */
export function sanitizeDownloadName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\p{Cc}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
    .replace(/\.+$/, '');
  if (cleaned === '') return 'project';
  return RESERVED_DOWNLOAD_BASE.test(cleaned.split('.')[0]) ? 'project' : cleaned;
}
