/**
 * The `ProjectsApi`'s anonymous-read transport — half of the composed default
 * (T50, T51): the gallery and the read-only view run here, while the signed-in
 * surface lives in `supabase.ts`. Anonymous readers query the `projects` table
 * directly with the anon key; Row Level Security, never the client, is the
 * authorization boundary (ADR-0006), so a row this can return is a published
 * public project, banned owners excluded.
 *
 * The read rides a raw text fetch with the anon-key header pair — the
 * anonymous surface needs no session and no supabase-js client. An
 * unconfigured deployment (absent env) is null, the honest "not wired up"
 * case the shell renders as its own screen.
 */

import { parseMarkers, parseMovements } from '../domain';
import type { PublicProject, PublicProjectSummary } from './api';

/** The anon-key client identity a read carries; RLS is the boundary, not the key. */
export interface ProjectsConfig {
  /** The project's REST root, e.g. `https://abccompany.supabase.co`. */
  supabaseUrl: string;
  /** The public anon key — a role name for RLS, not a secret. */
  anonKey: string;
}

/**
 * The client config from Vite env, or null when the app is not wired to a
 * Supabase project (a dev build, a test run, a preview). The shell treats
 * null as the "not wired up" screen — a gallery over no backend is an honest
 * explanation, not a broken shell. A URL that would not parse is null too:
 * no query could have used it.
 */
export function readProjectsConfig(
  env: Record<string, string | undefined> = import.meta.env,
): ProjectsConfig | null {
  const supabaseUrl = (env.VITE_SUPABASE_URL ?? '').trim();
  const anonKey = (env.VITE_SUPABASE_ANON_KEY ?? '').trim();
  if (supabaseUrl === '' || anonKey === '') return null;
  try {
    new URL(supabaseUrl);
  } catch {
    return null;
  }
  return { supabaseUrl, anonKey };
}

/** Everything a read needs from outside itself, injectable in tests. */
export interface ProjectsReadDependencies {
  /**
   * Fetches a URL as text, throwing on network or HTTP failure; the caller
   * owns the timeout. The headers are the query's own and arrive ready-made.
   */
  fetchText: (url: string, headers?: Record<string, string>) => Promise<string>;
  /** The client config, or null when the app is not wired to the backend. */
  config: ProjectsConfig | null;
}

/**
 * The gallery's read projection: the entry's facts, plus the markers array so
 * the count can be computed client-side (no PostgREST computed-column
 * dependency). Content (`movements`) stays off the list read — a gallery of
 * summaries has no use for it.
 */
const LIST_SELECT = 'id,name,recording_title,video_id,duration,created_at,markers';
/** The read-only view's projection: the summary's facts plus the full content. */
const DETAIL_SELECT = 'id,name,recording_title,video_id,duration,created_at,markers,movements';

/** The projects query root with the read projection and the published filter. */
function projectsQuery(
  config: ProjectsConfig,
  select: string,
): URL {
  const url = new URL('/rest/v1/projects', config.supabaseUrl);
  url.searchParams.set('select', select);
  // RLS already bounds anon to published public rows; the filter is explicit
  // belt-and-suspenders, so a policy drift cannot leak pending rows.
  url.searchParams.set('publication_status', 'eq.published');
  return url;
}

/**
 * Every published public project, newest first — the gallery's source. The
 * order rides the schema's `projects_public_newest_idx` partial index.
 */
export async function listPublishedProjects({
  fetchText,
  config,
}: ProjectsReadDependencies): Promise<PublicProjectSummary[]> {
  if (config === null) return [];
  const url = projectsQuery(config, LIST_SELECT);
  url.searchParams.set('order', 'created_at.desc');
  const body = await fetchText(url.toString(), anonHeaders(config.anonKey));
  return parseSummaryRows(body);
}

/**
 * The published public projects for one recording, newest first — the
 * per-recording list the create-from-link peek reads (T51).
 */
export async function listPublishedForVideo(
  videoId: string,
  { fetchText, config }: ProjectsReadDependencies,
): Promise<PublicProjectSummary[]> {
  if (config === null) return [];
  const url = projectsQuery(config, LIST_SELECT);
  url.searchParams.set('video_id', `eq.${videoId}`);
  url.searchParams.set('order', 'created_at.desc');
  const body = await fetchText(url.toString(), anonHeaders(config.anonKey));
  return parseSummaryRows(body);
}

/**
 * One published public project, or null when it doesn't exist or isn't
 * visible (not published, not public, banned owner — the same rows RLS hides).
 * An id that cannot name a row is null before any query: the schema keys the
 * table on a uuid, so an id that doesn't look like one is a bad address, not
 * a backend outage — the not-found surface's case, never the error surface's.
 */
export async function getPublicProject(
  id: string,
  { fetchText, config }: ProjectsReadDependencies,
): Promise<PublicProject | null> {
  if (config === null) return null;
  if (!UUID_PATTERN.test(id)) return null;
  const url = projectsQuery(config, DETAIL_SELECT);
  url.searchParams.set('id', `eq.${id}`);
  url.searchParams.set('limit', '1');
  const body = await fetchText(url.toString(), anonHeaders(config.anonKey));
  const rows = parseRows(body);
  if (rows.length === 0) return null;
  return publicProjectFromRow(rows[0]);
}

/** The schema's key shape — the id a `projects` row can carry. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The header pair an anonymous read carries: the anon key names the role RLS applies. */
function anonHeaders(anonKey: string): Record<string, string> {
  return { apikey: anonKey, Authorization: `Bearer ${anonKey}` };
}

/**
 * The real read fetch: a text fetch with the timeout, network failures loud.
 * Exported so `api.ts`'s composed default can wire the anonymous reads the
 * way this module's own tests do.
 */
export async function fetchProjectsText(
  url: string,
  headers?: Record<string, string>,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(5_000), headers });
  } catch {
    throw invalidResponse();
  }
  if (!response.ok) throw invalidResponse();
  return response.text();
}

/** The backend answered something no read could consume. */
function invalidResponse(): Error {
  return new Error("The project server answered something that isn't a project list.");
}

/** Parses a body into a row list, refusing a body nothing could read. */
function parseRows(body: string): unknown[] {
  let rows: unknown;
  try {
    rows = JSON.parse(body);
  } catch {
    throw invalidResponse();
  }
  if (!Array.isArray(rows)) throw invalidResponse();
  return rows;
}

/**
 * Parses the list read's rows into summaries, counting markers client-side.
 * One row a reader can't parse never gets in — the schema guarantees only
 * that `markers` is JSON, not that it is an array, so a single malformed row
 * must not blank the whole gallery; the healthy rows still list.
 */
function parseSummaryRows(body: string): PublicProjectSummary[] {
  const summaries: PublicProjectSummary[] = [];
  for (const raw of parseRows(body)) {
    try {
      summaries.push(summaryFromRow(raw));
    } catch {
      // Skip the row; its entry simply doesn't appear.
    }
  }
  return summaries;
}

/** One PostgREST row into a gallery entry; a row a reader can't parse never gets in. */
function summaryFromRow(raw: unknown): PublicProjectSummary {
  const row = asObject(raw);
  const markers = row.markers;
  if (!Array.isArray(markers)) throw invalidResponse();
  return {
    id: stringField(row, 'id'),
    name: stringField(row, 'name'),
    recordingTitle: stringField(row, 'recording_title'),
    videoId: stringField(row, 'video_id'),
    duration: numberField(row, 'duration'),
    markerCount: markers.length,
    createdAt: stampField(row, 'created_at'),
  };
}

/** The detail read's row: the summary's facts plus content parsed by the domain. */
function publicProjectFromRow(raw: unknown): PublicProject {
  const summary = summaryFromRow(raw);
  const row = asObject(raw);
  return {
    ...summary,
    markers: parseMarkers(row.markers),
    movements: parseMovements(row.movements ?? []),
  };
}

function asObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null) throw invalidResponse();
  return raw as Record<string, unknown>;
}

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string' || value.trim() === '') throw invalidResponse();
  return value;
}

function numberField(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalidResponse();
  return value;
}

/** The row's timestamp as epoch ms — a PostgREST `timestamptz` ISO string. */
function stampField(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== 'string') throw invalidResponse();
  const stamp = Date.parse(value);
  if (Number.isNaN(stamp)) throw invalidResponse();
  return stamp;
}
