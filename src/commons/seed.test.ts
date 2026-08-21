import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMarkers } from '../domain';
import { parseLabelSetRow } from './labelSet';

/** The repo-root-relative seed file, checked like a consumer would check it. */
const seedUrl = resolve(process.cwd(), 'supabase/seed.sql');

/**
 * The seeded Commons content, checked the way the app checks a row: the
 * markers must parse under the domain's own marker rules and the full row
 * must parse under the row parser — a row no reader can parse would be
 * invisible in the Commons forever. The video identity facts (the canonical
 * URL and duration the ticket promises) are pinned here so a seed edit can't
 * silently re-key the row to another recording.
 */
describe('the seeded Commons label set', () => {
  it('is one published row for the Tchaikovsky No. 5 video, parseable by the app', () => {
    const seed = readFileSync(seedUrl, 'utf8');

    const videoId = firstVideoId(seed);
    const markers = seedMarkers(seed);

    // The recording identity the ticket promises: the video's canonical URL
    // documented beside the row, and the video's own duration as the row's.
    expect(seed).toMatch(/https:\/\/www\.youtube\.com\/watch\?v=FQzc9c4LOHM/);
    expect(videoId).toBe('FQzc9c4LOHM');
    expect(seed).toMatch(/2790\.0/);
    expect(seed).toMatch(/'published'/);

    // The markers parse under the domain's own rules — the guard that keeps
    // a row no reader can parse out of the store.
    const parsed = parseMarkers(markers);
    expect(parsed.map((m) => m.time)).toEqual([0, 831, 1620, 1965]);

    // And the row as a whole is one the app can load — the seed's own title
    // and markers, with the table-derived fields (id, contributor_id, stamps)
    // filled in as the table would fill them.
    const row = {
      id: '3b3a509d-2f7b-4b6d-9c1a-0e2f8f6d9e4a',
      video_id: videoId,
      contributor_id: '00000000-0000-4000-8000-000000000000',
      title:
        'Tchaikovsky: Symphony No. 5 in E minor, Op. 64 — Gustav Mahler Jugendorchester, Franz Welser-Möst',
      duration: 2790,
      markers,
      publication_status: 'published',
      created_at: '2026-08-20T00:00:00Z',
      updated_at: '2026-08-20T00:00:00Z',
    };
    expect(() => parseLabelSetRow(row)).not.toThrow();
  });
});

/** The video ID the seed inserts — the first quoted 11-character token. */
function firstVideoId(seed: string): string {
  const match = /'([A-Za-z0-9_-]{11})'/.exec(seed);
  if (!match) throw new Error('No video ID found in supabase/seed.sql');
  return match[1];
}

/** The markers jsonb literal the seed inserts, as a parsed array. */
function seedMarkers(seed: string): unknown {
  const match = /'(\[[\s\S]*?\])'::jsonb/.exec(seed);
  if (!match) throw new Error('No markers jsonb found in supabase/seed.sql');
  return JSON.parse(match[1]);
}
