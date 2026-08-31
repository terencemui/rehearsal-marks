import { describe, expect, it } from 'vitest';
import { marker } from '../test/marker-fixture';
import { ProjectsError } from './errors';
import {
  parseProjectRow,
  summarizeProject,
  type ProjectSummary,
  type ServerProject,
} from './types';

/** A PostgREST row as `select *` returns it — snake_case, ISO timestamps. */
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'a5cff0b4-0000-4000-8000-000000000001',
    owner_id: 'user-1',
    name: 'Brahms Op. 118 No. 2',
    recording_title: 'Brahms: Klavierstücke, Op. 118',
    video_id: 'dQw4w9WgXcQ',
    duration: 123.456,
    markers: [marker('m1', 10, ['Recap'], 1), marker('m2', 20, [], 2)],
    movements: [],
    visibility: 'public',
    publication_status: 'published',
    created_at: '2026-08-28T12:00:00Z',
    updated_at: '2026-08-28T12:00:00Z',
    ...overrides,
  };
}

/** The expected parse of the default row — the contract each override changes. */
function expected(overrides: Partial<ServerProject> = {}): ServerProject {
  return {
    id: 'a5cff0b4-0000-4000-8000-000000000001',
    name: 'Brahms Op. 118 No. 2',
    recordingTitle: 'Brahms: Klavierstücke, Op. 118',
    videoId: 'dQw4w9WgXcQ',
    duration: 123.456,
    markers: [marker('m1', 10, ['Recap'], 1), marker('m2', 20, [], 2)],
    movements: [],
    visibility: 'public',
    publicationStatus: 'published',
    createdAt: Date.parse('2026-08-28T12:00:00Z'),
    updatedAt: Date.parse('2026-08-28T12:00:00Z'),
    ...overrides,
  };
}

function expectInvalid(value: unknown): void {
  expect(() => parseProjectRow(value)).toThrow(ProjectsError);
}

describe('parseProjectRow', () => {
  it('maps a full projects row to the app\'s camelCase project, timestamps as epoch ms', () => {
    expect(parseProjectRow(row())).toEqual(expected());
  });

  it('parses markers and movements through the domain\'s own rules', () => {
    const withMovements = row({
      movements: [
        { id: 'mv1', name: 'I · Allegro', start: 0 },
        { id: 'mv2', name: 'II · Andante', start: 600 },
      ],
    });
    expect(parseProjectRow(withMovements).movements).toEqual([
      { id: 'mv1', name: 'I · Allegro', start: 0 },
      { id: 'mv2', name: 'II · Andante', start: 600 },
    ]);
    // A movement that violates the domain rule (non-increasing start) rejects.
    expectInvalid(
      row({
        movements: [
          { id: 'mv1', name: 'I', start: 10 },
          { id: 'mv2', name: 'II', start: 5 },
        ],
      }),
    );
  });

  it('rejects a row with a blank name or recording title — the table\'s own btrim rule', () => {
    expectInvalid(row({ name: '   ' }));
    expectInvalid(row({ recording_title: '' }));
  });

  it('rejects a video_id that is not the 11-character shape', () => {
    expectInvalid(row({ video_id: 'not-a-video-id' }));
    expectInvalid(row({ video_id: 'short' }));
  });

  it('rejects a non-finite or negative duration', () => {
    expectInvalid(row({ duration: NaN }));
    expectInvalid(row({ duration: -1 }));
    expectInvalid(row({ duration: '123' }));
  });

  it('rejects a visibility or publication status outside the review vocabulary', () => {
    expectInvalid(row({ visibility: 'everyone' }));
    expectInvalid(row({ publication_status: 'live' }));
  });

  it('rejects timestamps nothing can parse', () => {
    expectInvalid(row({ created_at: 'not-a-date' }));
    expectInvalid(row({ updated_at: 0 }));
  });

  it('rejects a non-object row entirely', () => {
    expectInvalid(null);
    expectInvalid([]);
    expectInvalid('a row');
  });
});

describe('summarizeProject', () => {
  it('derives the workspace row: content facts, marker count, and review state', () => {
    const summary: ProjectSummary = {
      id: 'a5cff0b4-0000-4000-8000-000000000001',
      name: 'Brahms Op. 118 No. 2',
      recordingTitle: 'Brahms: Klavierstücke, Op. 118',
      duration: 123.456,
      markerCount: 2,
      visibility: 'public',
      publicationStatus: 'published',
      updatedAt: Date.parse('2026-08-28T12:00:00Z'),
    };
    expect(summarizeProject(parseProjectRow(row()))).toEqual(summary);
  });
});
