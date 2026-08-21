import { describe, expect, it } from 'vitest';
import { postgrestErrorToCommonsError } from './write';

/**
 * The transport's error translation — the one piece of the supabase-js
 * wiring that is testable without a live project (the same line the auth
 * adapter draws). The submission gate's exceptions carry machine-readable
 * prefixes; the moderation SQL test pins those prefixes inside the
 * migration, so this mapping and the trigger cannot drift apart.
 */
describe('postgrestErrorToCommonsError', () => {
  it('translates the submission gate\'s rate-limit rejection', () => {
    const error = postgrestErrorToCommonsError({
      message: 'RATE_LIMITED: This account has submitted 3 label sets in the last 7 days — the limit. Try again later.',
      code: 'P0001',
    });

    expect(error.code).toBe('rate-limited');
    expect(error.message).toMatch(/3 label sets in the last 7 days/);
  });

  it('translates the submission gate\'s ban rejection', () => {
    const error = postgrestErrorToCommonsError({
      message: 'BANNED: This account is suspended from contributing to the Commons.',
    });

    expect(error.code).toBe('banned');
    expect(error.message).toMatch(/suspended/);
  });

  it('names the published-per-video unique violation — the auto-publish race', () => {
    // Postgres reports the race as 23505: another write committed the
    // published row between the trigger's not-exists check and this insert.
    const error = postgrestErrorToCommonsError({
      message: 'duplicate key value violates unique constraint "label_sets_published_video_unique"',
      code: '23505',
    });

    expect(error.code).toBe('already-published');
    expect(error.message).toMatch(/already has a published label set/);
  });

  it('treats every other PostgREST failure as the Commons failing to save', () => {
    const error = postgrestErrorToCommonsError({
      message: 'could not connect to server',
    });

    expect(error.code).toBe('fetch-failed');
    expect(error.message).toMatch(/couldn't save your label set/);
  });

  it('degrades a non-PostgREST error the same way', () => {
    expect(postgrestErrorToCommonsError(undefined).code).toBe('fetch-failed');
    expect(postgrestErrorToCommonsError('nonsense').code).toBe('fetch-failed');
    expect(postgrestErrorToCommonsError({}).code).toBe('fetch-failed');
  });
});
