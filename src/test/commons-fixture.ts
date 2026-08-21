import type { LabelSetRow } from '../commons/labelSet';
import { marker } from './marker-fixture';

/** The video the fixture row belongs to — the ID the review fixtures query for. */
export const COMMUNITY_VIDEO_ID = 'dQw4w9WgXcQ';

/** Test fixture for a published Commons row with sensible defaults. */
export function labelSetRow(overrides: Partial<LabelSetRow> = {}): LabelSetRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    video_id: COMMUNITY_VIDEO_ID,
    contributor_id: '22222222-2222-4222-8222-222222222222',
    title: 'A labeled performance',
    duration: 604.2,
    markers: [marker('m1', 10, ['Recap'], 1), marker('m2', 222.35, [], 2)],
    publication_status: 'published',
    created_at: '2026-08-20T12:00:00Z',
    updated_at: '2026-08-20T12:00:00Z',
    ...overrides,
  };
}
