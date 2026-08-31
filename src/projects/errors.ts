/**
 * The projects module's own error vocabulary — the successor to the retired
 * CommonsError. The transport translates PostgREST rejections into these
 * codes; the app surfaces the message next to the action that caused it.
 */

export type ProjectsErrorCode =
  | 'not-signed-in'
  | 'fetch-failed'
  | 'banned'
  | 'not-found'
  | 'invalid-response';

export class ProjectsError extends Error {
  readonly code: ProjectsErrorCode;

  constructor(message: string, code: ProjectsErrorCode) {
    super(message);
    this.name = 'ProjectsError';
    this.code = code;
  }
}

/**
 * The prefix the projects moderation-gate trigger raises (T49 migration); the
 * transport matches it to translate a PostgREST rejection into the app's own
 * `banned` error. Kept in sync with the trigger by
 * `src/projects/projects-migration.test.ts`, which pins it inside the
 * migration SQL.
 */
export const BANNED_PREFIX = 'BANNED';
