import { LIBRARY_STORE, PROJECTS_STORE, openDatabase, requestResult, transactionDone } from './db';
import { translateError } from './errors';
import { estimateStoredSize } from './records';
import type { LibraryEntryRecord, LibraryEntrySummary, ProjectRecord, ProjectSummary } from './records';

/** Persistence for user projects — the store that is never auto-evicted. */
export interface ProjectRepository {
  /** Upserts a project verbatim: storage never rewrites what the domain approved. */
  save(record: ProjectRecord): Promise<void>;
  get(id: string): Promise<ProjectRecord | undefined>;
  /** Summaries for the Projects screen, newest first. */
  list(): Promise<ProjectSummary[]>;
  remove(id: string): Promise<void>;
}

/** Persistence for the evictable library cache. */
export interface LibraryRepository {
  save(entry: LibraryEntryRecord): Promise<void>;
  get(id: string): Promise<LibraryEntryRecord | undefined>;
  /** Cached entries newest first, with sizes for eviction decisions. */
  list(): Promise<LibraryEntrySummary[]>;
  evict(id: string): Promise<void>;
  evictAll(): Promise<void>;
}

/** The persistence layer: one connection, both repositories. */
export interface Storage {
  projects: ProjectRepository;
  library: LibraryRepository;
  close(): void;
}

export interface CreateStorageOptions {
  /** Database name; the app uses the default `rehearsal-marks`. */
  name?: string;
}

export async function createStorage(options: CreateStorageOptions = {}): Promise<Storage> {
  const db = await openDatabase({ name: options.name });

  return {
    projects: {
      save: (record) => write(db, PROJECTS_STORE, (store) => store.put(record)),
      get: (id) => read<ProjectRecord | undefined>(db, PROJECTS_STORE, (store) => store.get(id)),
      list: async () => {
        const records = await read<ProjectRecord[]>(db, PROJECTS_STORE, (store) => store.getAll());
        return records
          .map(summarizeProject)
          .sort((a, b) => b.updatedAt - a.updatedAt);
      },
      remove: (id) => write(db, PROJECTS_STORE, (store) => store.delete(id)),
    },
    library: {
      save: (entry) => write(db, LIBRARY_STORE, (store) => store.put(entry)),
      get: (id) => read<LibraryEntryRecord | undefined>(db, LIBRARY_STORE, (store) => store.get(id)),
      list: async () => {
        const entries = await read<LibraryEntryRecord[]>(db, LIBRARY_STORE, (store) => store.getAll());
        return entries
          .map(summarizeLibraryEntry)
          .sort((a, b) => b.cachedAt - a.cachedAt);
      },
      evict: (id) => write(db, LIBRARY_STORE, (store) => store.delete(id)),
      evictAll: () => write(db, LIBRARY_STORE, (store) => store.clear()),
    },
    close: () => db.close(),
  };
}

function summarizeProject(record: ProjectRecord): ProjectSummary {
  return {
    id: record.id,
    name: record.name,
    duration: record.audioMeta.duration,
    markerCount: record.markers.length,
    sizeBytes: estimateStoredSize(record),
    updatedAt: record.updatedAt,
  };
}

function summarizeLibraryEntry(entry: LibraryEntryRecord): LibraryEntrySummary {
  return {
    id: entry.id,
    sizeBytes: entry.audio.size,
    cachedAt: entry.cachedAt,
  };
}

/** One readwrite transaction around a single operation, quota and abort translated. */
async function write<T>(
  db: IDBDatabase,
  storeName: string,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<void> {
  try {
    const tx = db.transaction(storeName, 'readwrite');
    const request = operation(tx.objectStore(storeName));
    await Promise.all([requestResult(request), transactionDone(tx)]);
  } catch (error) {
    throw translateError(error);
  }
}

/** One readonly transaction returning a single request's result. */
async function read<T>(
  db: IDBDatabase,
  storeName: string,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  try {
    const tx = db.transaction(storeName, 'readonly');
    return await requestResult(operation(tx.objectStore(storeName)));
  } catch (error) {
    throw translateError(error);
  }
}
