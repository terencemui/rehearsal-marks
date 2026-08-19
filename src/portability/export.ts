import { serializeProjectFile } from '../domain';
import type { ProjectFileData } from '../domain';
import type { ProjectRecord } from '../storage';
import { buildProjectZip } from './zip';

/**
 * The outbound side of portability: full-project zips and label-set-only
 * JSON, both derived from the same stored record and the same serialization.
 */

/** The record's data fields, as the project-file format wants them. */
function fileData(record: ProjectRecord): ProjectFileData {
  return {
    project: {
      id: record.id,
      name: record.name,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    },
    markers: record.markers,
    audioMeta: record.audioMeta,
  };
}

/** The full project as one zip: project.json + the audio file. */
export async function exportProjectZip(record: ProjectRecord): Promise<Blob> {
  return buildProjectZip(exportLabelSetJson(record), record.audio, record.audioMeta.filename);
}

/**
 * The label-set-only export — the community contribution format. Bare
 * `project.json` carrying recording identity, so a reviewer can audit the
 * set and the app can verify it against the right recording on import.
 */
export function exportLabelSetJson(record: ProjectRecord): string {
  return serializeProjectFile(fileData(record));
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
