import { errorMessage, newId, parseProjectFile, parseYouTubeLink } from '../domain';
import type { Marker, ProjectFileData } from '../domain';
import { defaultPlayerMode, sha256 } from '../storage';
import type { ProjectRecord } from '../storage';
import { PROJECT_JSON_PATH, readZipEntries } from './zip';

/**
 * The inbound side of portability: zip imports that always create a fresh
 * project, and label-set imports gated on recording identity. Every failure
 * the user can cause comes back as guidance text, never a thrown error; only
 * storage failures propagate (the caller owns the save vocabulary).
 */

export interface ProjectImportDependencies {
  /** The workspace's current project names, for collision-free naming. */
  existingNames: readonly string[];
  save: (record: ProjectRecord) => Promise<void>;
  now?: () => number;
}

export type ProjectImportOutcome =
  | { ok: true; project: ProjectRecord }
  | { ok: false; guidance: string };

/**
 * Turns a project zip into a persisted project. The imported record always
 * gets a fresh id and timestamps — import can create, never overwrite. The
 * audio is verified against the file's claimed sha256, so a corrupted or
 * tampered zip fails here instead of importing a project whose stored
 * identity lies.
 */
export async function importProjectZip(
  file: Blob,
  { existingNames, save, now = Date.now }: ProjectImportDependencies,
): Promise<ProjectImportOutcome> {
  let entries: Map<string, Uint8Array>;
  try {
    entries = await readZipEntries(file);
  } catch {
    return { ok: false, guidance: 'This file isn’t a valid project zip.' };
  }

  const jsonBytes = entries.get(PROJECT_JSON_PATH);
  if (jsonBytes === undefined) {
    return {
      ok: false,
      guidance: 'This zip has no project.json — it isn’t a Rehearsal Marks export.',
    };
  }

  // parseProjectFile enforces the version policy (newer schema rejected,
  // unknown fields ignored) and every domain invariant; its messages are
  // already written for users.
  let data: ProjectFileData;
  try {
    data = parseProjectFile(new TextDecoder().decode(jsonBytes));
  } catch (error) {
    return { ok: false, guidance: errorMessage(error) };
  }

  // The data file and the audio share one namespace inside the zip; an audio
  // named like the data file could never round-trip, so refuse it up front.
  if (data.audioMeta.filename === PROJECT_JSON_PATH) {
    return {
      ok: false,
      guidance: `This zip’s audio file is named "${PROJECT_JSON_PATH}", which collides with the project data file.`,
    };
  }

  const audioBytes = entries.get(data.audioMeta.filename);
  if (audioBytes === undefined) {
    return {
      ok: false,
      guidance: `This zip is missing its audio file "${data.audioMeta.filename}".`,
    };
  }
  // The upload path refuses WAV and FLAC by name; the zip path has only the
  // bytes, so it sniffs them. A claimed hash says nothing about the format —
  // a smuggled WAV/FLAC would pass sha256 and store a project that can't play.
  const formatRejection = unsupportedAudioBytes(audioBytes);
  if (formatRejection !== null) {
    return { ok: false, guidance: formatRejection };
  }
  const audio = new Blob([audioBytes], { type: data.audioMeta.mimeType });
  // Hash the bytes directly — sha256 accepts a BufferSource — so the already
  // inflated audio is not copied through another Blob read.
  if ((await sha256(audioBytes)) !== data.audioMeta.sha256) {
    return {
      ok: false,
      guidance: 'The audio in this zip doesn’t match its project file — the file is corrupted.',
    };
  }

  const createdAt = now();
  const baseName = data.project.name.trim() === '' ? 'Imported project' : data.project.name;
  const project: ProjectRecord = {
    id: newId(), // a fresh identity — the file's id is never reused
    name: uniqueProjectName(existingNames, baseName),
    createdAt,
    updatedAt: createdAt,
    source: 'upload',
    audio,
    audioMeta: data.audioMeta,
    markers: data.markers,
    playerMode: 'label',
  };
  await save(project);
  return { ok: true, project };
}

/**
 * Imports a bare project JSON — the YouTube export format and the community
 * contribution format. A file marked YouTube becomes a full project pointing
 * at its video: no audio to bundle, no sha256 to verify (there is nothing to
 * hash — whether the video still plays is the player's honest failure state,
 * not an import gate). The URL is re-normalized to the canonical form, so a
 * hand-authored file in any accepted shape still lands on one identity.
 *
 * A file marked upload is a label set for a recording, not a project —
 * importing it here would create a project with no recording inside, so it
 * is pointed at the row's "Import labels" instead.
 */
export async function importProjectJson(
  file: Blob,
  { existingNames, save, now = Date.now }: ProjectImportDependencies,
): Promise<ProjectImportOutcome> {
  let data: ProjectFileData;
  try {
    data = parseProjectFile(await file.text());
  } catch (error) {
    return { ok: false, guidance: errorMessage(error) };
  }

  if (data.project.source !== 'youtube') {
    return {
      ok: false,
      guidance:
        'This JSON is a label set for an uploaded recording, not a project file. Use ' +
        '“Import labels” on that project’s row instead.',
    };
  }

  // The file names the video its project plays from. Anything that is not a
  // YouTube link would create a project that can never play — refuse it up
  // front rather than saving a dead project. Parsing also yields the
  // canonical form, which becomes the stored recording identity.
  let canonicalUrl: string;
  try {
    canonicalUrl = parseYouTubeLink(data.audioMeta.source).canonicalUrl;
  } catch {
    return {
      ok: false,
      guidance: 'This project file doesn’t name a valid YouTube video — its source is not a YouTube link.',
    };
  }

  const createdAt = now();
  const baseName = data.project.name.trim() === '' ? 'Imported project' : data.project.name;
  const project: ProjectRecord = {
    id: newId(), // a fresh identity — the file's id is never reused
    name: uniqueProjectName(existingNames, baseName),
    createdAt,
    updatedAt: createdAt,
    source: 'youtube',
    // The app never holds YouTube audio: no blob, no bytes, no hash.
    audio: null,
    audioMeta: { ...data.audioMeta, source: canonicalUrl },
    markers: data.markers,
    // The source's own first-open rule: marks in hand means practiceable
    // immediately (Playback); an empty file starts in Label.
    playerMode: defaultPlayerMode('youtube', data.markers.length),
  };
  await save(project);
  return { ok: true, project };
}

export type LabelSetImportOutcome =
  | { ok: true; markers: Marker[] }
  | { ok: false; guidance: string };

/**
 * Validates a label set against a recording's identity: the sha256 is the
 * hard gate — timestamps only line up on the recording they were made for.
 * The caller applies the returned markers; nothing is applied on mismatch.
 *
 * Label-set application is uploads-only: a YouTube-marked file names a video,
 * not a recording this project holds, so it is pointed at the project import
 * instead.
 */
export function importLabelSet(jsonText: string, recordingSha256: string): LabelSetImportOutcome {
  let data: ProjectFileData;
  try {
    data = parseProjectFile(jsonText);
  } catch (error) {
    return { ok: false, guidance: errorMessage(error) };
  }
  if (data.project.source === 'youtube') {
    return {
      ok: false,
      guidance:
        'This file is a YouTube project, not a label set for this recording. Import it with ' +
        '“Import project” instead — it becomes a fresh project pointing at its video.',
    };
  }
  if (data.audioMeta.sha256 !== recordingSha256) {
    return {
      ok: false,
      guidance:
        'This label set was made for a different recording — timestamps only line up on ' +
        'the recording they were made for, so it can’t be applied here.',
    };
  }
  return { ok: true, markers: data.markers };
}

/** The first free `base (n)` name, so import never clobbers an existing one. */
export function uniqueProjectName(existingNames: readonly string[], base: string): string {
  let name = base;
  for (let n = 2; existingNames.includes(name); n += 1) {
    name = `${base} (${n})`;
  }
  return name;
}

/**
 * The WAV and FLAC the upload path refuses by name, sniffed by magic bytes —
 * the same conversion guidance, so the import gate and the upload gate agree.
 */
export function unsupportedAudioBytes(bytes: Uint8Array): string | null {
  const startsWith = (magic: string) =>
    bytes.length >= magic.length &&
    String.fromCharCode(...bytes.subarray(0, magic.length)) === magic;
  if (startsWith('RIFF')) {
    return 'WAV files aren’t supported yet — convert to MP3 or M4A and try again ' +
      '(e.g. ffmpeg -i recording.wav -b:a 192k recording.mp3).';
  }
  if (startsWith('fLaC')) {
    return 'FLAC files aren’t supported yet — convert to MP3 or M4A and try again ' +
      '(e.g. ffmpeg -i recording.flac -b:a 192k recording.mp3).';
  }
  return null;
}
