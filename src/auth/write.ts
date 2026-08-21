/**
 * The Commons write backend — the contributor's side of the moderation gate
 * (T25): submit a label set, re-submit an edited one, and read back the
 * contributor's own rows with their publication status. This is the second
 * module (besides `supabase.ts`) that references the supabase-js library,
 * by the same containment rule: the client is created here, and everything
 * above the `SupabaseCommonsWrite` shape drives the interface, which tests
 * fake the way they fake `SupabaseAuth`.
 *
 * The write path rides the session: each call restores it from the shared
 * storage first, so a signed-out client fails with a clean
 * `not-signed-in` error instead of a token-less request the RLS would
 * refuse, and the postgrest client attaches the restored token itself.
 */

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CommonsError } from '../commons/errors';
import { parseLabelSetRow } from '../commons/labelSet';
import type { LabelSetRow, LabelSetUpdate, LabelSetValues } from '../commons/labelSet';
import type { AuthEnv } from './supabase';

/**
 * The Commons write surface the app drives — the seam tests fake, the
 * counterpart of `SupabaseAuth` for writes. The supabase-js client attaches
 * the session token itself; each method restores the session first so the
 * signed-out case is a clean error, never a token-less request.
 */
export interface SupabaseCommonsWrite {
  /** Inserts a new submission; the table defaults it to `pending`. */
  insertLabelSet(values: LabelSetValues): Promise<void>;
  /** Re-submits: updates one of the contributor's own rows (title, duration, markers). */
  updateLabelSet(id: string, values: LabelSetUpdate): Promise<void>;
  /** The contributor's own rows, newest first — the submissions list. */
  listMyLabelSets(): Promise<LabelSetRow[]>;
}

/**
 * The message prefixes the submission-gate trigger raises; the transport
 * matches them to translate a PostgREST rejection into the app's own error.
 * Kept in sync with the trigger by `src/commons/moderation.test.ts`, which
 * pins them inside the migration SQL.
 */
export const RATE_LIMITED_PREFIX = 'RATE_LIMITED';
export const BANNED_PREFIX = 'BANNED';

/** The `SupabaseCommonsWrite` over a real supabase-js client. */
export function createSupabaseCommonsWrite(env: AuthEnv): SupabaseCommonsWrite {
  const client = createClient(env.url, env.anonKey);

  return {
    async insertLabelSet(values) {
      await requireSession(client);
      const { error } = await client.from('label_sets').insert(values);
      if (error) throw postgrestErrorToCommonsError(error);
    },
    async updateLabelSet(id, values) {
      await requireSession(client);
      const { error } = await client.from('label_sets').update(values).eq('id', id);
      if (error) throw postgrestErrorToCommonsError(error);
    },
    async listMyLabelSets() {
      const user = await requireSession(client);
      const { data, error } = await client
        .from('label_sets')
        .select('*')
        .eq('contributor_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw postgrestErrorToCommonsError(error);
      // The RLS scope is the contributor's own rows in every status; a row
      // the parser cannot consume is the Commons' fault, thrown loudly — the
      // same rule the read pipeline applies.
      return data.map((row: unknown) => parseLabelSetRow(row));
    },
  };
}

/**
 * Restores the session into the client (and verifies it exists) before a
 * write, returning the signed-in user. The restore also makes the postgrest
 * client's own token attachment deterministic.
 */
async function requireSession(client: SupabaseClient): Promise<{ id: string }> {
  const { data, error } = await client.auth.getSession();
  if (error) throw postgrestErrorToCommonsError(error);
  if (data.session === null) {
    throw new CommonsError('You need to sign in to do that.', 'not-signed-in');
  }
  return { id: data.session.user.id };
}

/**
 * A PostgREST rejection, translated into the app's own vocabulary. The
 * submission gate's exceptions carry machine-readable prefixes (pinned by
 * the moderation SQL test); the published-per-video unique index — the
 * auto-publish race, where another write won the row between the trigger's
 * check and the commit — carries Postgres' unique-violation code. Either
 * way the rejection names its cause. Everything else — network trouble, an
 * RLS refusal, a constraint that should not have fired — is the Commons
 * failing to save, with a retry message that does not blame one cause.
 */
export function postgrestErrorToCommonsError(error: unknown): CommonsError {
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : '';
  if (message.startsWith(RATE_LIMITED_PREFIX)) {
    return new CommonsError(
      "You've submitted 3 label sets in the last 7 days — the limit. Please try again next week.",
      'rate-limited',
    );
  }
  if (message.startsWith(BANNED_PREFIX)) {
    return new CommonsError(
      'This account is suspended from contributing to the Commons.',
      'banned',
    );
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    String((error as { code: unknown }).code) === '23505'
  ) {
    return new CommonsError(
      'This video already has a published label set, so your submission was not saved.',
      'already-published',
    );
  }
  return new CommonsError(
    "The Commons couldn't save your label set. Check your connection and try again.",
    'fetch-failed',
  );
}
