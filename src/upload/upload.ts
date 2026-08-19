/**
 * The upload path: format validation and project creation from a picked file.
 * Pure validation and naming live here so the picker and the pipeline share
 * one source of truth; storage writes go through the injected `save`.
 */

import { decodePeaksOrNull } from '../audio';
import type { PeakData } from '../audio';
import { newId } from '../domain';
import { sha256 } from '../storage';
import type { ProjectRecord } from '../storage';

/** One row per format the picker must decide about. */
interface AudioFormat {
  /** Lowercase extensions that identify the format. */
  extensions: readonly string[];
  /** MIME types used when the extension is missing or unknown. */
  mimeTypes: readonly string[];
  /** The MIME type to record for extension-identified files lacking one. */
  mimeType?: string;
  /** Rejection guidance; absent for accepted formats. */
  guidance?: string;
}

const AUDIO_FORMATS: Record<'mp3' | 'm4a' | 'wav' | 'flac', AudioFormat> = {
  mp3: { extensions: ['mp3'], mimeTypes: ['audio/mpeg', 'audio/mp3'], mimeType: 'audio/mpeg' },
  m4a: {
    extensions: ['m4a'],
    mimeTypes: ['audio/mp4', 'audio/x-m4a', 'audio/m4a'],
    mimeType: 'audio/mp4',
  },
  wav: {
    extensions: ['wav', 'wave'],
    mimeTypes: ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'],
    guidance:
      'WAV files aren’t supported yet — convert to MP3 or M4A and try again ' +
      '(e.g. ffmpeg -i recording.wav -b:a 192k recording.mp3).',
  },
  flac: {
    extensions: ['flac'],
    mimeTypes: ['audio/flac', 'audio/x-flac'],
    guidance:
      'FLAC files aren’t supported yet — convert to MP3 or M4A and try again ' +
      '(e.g. ffmpeg -i recording.flac -b:a 192k recording.mp3).',
  },
};

/** A known format that matches the extension, or the MIME type, or nothing. */
function formatFor(file: { name: string; type: string }): AudioFormat | undefined {
  const extension = extensionOf(file.name);
  const byExtension = extension === null ? undefined : formatByExtension(extension);
  if (byExtension !== undefined) return byExtension;
  // Only extensionless files fall back to their MIME type. Any present
  // extension that isn't mp3/m4a is judged by name alone, so a video
  // container can't ride in on an audio MIME type.
  if (extension === null) return formatByMimeType(file.type.toLowerCase());
  return undefined;
}

function formatByExtension(extension: string): AudioFormat | undefined {
  return Object.values(AUDIO_FORMATS).find((format) => format.extensions.includes(extension));
}

function formatByMimeType(mimeType: string): AudioFormat | undefined {
  return Object.values(AUDIO_FORMATS).find((format) => format.mimeTypes.includes(mimeType));
}

/**
 * Why a file cannot be uploaded, as the guidance shown to the user; `null`
 * when the file is accepted. A present extension decides (so a `.mp4` video
 * can't sail through on an audio MIME type); only extensionless files fall
 * back to their MIME type. WAV and FLAC get their own conversion guidance,
 * everything else a plain "only MP3/M4A" note.
 */
export function uploadRejection(file: { name: string; type: string }): string | null {
  const format = formatFor(file);
  if (format?.guidance) return format.guidance;
  if (format === undefined) {
    return 'Only MP3 and M4A files are supported. Convert your recording and try again.';
  }
  return null;
}

/** The MIME type an extension-identified file should be recorded under. */
export function mimeTypeFor(file: { name: string; type: string }): string {
  return file.type || formatFor(file)?.mimeType || '';
}

/** The project's default name: the filename minus its extension. */
export function projectNameFromFile(filename: string): string {
  const stripped = filename.replace(/\.[^.]+$/, '');
  return stripped === '' ? filename : stripped;
}

/** Everything the pipeline needs from outside itself, injectable in tests. */
export interface UploadDependencies {
  extractPeaks: (blob: Blob, columns?: number) => Promise<PeakData>;
  save: (record: ProjectRecord) => Promise<void>;
  now?: () => number;
}

export type UploadOutcome =
  | { ok: true; project: ProjectRecord; peaks: PeakData | null }
  | { ok: false; guidance: string };

/**
 * Turns a picked file into a persisted project: validates the format, runs the
 * single decode pass for peaks (a decode failure only means no waveform — the
 * project is still created), computes recording identity, and saves. An
 * unsupported format returns guidance and writes nothing; storage failures
 * propagate to the caller.
 */
export async function createProjectFromUpload(
  file: File,
  { extractPeaks, save, now = Date.now }: UploadDependencies,
): Promise<UploadOutcome> {
  const rejection = uploadRejection(file);
  if (rejection !== null) return { ok: false, guidance: rejection };

  const peaks = await decodePeaksOrNull(extractPeaks, file);

  const createdAt = now();
  const project: ProjectRecord = {
    id: newId(),
    name: projectNameFromFile(file.name),
    createdAt,
    updatedAt: createdAt,
    source: 'upload',
    audio: file,
    audioMeta: {
      sha256: await sha256(file),
      duration: peaks?.duration ?? 0,
      mimeType: mimeTypeFor(file),
      filename: file.name,
      sizeBytes: file.size,
      source: '',
      license: '',
      attribution: '',
    },
    markers: [],
    // Uploads open in Label mode: creating a project to mark it.
    playerMode: 'label',
  };
  await save(project);
  return { ok: true, project, peaks };
}

function extensionOf(filename: string): string | null {
  const match = /\.([^.]+)$/.exec(filename);
  return match ? match[1].toLowerCase() : null;
}
