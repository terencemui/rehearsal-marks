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
  parseMovements,
  parseYouTubeLink,
  youtubeAudioMeta,
} from '../domain';
import type { AudioMeta, Marker, Movement, ProjectFileData } from '../domain';
import type { ProjectRecord } from '../storage';

export const PUBLICATION_STATUSES = ['pending', 'published', 'rejected'] as const;
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
  /** The recording's movements (ADR-0005) — optional: absent or empty is today's behaviour. */
  movements: Movement[];
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
  movements: Movement[];
}

/**
 * The values a contributor's update may change. Identity (id, video_id),
 * ownership, and publication status are all out of reach — the update grant
 * and the row's round-trip key make re-submission an UPDATE of the same row.
 */
export type LabelSetUpdate = Pick<LabelSetValues, 'title' | 'duration' | 'markers' | 'movements'>;

/**
 * The read projection of a `label_sets` row — the facts an anonymous lookup
 * requests and consumes. The full row (contributor identity, stamps,
 * publication status) belongs to the write and round-trip paths; a reader
 * needs only the identity, the marks, the movements, and the duration they seed.
 */
export interface LabelSetReadRow {
  /** The 11-character YouTube video ID — the row's recording-identity key. */
  video_id: string;
  /** Seconds, float — the soft check of recording identity. */
  duration: number;
  markers: Marker[];
  movements: Movement[];
}

/** The submissions list as a lookup by row id — the badges' source. */
export function rowsById(rows: LabelSetRow[]): Record<string, LabelSetRow> {
  return Object.fromEntries(rows.map((row) => [row.id, row]));
}

/**
 * Parses a `label_sets` row. Tolerates unknown fields (forward
 * compatibility) and validates everything a consumer depends on — markers
 * through the domain's own marker rules, the video ID through the domain's
 * own shape rule — so a bad row is a loud error, never a broken project.
 */
export function parseLabelSetRow(value: unknown): LabelSetRow {
  const row = assertObject(value, 'the row');

  const markers = readRowMarkers(row.markers);
  const movements = readRowMovements(row.movements);

  return {
    id: assertNonEmptyString(row.id, '"id"'),
    video_id: readVideoId(row.video_id),
    contributor_id: assertNonEmptyString(row.contributor_id, '"contributor_id"'),
    title: assertNonEmptyString(row.title, '"title"'),
    duration: assertNonNegativeNumber(row.duration, '"duration"'),
    markers,
    movements,
    publication_status: readStatus(row.publication_status),
    created_at: assertTimestamp(row.created_at, '"created_at"'),
    updated_at: assertTimestamp(row.updated_at, '"updated_at"'),
  };
}

/**
 * Parses the read projection of a `label_sets` row — what the anonymous
 * lookup requests and consumes. Applies the same domain rules the full
 * parser applies to the three fields it reads and tolerates everything
 * else (a full row parses as a projection), so a bad answer is a loud
 * error, never a broken project. Publication status never reaches a reader:
 * the query filter and RLS are its only gate.
 */
export function parseLabelSetReadRow(value: unknown): LabelSetReadRow {
  const row = assertObject(value, 'the row');
  return {
    video_id: readVideoId(row.video_id),
    duration: assertNonNegativeNumber(row.duration, '"duration"'),
    markers: readRowMarkers(row.markers),
    movements: readRowMovements(row.movements),
  };
}

/**
 * The table row a project file publishes: the recording identity resolved to
 * its video ID, the project's name and duration, and the markers themselves.
 * Everything the row parser would reject on the way out is rejected here on
 * the way in — a row no reader can parse never gets written. Every project is
 * a YouTube project, so the recording identity is always a video ID — the
 * guard below still rejects an upload-sourced file for a hand-edited or
 * legacy file's sake, but the app itself can no longer produce one.
 */
export function labelSetValuesFromProjectFile(data: ProjectFileData): LabelSetValues {
  // The file's own discriminator decides; only a YouTube file publishes.
  if (data.project.source !== 'youtube') {
    throw new CommonsError(
      'This label set is for an uploaded recording, and the Commons holds YouTube label sets only.',
      'not-youtube-label-set',
    );
  }

  let link;
  try {
    link = parseYouTubeLink(data.audioMeta.source);
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    // The domain's own guidance, so a playlist source names its actual
    // problem instead of being told it is not YouTube.
    throw new CommonsError(error.message, 'not-youtube-label-set');
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

  let movements: Movement[];
  try {
    movements = parseMovements(data.movements);
  } catch (error) {
    if (
      error instanceof DomainError &&
      (error.code === 'invalid-value' || error.code === 'invalid-movements')
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
    movements,
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
      source: 'youtube',
    },
    markers: row.markers,
    movements: row.movements,
    // The same youtubeAudioMetaFrom the export path passes through, so the
    // row direction and the export direction can never drift apart on which
    // fields describe stored bytes and which carry identity.
    audioMeta: youtubeAudioMetaFrom({ name: row.title, duration: row.duration, videoId: row.video_id }),
  };
}

/**
 * The record's data fields, as the project-file format wants them — the
 * shared conversion behind the Commons submission, so the record direction
 * and the row direction never drift apart on which fields carry recording
 * identity and which describe stored bytes. Every record is a YouTube record,
 * so the file it produces always is too: the canonical URL is derived from the
 * stored video ID, and the upload-only facts are left empty.
 */
export function projectFileFromRecord(record: ProjectRecord): ProjectFileData {
  return {
    project: {
      id: record.id,
      name: record.name,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      source: 'youtube',
    },
    markers: record.markers,
    movements: record.movements,
    audioMeta: youtubeAudioMetaFrom({ name: record.name, duration: record.duration, videoId: record.videoId }),
  };
}

/**
 * The upload-only audio facts a YouTube project file carries, left empty —
 * recording identity lives in the canonical URL and the known duration, nowhere
 * else. Both the record direction and the row direction build through this one
 * function, so neither can drift apart on which fields describe stored bytes.
 */
function youtubeAudioMetaFrom(identity: {
  name: string;
  duration: number;
  videoId: string;
}): AudioMeta {
  return youtubeAudioMeta({
    sha256: '',
    duration: identity.duration,
    mimeType: '',
    filename: identity.name,
    sizeBytes: 0,
    source: canonicalYouTubeUrl(identity.videoId),
    license: '',
    attribution: '',
  });
}

type JsonObject = Record<string, unknown>;

function invalidRow(reason: string): CommonsError {
  return new CommonsError(`Invalid label set row: ${reason}`, 'invalid-label-set-row');
}

/** The row's markers through the domain's own rules — the shared gate of both parsers. */
function readRowMarkers(value: unknown): Marker[] {
  try {
    return parseMarkers(value);
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
}

/**
 * The row's movements through the domain's own rules — the shared gate of both
 * parsers. Absent (a row written before movements existed) reads as none, the
 * same tolerance the project file applies.
 */
function readRowMovements(value: unknown): Movement[] {
  if (value === undefined) return [];
  try {
    return parseMovements(value);
  } catch (error) {
    if (
      error instanceof DomainError &&
      (error.code === 'invalid-value' || error.code === 'invalid-movements')
    ) {
      throw invalidRow(error.message);
    }
    throw error;
  }
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
    throw invalidRow('"publication_status" must be "pending", "published", or "rejected".');
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
