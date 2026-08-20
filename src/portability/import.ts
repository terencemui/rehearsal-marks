import { errorMessage, newId, parseProjectFile, youtubeAudioMeta } from '../domain';
import type { Marker, ProjectFileData } from '../domain';
import { defaultPlayerMode, sha256 } from '../storage';
import type { ProjectRecord } from '../storage';
import { PROJECT_JSON_PATH, readZipEntries } from './zip';

/**
 * The inbound side of portability: zip imports for uploads and bare JSON
 * imports for YouTube — both always create a fresh project — plus label-set
 * imports gated on recording identity. Every failure the user can cause
 * comes back as guidance text, never a thrown error; only storage failures
 * propagate (the caller owns the save vocabulary).
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

  // The zip path is the upload path. A YouTube-marked project file inside a
  // zip can only be hand-made — this app's YouTube export is bare JSON, and
  // a YouTube project has no audio for the zip's sha256 gate to verify.
  if (data.project.source === 'youtube') {
    return {
      ok: false,
      guidance:
        'This zip contains a YouTube project file. YouTube projects carry no audio — they export as a single JSON file, not a zip.',
    };
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
 * Turns a bare project-JSON file into a persisted project. A file marked
 * YouTube becomes a brand-new YouTube project pointing at its canonical URL:
 * a fresh id and timestamps — import can create, never overwrite — and no
 * sha256 gate, since there is no audio to verify; the file's media claims
 * are dropped rather than validated. An upload-shaped file has no audio
 * alongside it and cannot become a project; those files are label sets,
 * applied through importLabelSet.
 */
export async function importProjectJson(
  file: Blob,
  { existingNames, save, now = Date.now }: ProjectImportDependencies,
): Promise<ProjectImportOutcome> {
  // parseProjectFile enforces the version policy and every domain invariant,
  // including that a YouTube-marked file carries its canonical URL — any
  // accepted link form is normalized to the canonical form there, so the
  // stored recording identity is exactly one form.
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

  const createdAt = now();
  const baseName = data.project.name.trim() === '' ? 'Imported project' : data.project.name;
  const project: ProjectRecord = {
    id: newId(), // a fresh identity — the file's id is never reused
    name: uniqueProjectName(existingNames, baseName),
    createdAt,
    updatedAt: createdAt,
    source: 'youtube',
    // The app never holds YouTube audio: no blob, no bytes, no hash — the
    // canonical URL in audioMeta.source carries the recording identity.
    // Parsing already normalized any accepted link form to the canonical
    // URL, so the stored identity is exactly one form.
    audio: null,
    // What the file claims about stored bytes is dropped, not validated:
    // there are no bytes to hash or describe. What applies carries through —
    // the canonical URL, the known duration, and the title. The same shared
    // rule the exporter uses, so the two directions cannot drift apart.
    audioMeta: youtubeAudioMeta(data.audioMeta),
    markers: data.markers,
    // The source's own rule decides the posture: a file that arrives with
    // marks opens in Playback, ready to practise.
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
 * Label-set application is uploads-only: a YouTube-marked file has no hash
 * to gate on, and a YouTube project has no hash to gate against — for both,
 * the sha256 gate is trivially satisfied and marks from a different
 * performance would land silently, so both are refused up front. The caller
 * applies the returned markers; nothing is applied on any refusal.
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
  if (recordingSha256 === '') {
    return {
      ok: false,
      guidance:
        'Label sets apply only to uploaded recordings — a YouTube project has no recording ' +
        'hash to match one against, so it can’t be applied here.',
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
