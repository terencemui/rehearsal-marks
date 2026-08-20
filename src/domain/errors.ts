/** Stable codes the UI keys error messages off. */
export type DomainErrorCode =
  | 'invalid-time'
  | 'invalid-time-format'
  | 'marker-not-found'
  | 'duplicate-marker-id'
  | 'alias-empty'
  | 'alias-too-long'
  | 'alias-duplicate'
  | 'alias-label-collision'
  | 'invalid-project-file'
  | 'invalid-value'
  | 'invalid-markers'
  | 'unsupported-schema-version'
  | 'invalid-youtube-link'
  | 'youtube-playlist-link';

/** A rejected domain operation. */
export class DomainError extends Error {
  constructor(message: string, readonly code: DomainErrorCode) {
    super(message);
    this.name = 'DomainError';
  }
}

/** An error's message, for the inline messages the UI shows from catches. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
