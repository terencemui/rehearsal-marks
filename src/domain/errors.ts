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
  | 'unsupported-schema-version';

/** A rejected domain operation. */
export class DomainError extends Error {
  constructor(message: string, readonly code: DomainErrorCode) {
    super(message);
    this.name = 'DomainError';
  }
}
