/**
 * The Commons read pipeline — the anonymous lookup T21 wires into YouTube
 * project creation (ADR-0001): one published label set per video ID, or
 * null when none exists. Pure orchestration over an injected text fetch,
 * like the library's loader: the Supabase URL and anon key come from Vite
 * env, the query is the PostgREST filter pair the schema's unique index and
 * RLS policies promise (published, one per video), and a row parses through
 * the domain's own rules before it reaches any caller. An unconfigured app
 * or an empty answer reads as null — no labels. A Commons that answers
 * garbage is a loud CommonsError: marks a project could not hold must not
 * flow in silently, and the create pipeline's catch is what degrades it.
 */

import { CommonsError } from './errors';
import { parseLabelSetReadRow } from './labelSet';
import type { LabelSetReadRow } from './labelSet';

/** The anon-key client identity a read carries; RLS, never the client, is the boundary. */
export interface CommonsConfig {
  /** The project's REST root, e.g. `https://abccompany.supabase.co`. */
  supabaseUrl: string;
  /** The public anon key — a role name for RLS, not a secret. */
  anonKey: string;
}

/**
 * The client config from Vite env, or null when the app is not wired to a
 * Supabase project (a dev build, a test run, a preview). The read path
 * treats that as "no labels", not as a failure — and so does a URL that
 * would not parse, which no query could have used.
 */
export function readCommonsConfig(
  env: Record<string, string | undefined> = import.meta.env,
): CommonsConfig | null {
  const supabaseUrl = env.VITE_SUPABASE_URL;
  const anonKey = env.VITE_SUPABASE_ANON_KEY;
  if (
    supabaseUrl === undefined ||
    supabaseUrl.trim() === '' ||
    anonKey === undefined ||
    anonKey.trim() === ''
  ) {
    return null;
  }
  try {
    new URL(supabaseUrl);
  } catch {
    return null;
  }
  return { supabaseUrl, anonKey };
}

/** Everything the read needs from outside itself, injectable in tests. */
export interface CommonsReadDependencies {
  /**
   * Fetches a URL as text, throwing on network or HTTP failure; the caller
   * owns the timeout. The headers are the query's own and arrive ready-made.
   */
  fetchText: (url: string, headers?: Record<string, string>) => Promise<string>;
  /** The client config, or null when the app is not wired to the Commons. */
  config: CommonsConfig | null;
}

/**
 * The anonymous lookup: the published label set for one video ID, or null
 * when none exists. Matching is by video ID — the key every accepted link
 * form collapses to — never by duration. The query filter and the schema
 * agree on what anon readers may see, so a published row is the only thing
 * this can return.
 */
export async function loadPublishedLabelSet(
  videoId: string,
  { fetchText, config }: CommonsReadDependencies,
): Promise<LabelSetReadRow | null> {
  if (config === null) return null;
  const url = new URL('/rest/v1/label_sets', config.supabaseUrl);
  // The read projection only: identity, marks, and the duration they seed.
  // Contributor identity and stamps stay on the write path — an anonymous
  // reader never receives them.
  url.searchParams.set('select', 'video_id,duration,markers');
  url.searchParams.set('video_id', `eq.${videoId}`);
  url.searchParams.set('publication_status', 'eq.published');
  url.searchParams.set('limit', '1');

  // A fetch failure is the caller's error, whatever it is — it propagates
  // untouched; only a body nothing can parse is the Commons' own fault.
  const body = await fetchText(url.toString(), anonHeaders(config.anonKey));
  let rows: unknown;
  try {
    rows = JSON.parse(body);
  } catch {
    throw invalidResponse();
  }
  if (!Array.isArray(rows)) throw invalidResponse();
  if (rows.length === 0) return null;
  return parseLabelSetReadRow(rows[0]);
}

/** The header pair an anonymous read carries: the anon key names the role RLS applies. */
function anonHeaders(anonKey: string): Record<string, string> {
  return { apikey: anonKey, Authorization: `Bearer ${anonKey}` };
}

/** The Commons answered something no read could consume. */
function invalidResponse(): CommonsError {
  return new CommonsError(
    "The Commons answered something that isn't a label-set list.",
    'invalid-response',
  );
}
