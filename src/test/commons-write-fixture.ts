import { vi } from 'vitest';
import { postgrestErrorToCommonsError } from '../auth/write';
import type { SupabaseCommonsWrite } from '../auth';
import { createCommonsWriteController } from '../commons/write';
import type { CommonsWriteController } from '../commons/write';
import type { LabelSetRow } from '../commons/labelSet';

/**
 * Test double for the SupabaseCommonsWrite seam — the counterpart of
 * mockAuthBackend, faked the way the audio tests fake `window.YT`. The
 * backend holds a rows list the app would have fetched, records every call,
 * and succeeds by default; `failNextInsert` lets a test exercise the
 * submission gate's rejections (rate limit, ban) through the transport's
 * message mapping.
 */
export interface MockCommonsWriteBackend extends SupabaseCommonsWrite {
  /** The backend's own submissions list, as the app would have fetched it. */
  rows: LabelSetRow[];
  /** The next insert rejects with a PostgREST-style error carrying the message. */
  failNextInsert(message: string): void;
}

export function mockCommonsWriteBackend(rows: LabelSetRow[] = []): MockCommonsWriteBackend {
  let nextInsertError: string | null = null;

  return {
    rows,
    insertLabelSet: vi.fn(async (values) => {
      if (nextInsertError !== null) {
        const message = nextInsertError;
        nextInsertError = null;
        // The real transport runs every PostgREST error through the prefix
        // mapping — the fixture must throw the same CommonsError it would.
        throw postgrestErrorToCommonsError({ message });
      }
      rows.unshift({
        id: values.id,
        video_id: values.video_id,
        contributor_id: '22222222-2222-4222-8222-222222222222',
        title: values.title,
        duration: values.duration,
        markers: values.markers,
        publication_status: 'pending',
        created_at: '2026-08-20T12:00:00Z',
        updated_at: '2026-08-20T12:00:00Z',
      });
    }),
    updateLabelSet: vi.fn(async (id, values) => {
      const row = rows.find((r) => r.id === id);
      if (row === undefined) throw { message: 'not found' };
      Object.assign(row, values);
    }),
    listMyLabelSets: vi.fn(async () => [...rows]),
    failNextInsert(message: string) {
      nextInsertError = message;
    },
  };
}

/** A controller over a fresh fake backend, with the backend to drive it. */
export function mockCommonsWrite(
  rows: LabelSetRow[] = [],
): { controller: CommonsWriteController; backend: MockCommonsWriteBackend } {
  const backend = mockCommonsWriteBackend(rows);
  return { controller: createCommonsWriteController(backend), backend };
}
