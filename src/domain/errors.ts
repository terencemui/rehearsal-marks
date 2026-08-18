/** Stable codes the UI keys error messages off. */
export type DomainErrorCode =
  | 'invalid-time'
  | 'marker-not-found'
  | 'duplicate-marker-id'
  | 'alias-empty'
  | 'alias-too-long'
  | 'alias-duplicate'
  | 'alias-label-collision';

/** A rejected domain operation. */
export class DomainError extends Error {
  constructor(message: string, readonly code: DomainErrorCode) {
    super(message);
    this.name = 'DomainError';
  }
}
