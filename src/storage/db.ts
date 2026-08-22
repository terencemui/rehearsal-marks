import { StorageError, translateError } from './errors';
import { slimRecordFromStored } from './records';

export const DB_NAME = 'rehearsal-marks';
export const DB_VERSION = 2;
/** Self-contained user projects — never auto-evicted. */
export const PROJECTS_STORE = 'projects';
/** Community audio + label sets — evictable independently of projects. */
export const LIBRARY_STORE = 'library-cache';

/** A schema change applied inside `onupgradeneeded`. */
export type Migration = (db: IDBDatabase, tx: IDBTransaction) => void;

/** v1: both stores, keyed by record id. */
function createV1(db: IDBDatabase): void {
  db.createObjectStore(PROJECTS_STORE, { keyPath: 'id' });
  db.createObjectStore(LIBRARY_STORE, { keyPath: 'id' });
}

/**
 * v2 — YouTube-only projects. Uploads are retired, so every stored upload
 * record (source `'upload'`, or absent — a missing discriminator always meant
 * upload) is deleted in this one cut, and every surviving YouTube record is
 * rewritten to its slim shape: video ID and duration as identity, and nothing
 * else. Runs inside the versionchange transaction, so the cursor's deletes and
 * updates commit together with the version bump.
 */
function migrateV2(_db: IDBDatabase, tx: IDBTransaction): void {
  const request = tx.objectStore(PROJECTS_STORE).openCursor();
  request.onsuccess = () => {
    const cursor = request.result;
    if (cursor === null) return;
    const slim = slimRecordFromStored(cursor.value);
    if (slim === null) {
      cursor.delete();
    } else {
      cursor.update(slim);
    }
    cursor.continue();
  };
}

/**
 * One entry per database version, in order: `MIGRATIONS[i]` migrates from
 * version `i` to `i + 1`. Appending here — never editing an entry — is the
 * migration path; `onupgradeneeded` runs the tail of the list for existing
 * databases and the whole list for fresh ones.
 */
export const MIGRATIONS: Migration[] = [createV1, migrateV2];

export interface OpenDatabaseOptions {
  name?: string;
  version?: number;
  migrations?: Migration[];
}

/**
 * Opens the versioned database, running every migration between the stored
 * version and the requested one. Rejects with a `StorageError` on failure:
 * `unsupported-db-version` when the data in this browser is newer than this
 * app (a downgraded app must not touch newer data), `db-blocked` when another
 * tab holds an older connection during an upgrade.
 */
export function openDatabase(options: OpenDatabaseOptions = {}): Promise<IDBDatabase> {
  const { name = DB_NAME, version = DB_VERSION, migrations = MIGRATIONS } = options;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction!;
      for (let v = event.oldVersion + 1; v <= version; v++) {
        migrations[v - 1](db, tx);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(translateError(request.error));
    request.onblocked = () =>
      reject(
        new StorageError(
          'The database is blocked by another open tab. Close the other tab and reload.',
          'db-blocked',
        ),
      );
  });
}

/** Resolves with a request's result, or rejects with a translated error. */
export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(translateError(request.error));
  });
}

/** Resolves when a transaction commits, or rejects with a translated error. */
export function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(translateError(tx.error));
    tx.onabort = () => reject(translateError(tx.error ?? new Error('IndexedDB transaction aborted.')));
  });
}
