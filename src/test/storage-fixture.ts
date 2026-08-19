import { createStorage } from '../storage';
import type { Storage } from '../storage';

const openedNames: string[] = [];

/**
 * A fresh fake-indexeddb database for one test file. Names are remembered so
 * `closeTestStorages` (the file's afterEach) can shut them all down.
 */
export async function testStorage(): Promise<Storage> {
  const name = `test-${crypto.randomUUID()}`;
  openedNames.push(name);
  return createStorage({ name });
}

/** afterEach hook: closes every database this module opened. */
export async function closeTestStorages(): Promise<void> {
  for (const name of openedNames) {
    const storage = await createStorage({ name });
    storage.close();
  }
}
