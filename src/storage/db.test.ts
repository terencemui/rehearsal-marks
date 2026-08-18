import { describe, expect, it } from 'vitest';
import { DB_VERSION, LIBRARY_STORE, PROJECTS_STORE, openDatabase } from './db';
import type { Migration } from './db';
import { StorageError } from './errors';

const testDb = () => `db-test-${crypto.randomUUID()}`;

// The v1 schema as the tests know it — written inline so the migration runner
// is tested against an independent description, not the implementation's own
// migration array.
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

function getAllRaw(db: IDBDatabase, storeName: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

describe('openDatabase', () => {
  it('creates both stores keyed by id at the default version', async () => {
    const db = await openDatabase({ name: testDb() });
    expect(db.version).toBe(DB_VERSION);
    expect(Array.from(db.objectStoreNames).sort()).toEqual(
      [LIBRARY_STORE, PROJECTS_STORE].sort(),
    );
    expect(db.transaction(PROJECTS_STORE).objectStore(PROJECTS_STORE).keyPath).toBe('id');
    expect(db.transaction(LIBRARY_STORE).objectStore(LIBRARY_STORE).keyPath).toBe('id');
    db.close();
  });

  it('runs migrations in sequence for each new version on a fresh database', async () => {
    const visited: number[] = [];
    const migrations: Migration[] = [
      (db) => {
        visited.push(1);
        createStoresV1(db);
      },
      (db) => {
        visited.push(2);
        db.createObjectStore('settings');
      },
    ];

    const db = await openDatabase({ name: testDb(), version: 2, migrations });
    expect(visited).toEqual([1, 2]);
    expect(Array.from(db.objectStoreNames)).toEqual(
      expect.arrayContaining([PROJECTS_STORE, LIBRARY_STORE, 'settings']),
    );
    db.close();
  });

  it('migrates an existing database forward without losing data', async () => {
    const name = testDb();

    // First app version: v1 schema, one project written.
    const v1 = await openDatabase({ name, version: 1, migrations: [createStoresV1] });
    await putRaw(v1, PROJECTS_STORE, { id: 'p1', name: 'Brahms' });
    v1.close();

    // Second app version adds a store; the project must survive the upgrade.
    const migrations: Migration[] = [
      createStoresV1,
      (db) => db.createObjectStore('settings'),
    ];
    const v2 = await openDatabase({ name, version: 2, migrations });
    expect(v2.version).toBe(2);
    expect(await getAllRaw(v2, PROJECTS_STORE)).toEqual([{ id: 'p1', name: 'Brahms' }]);
    expect(Array.from(v2.objectStoreNames)).toContain('settings');
    v2.close();
  });

  it('preserves data across a same-version reopen', async () => {
    const name = testDb();
    const first = await openDatabase({ name, version: 1, migrations: [createStoresV1] });
    await putRaw(first, LIBRARY_STORE, { id: 'l1', cachedAt: 1 });
    first.close();

    const second = await openDatabase({ name, version: 1, migrations: [createStoresV1] });
    expect(await getAllRaw(second, LIBRARY_STORE)).toEqual([{ id: 'l1', cachedAt: 1 }]);
    second.close();
  });

  it('rejects with unsupported-db-version when the data is newer than this app', async () => {
    const name = testDb();
    const newer = await openDatabase({ name, version: 2, migrations: [createStoresV1, (db) => db.createObjectStore('settings')] });
    newer.close();

    await expect(openDatabase({ name, version: 1, migrations: [createStoresV1] })).rejects.toMatchObject(
      {
        name: 'StorageError',
        code: 'unsupported-db-version',
      },
    );
  });

  it('exposes the failure as a StorageError instance', async () => {
    const name = testDb();
    const newer = await openDatabase({ name, version: 2, migrations: [createStoresV1, () => undefined] });
    newer.close();

    const error = await openDatabase({ name, version: 1, migrations: [createStoresV1] }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(StorageError);
  });

  it('rejects with db-blocked when another connection holds the database open', async () => {
    const name = testDb();
    const holder = await openDatabase({ name, version: 1, migrations: [createStoresV1] });

    const upgrade = openDatabase({ name, version: 2, migrations: [createStoresV1, () => undefined] });
    await expect(upgrade).rejects.toMatchObject({ code: 'db-blocked' });

    holder.close();
  });
});
