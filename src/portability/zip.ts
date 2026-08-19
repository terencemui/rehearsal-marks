import { strToU8, unzipSync, zipSync } from 'fflate';

/**
 * The zip mechanics of project export/import: one data file plus the audio
 * bytes. Entries are stored uncompressed (audio is already compressed, and
 * deflating it again only burns CPU). fflate does not verify CRC32 on read —
 * the import pipeline's sha256 gate is what catches corrupted audio, and a
 * corrupt deflate stream throws here.
 */

/** The data file's fixed path inside a project zip. */
export const PROJECT_JSON_PATH = 'project.json';

/** Builds the single-file zip export: project.json + the audio bytes. */
export async function buildProjectZip(
  projectJson: string,
  audio: Blob,
  audioFilename: string,
): Promise<Blob> {
  if (audioFilename === PROJECT_JSON_PATH) {
    // The two entries share one name inside the zip; exporting would silently
    // drop the project data. Refuse rather than produce a corrupt export.
    throw new Error(`Audio filename "${PROJECT_JSON_PATH}" collides with the project data file.`);
  }
  const files = {
    [PROJECT_JSON_PATH]: strToU8(projectJson),
    [audioFilename]: new Uint8Array(await audio.arrayBuffer()),
  };
  return new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' });
}

/** Reads every entry of a zip into memory, keyed by entry path. */
export async function readZipEntries(file: Blob): Promise<Map<string, Uint8Array>> {
  const data = new Uint8Array(await file.arrayBuffer());
  return new Map(Object.entries(unzipSync(data))); // throws on a corrupt zip
}
