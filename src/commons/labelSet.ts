/**
 * The Commons label-set collection — the hosted `label_sets` table (Supabase)
 * and the mapping between its rows and the project-file format. Pure parsing
 * and conversion: the network I/O belongs to the load pipeline, the schema
 * and Row Level Security live in `supabase/migrations/`.
 *
 * A row carries the recording identity as the YouTube video ID — the key
 * every accepted link form collapses to; the project-file format carries it
 * as the canonical URL. The conversions below are that identity's round
 * trip, with duration as the soft check both carry. `contributor_id` and
 * `publication_status` are Commons metadata the file format has no place
 * for; they move only through the table itself.
 */

import { CommonsError } from './errors';
import {
  DomainError,
  canonicalYouTubeUrl,
  isVideoId,
  parseMarkers,
  parseYouTubeLink,
} from '../domain';
import type { Marker, ProjectFileData } from '../domain';

export const PUBLICATION_STATUSES = ['pending', 'published'] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

/** One `label_sets` row as the Commons returns it. */
export interface LabelSetRow {
  id: string;
  /** The 11-character YouTube video ID — the row's recording-identity key. */
  video_id: string;
  /** The owning account; the table derives it from the session, never the client. */
  contributor_id: string;
  title: string;
  /** Seconds, float — the soft check of recording identity. */
  duration: number;
  markers: Marker[];
  publication_status: PublicationStatus;
  /** ISO 8601, as PostgREST serializes timestamptz. */
  created_at: string;
  updated_at: string;
}

/** The values a contributor's insert carries; the table derives ownership, status, and stamps. */
export interface LabelSetValues {
  /** The contributor's project id, so the set round-trips as one identity. */
  id: string;
  video_id: string;
  title: string;
  duration: number;
  markers: Marker[];
}

/**
 * Parses a `label_sets` row. Tolerates unknown fields (forward
 * compatibility) and validates everything a consumer depends on — markers
 * through the domain's own marker rules, the video ID through the domain's
 * own shape rule — so a bad row is a loud error, never a broken project.
 */
export function parseLabelSetRow(value: unknown): LabelSetRow {
  const row = assertObject(value, 'the row');

  let markers: Marker[];
  try {
    markers = parseMarkers(row.markers);
  } catch (error) {
    // Only the neutral marker/value errors belong to the row; anything else
    // is a domain rule with its own code.
    if (
      error instanceof DomainError &&
      (error.code === 'invalid-value' || error.code === 'invalid-markers')
    ) {
      throw invalidRow(error.message);
    }
    throw error;
  }

  return {
    id: assertNonEmptyString(row.id, '"id"'),
    video_id: readVideoId(row.video_id),
    contributor_id: assertNonEmptyString(row.contributor_id, '"contributor_id"'),
    title: assertNonEmptyString(row.title, '"title"'),
    duration: assertNonNegativeNumber(row.duration, '"duration"'),
    markers,
    publication_status: readStatus(row.publication_status),
    created_at: assertTimestamp(row.created_at, '"created_at"'),
    updated_at: assertTimestamp(row.updated_at, '"updated_at"'),
  };
}

/**
 * The table row a project file publishes: the recording identity resolved to
 * its video ID, the project's name and duration, and the markers themselves.
 * Everything the row parser would reject on the way out is rejected here on
 * the way in — a row no reader can parse never gets written. Only YouTube
 * label sets exist in the Commons today — an uploaded recording's identity
 * is a sha256, which the Commons does not yet hold.
 */
export function labelSetValuesFromProjectFile(data: ProjectFileData): LabelSetValues {
  let link;
  try {
    link = parseYouTubeLink(data.audioMeta.source);
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    // An empty source is the upload shape: sha256 identity, not a link at
    // all. Anything else gets the domain's own guidance, so a playlist
    // source names its actual problem.
    throw data.audioMeta.source === ''
      ? new CommonsError(
          'This label set is for an uploaded recording, and the Commons holds YouTube label sets only.',
          'not-youtube-label-set',
        )
      : new CommonsError(error.message, 'not-youtube-label-set');
  }

  if (data.project.name.trim() === '') {
    throw invalidLabelSet('the project has no name to publish.');
  }
  if (!isUuid(data.project.id)) {
    throw invalidLabelSet('the project id must be a uuid to key a label set.');
  }

  let markers: Marker[];
  try {
    markers = parseMarkers(data.markers);
  } catch (error) {
    if (
      error instanceof DomainError &&
      (error.code === 'invalid-value' || error.code === 'invalid-markers')
    ) {
      throw invalidLabelSet(error.message);
    }
    throw error;
  }

  return {
    id: data.project.id,
    video_id: link.videoId,
    title: data.project.name,
    duration: data.audioMeta.duration,
    markers,
  };
}

/**
 * The project file a Commons row loads as: the video ID back to its
 * canonical URL, the row's stamps as the project's, and the upload-only
 * audio facts left empty — YouTube identity lives in the URL, nowhere else.
 */
export function projectFileFromLabelSetRow(row: LabelSetRow): ProjectFileData {
  return {
    project: {
      id: row.id,
      name: row.title,
      createdAt: epochMs(row.created_at),
      updatedAt: epochMs(row.updated_at),
    },
    markers: row.markers,
    audioMeta: {
      sha256: '',
      duration: row.duration,
      mimeType: '',
      filename: row.title,
      sizeBytes: 0,
      source: canonicalYouTubeUrl(row.video_id),
      license: '',
      attribution: '',
    },
  };
}

type JsonObject = Record<string, unknown>;

function invalidRow(reason: string): CommonsError {
  return new CommonsError(`Invalid label set row: ${reason}`, 'invalid-label-set-row');
}

/** A project the contributor cannot publish — their side of the boundary, not the row's. */
function invalidLabelSet(reason: string): CommonsError {
  return new CommonsError(`Invalid label set: ${reason}`, 'invalid-label-set');
}

/** The row id column is a uuid, so a published project id must be one. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID.test(value);
}

function assertObject(value: unknown, path: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidRow(`${path} must be an object.`);
  }
  return value as JsonObject;
}

function assertNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalidRow(`${path} must be a non-empty string.`);
  }
  return value;
}

function assertNonNegativeNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalidRow(`${path} must be a finite number.`);
  }
  if (value < 0) {
    throw invalidRow(`${path} must not be negative.`);
  }
  return value;
}

function assertTimestamp(value: unknown, path: string): string {
  const iso = assertNonEmptyString(value, path);
  if (!Number.isFinite(Date.parse(iso))) {
    throw invalidRow(`${path} must be a parseable timestamp.`);
  }
  return iso;
}

function readVideoId(value: unknown): string {
  const videoId = assertNonEmptyString(value, '"video_id"');
  if (!isVideoId(videoId)) {
    throw invalidRow('"video_id" must be an 11-character video ID.');
  }
  return videoId;
}

function readStatus(value: unknown): PublicationStatus {
  const status = assertNonEmptyString(value, '"publication_status"');
  if (!PUBLICATION_STATUSES.includes(status as PublicationStatus)) {
    throw invalidRow('"publication_status" must be "pending" or "published".');
  }
  return status as PublicationStatus;
}

/** The epoch ms of a row timestamp — a parsed row guarantees this succeeds. */
function epochMs(iso: string): number {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    throw invalidRow(`"${iso}" is not an ISO timestamp.`);
  }
  return ms;
}
