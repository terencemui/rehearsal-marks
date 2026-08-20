/** Stable codes the UI keys Commons failure states off. */
export type CommonsErrorCode =
  | 'invalid-label-set-row'
  | 'invalid-label-set'
  | 'not-youtube-label-set';

/**
 * A rejected Commons operation: a bad row from the Commons, a project the
 * contributor cannot publish, or a label set the Commons cannot hold.
 */
export class CommonsError extends Error {
  constructor(message: string, readonly code: CommonsErrorCode) {
    super(message);
    this.name = 'CommonsError';
  }
}
