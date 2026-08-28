import { describe, expect, it } from 'vitest';
import { LIBRARY_STORE, PROJECTS_STORE, openDatabase } from './db';
import { createStorage } from './repository';

const testDb = () => `migration-test-${crypto.randomUUID()}`;

/** The v1 schema, written inline so the test seeds the same shape an old app wrote. */
function createStoresV1(db: IDBDatabase): void {
  db.createObjectStore(PROJECTS_STORE, { keyPath: 'id' });
  db.createObjectStore(LIBRARY_STORE, { keyPath: 'id' });
}

function putRaw(db: IDBDatabase, storeName: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** The pre-v2 upload record shape — the app that wrote it is now retired. */
function uploadRecord(): Record<string, unknown> {
  return {
    id: 'upload-1',
    name: 'An upload',
    createdAt: 1_000,
    updatedAt: 2_000,
    source: 'upload',
    audio: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/mpeg' }),
    audioMeta: {
      sha256: 'abc123',
      duration: 100,
      mimeType: 'audio/mpeg',
      filename: 'up.mp3',
      sizeBytes: 4,
      source: '',
      license: '',
      attribution: '',
    },
    markers: [],
    playerMode: 'label',
  };
}

/** The pre-v2 YouTube record shape — only this source survives the migration. */
function youtubeRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'youtube-1',
    name: 'A YouTube project',
    createdAt: 1_000,
    updatedAt: 2_000,
    source: 'youtube',
    audio: null,
    audioMeta: {
      sha256: '',
      duration: 300,
      mimeType: '',
      filename: 'A YouTube project',
      sizeBytes: 0,
      source: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      license: '',
      attribution: '',
    },
    markers: [{ id: 'm1', time: 10, aliases: [], createdAt: 500 }],
    playerMode: 'label',
    ...overrides,
  };
}

describe('v2 migration — YouTube-only schema', () => {
  it('deletes upload-sourced records and slims the YouTube record that survives', async () => {
    const name = testDb();

    // Seed a v1 database with both shapes, as the old app left them.
    const v1 = await openDatabase({ name, version: 1, migrations: [createStoresV1] });
    await putRaw(v1, PROJECTS_STORE, uploadRecord());
    await putRaw(v1, PROJECTS_STORE, youtubeRecord());
    v1.close();

    // Reopening at the app's current version runs the v2 migration.
    const storage = await createStorage({ name });
    const summaries = await storage.projects.list();

    // Only the YouTube record remains — the upload is gone.
    expect(summaries.map((s) => s.id)).toEqual(['youtube-1']);

    // And it reads back slim: video ID + duration, no upload-only fields.
    const kept = await storage.projects.get('youtube-1');
    expect(kept).toEqual({
      id: 'youtube-1',
      name: 'A YouTube project',
      createdAt: 1_000,
      updatedAt: 2_000,
      videoId: 'dQw4w9WgXcQ',
      duration: 300,
      markers: [{ id: 'm1', time: 10, aliases: [], createdAt: 500 }],
      movements: [],
      playerMode: 'label',
    });
    storage.close();
  });

  it('treats a record with no discriminator as an upload — legacy records all mean upload', async () => {
    const name = testDb();
    const v1 = await openDatabase({ name, version: 1, migrations: [createStoresV1] });
    await putRaw(v1, PROJECTS_STORE, {
      id: 'old-upload',
      name: 'Predates the discriminator',
      source: undefined,
      audioMeta: { duration: 10 },
    });
    v1.close();

    const storage = await createStorage({ name });
    expect(await storage.projects.list()).toEqual([]);
    storage.close();
  });

  it('keeps a surviving YouTube record’s player mode, or defaults it like the player would', async () => {
    const name = testDb();
    const v1 = await openDatabase({ name, version: 1, migrations: [createStoresV1] });
    // No stored player mode, two marks — the player's own default is Playback.
    await putRaw(v1, PROJECTS_STORE, youtubeRecord({ playerMode: undefined }));
    v1.close();

    const storage = await createStorage({ name });
    const kept = await storage.projects.get('youtube-1');
    expect(kept?.playerMode).toBe('playback');
    storage.close();
  });
});
