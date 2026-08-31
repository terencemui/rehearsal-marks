/**
 * The client's view of a server-side project (ADR-0006): one row of the
 * `projects` table, its snake_case columns mapped to the app's camelCase
 * vocabulary, with markers and movements parsed through the domain's own
 * rules. This is the shape every server read returns and every write path
 * carries — the successor to the IndexedDB `ProjectRecord`.
 *
 * `recordingTitle` is the canonical recording title, fetched once from
 * YouTube at creation and never editable; `name` is the user's own label. The
 * recording identity is `videoId` (with `duration` as a soft check); the
 * review surface is `visibility` + `publicationStatus`.
 */

import { isVideoId, parseMarkers, parseMovements } from '../domain';
import type { Marker, Movement } from '../domain';
import { ProjectsError } from './errors';

/** Whether a project's markings are visible to anonymous readers. */
export type ProjectVisibility = 'public' | 'private';

/** The review surface, meaningful for public projects only (CONTEXT.md). */
export type PublicationStatus = 'pending' | 'published' | 'rejected';

export const PROJECT_VISIBILITIES: readonly ProjectVisibility[] = ['public', 'private'];
export const PUBLICATION_STATUSES: readonly PublicationStatus[] = [
  'pending',
  'published',
  'rejected',
];

/**
 * A server project as the app reads it: the row's content, identity, review
 * state, and stamps. `playerMode` is deliberately absent — the first-open
 * posture is derived from what the project carries, never stored (T51).
 */
export interface ServerProject {
  id: string;
  /** The user's editable project name — never the recording's title. */
  name: string;
  /** The canonical recording title, fixed at creation. */
  recordingTitle: string;
  /** The 11-character YouTube video ID — the recording identity. */
  videoId: string;
  /** Seconds, float — the soft check of recording identity. */
  duration: number;
  markers: Marker[];
  /** The recording's movements (ADR-0005); empty means one flat sequence. */
  movements: Movement[];
  visibility: ProjectVisibility;
  publicationStatus: PublicationStatus;
  /** Epoch ms. */
  createdAt: number;
  /** Epoch ms. */
  updatedAt: number;
}

/** The workspace list's row: content facts plus the review state. */
export interface ProjectSummary {
  id: string;
  name: string;
  recordingTitle: string;
  /** Seconds, float. */
  duration: number;
  markerCount: number;
  visibility: ProjectVisibility;
  publicationStatus: PublicationStatus;
  /** Epoch ms. */
  updatedAt: number;
}

/** The create payload. Ownership, status, and stamps come from the server. */
export interface ProjectValues {
  name: string;
  recordingTitle: string;
  videoId: string;
  duration: number;
  markers: Marker[];
  movements: Movement[];
}

/**
 * The fields an owner may edit — exactly the update grant the T49 migration
 * gives the client (name, markers, movements); visibility has its own
 * operation, and recording identity, ownership, and status are never
 * client-settable.
 */
export interface ProjectUpdate {
  name?: string;
  markers?: Marker[];
  movements?: Movement[];
}

/**
 * Whether a save returned a public project to the review queue — the review
 * surface the save indicator shows (T52). The server, via the T49 review
 * trigger, is the only writer of publication status; the caller compares the
 * review state it loaded against the state the save's response carries. Only a
 * *public* project that was not pending can re-enter review: a trusted owner's
 * edit stays published, and an already-pending project stays pending, so
 * neither is a return.
 */
export function returnsToReview(
  loaded: { visibility: ProjectVisibility; publicationStatus: PublicationStatus },
  saved: { visibility: ProjectVisibility; publicationStatus: PublicationStatus },
): boolean {
  return (
    saved.visibility === 'public' &&
    saved.publicationStatus === 'pending' &&
    loaded.visibility === 'public' &&
    loaded.publicationStatus !== 'pending'
  );
}

/**
 * Parses one `projects` row as PostgREST returns it, mapping snake_case to
 * the app's camelCase and routing the content documents through the domain's
 * own parsers — the same rule the project-file and label-set readers applied:
 * a row no reader can consume is the store's fault, thrown loudly, and the
 * transport's boundary is what catches it.
 */
export function parseProjectRow(value: unknown): ServerProject {
  const row = assertObject(value, 'projects row');

  const name = assertNonEmptyString(row.name, 'name');
  const recordingTitle = assertNonEmptyString(row.recording_title, 'recording_title');
  const videoId = assertString(row.video_id, 'video_id');
  if (!isVideoId(videoId)) throw invalidRow(`video_id "${videoId}" is not a video ID shape.`);

  const duration = assertFiniteNumber(row.duration, 'duration');
  if (duration < 0) throw invalidRow(`duration ${duration} is negative.`);

  let markers: Marker[];
  let movements: Movement[];
  try {
    markers = parseMarkers(row.markers);
    movements = parseMovements(row.movements);
  } catch (error) {
    // The domain's parsers throw neutral DomainErrors; a row that cannot be
    // consumed is rebranded as the store's fault.
    throw invalidRow(error instanceof Error ? error.message : 'invalid content document');
  }

  const visibility = assertOneOf(row.visibility, PROJECT_VISIBILITIES, 'visibility');
  const publicationStatus = assertOneOf(
    row.publication_status,
    PUBLICATION_STATUSES,
    'publication_status',
  );

  return {
    id: assertString(row.id, 'id'),
    name,
    recordingTitle,
    videoId,
    duration,
    markers,
    movements,
    visibility,
    publicationStatus,
    createdAt: assertTimestamp(row.created_at, 'created_at'),
    updatedAt: assertTimestamp(row.updated_at, 'updated_at'),
  };
}

/** The list row derived from a parsed project — the workspace's summary. */
export function summarizeProject(project: ServerProject): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    recordingTitle: project.recordingTitle,
    duration: project.duration,
    markerCount: project.markers.length,
    visibility: project.visibility,
    publicationStatus: project.publicationStatus,
    updatedAt: project.updatedAt,
  };
}

/** A PostgREST row that no reader could consume. */
function invalidRow(reason: string): ProjectsError {
  return new ProjectsError(
    `A project row was unreadable (${reason}).`,
    'invalid-response',
  );
}

function assertObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidRow(`${label} is not an object.`);
  }
  return value as Record<string, unknown>;
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw invalidRow(`${label} is not a string.`);
  return value;
}

/** A string that is non-empty after trimming — the table's own btrim rule. */
function assertNonEmptyString(value: unknown, label: string): string {
  const text = assertString(value, label);
  if (text.trim() === '') throw invalidRow(`${label} is blank.`);
  return text;
}

function assertFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalidRow(`${label} is not a finite number.`);
  }
  return value;
}

function assertOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  const text = assertString(value, label);
  if (!(allowed as readonly string[]).includes(text)) {
    throw invalidRow(`${label} "${text}" is not one of ${allowed.join(', ')}.`);
  }
  return text as T;
}

/** A Postgres timestamptz — PostgREST returns ISO-8601 — as epoch ms. */
function assertTimestamp(value: unknown, label: string): number {
  const text = assertString(value, label);
  const epochMs = Date.parse(text);
  if (!Number.isFinite(epochMs)) throw invalidRow(`${label} "${text}" is not a timestamp.`);
  return epochMs;
}
