import { describe, expect, it } from 'vitest';
import { buildProjectZip, PROJECT_JSON_PATH, readZipEntries } from './zip';

const audio = new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'audio/mpeg' });

describe('buildProjectZip', () => {
  it('produces a real application/zip blob', async () => {
    const zip = await buildProjectZip('{"schemaVersion":1}', audio, 'brahms.mp3');

    expect(zip.type).toBe('application/zip');
    // "PK\x03\x04" — the local file header magic of a genuine zip.
    const bytes = new Uint8Array(await zip.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 3, 4]);
  });

  it('contains project.json and the audio under its filename, byte-for-byte', async () => {
    const zip = await buildProjectZip('{"schemaVersion":1}', audio, 'brahms.mp3');

    const entries = await readZipEntries(zip);

    expect([...entries.keys()].sort()).toEqual(['brahms.mp3', PROJECT_JSON_PATH]);
    expect(new TextDecoder().decode(entries.get(PROJECT_JSON_PATH))).toBe('{"schemaVersion":1}');
    expect([...entries.get('brahms.mp3')!]).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('readZipEntries', () => {
  it('rejects bytes that are not a zip', async () => {
    const garbage = new Blob([new Uint8Array([1, 2, 3, 4, 5])]);

    await expect(readZipEntries(garbage)).rejects.toThrow();
  });
});
