/** Stable codes the UI keys library failure states off. */
export type LibraryErrorCode =
  | 'invalid-catalog'
  | 'invalid-labelset'
  | 'labelset-mismatch'
  | 'audio-mismatch'
  | 'fetch-failed';

/** A rejected library operation: a bad catalog, a mismatched label set, a failed download. */
export class LibraryError extends Error {
  constructor(message: string, readonly code: LibraryErrorCode) {
    super(message);
    this.name = 'LibraryError';
  }
}
