import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMarkers, parseMovements } from '../domain';

/** The repo-root-relative seed file, checked like a consumer would check it. */
const seedUrl = resolve(process.cwd(), 'supabase/seed.sql');

/**
 * The seeded public project, checked for the invariants that exist today: the
 * markers and movements must parse under the domain's own rules, and the row
 * must carry the project shape the ticket promises — owner by email, editable
 * name distinct from the canonical recording title, public and published. The
 * video identity facts (the canonical URL and duration the ticket promises)
 * are pinned here so a seed edit can't silently re-key the row to another
 * recording. A full projects row parser lands with the client migration
 * (T50/T51); until then the row's shape is pinned by these SQL-text assertions.
 */
describe('the seeded public project', () => {
  it('is one published public project for the Tchaikovsky No. 5 video, with parseable content', () => {
    const seed = readFileSync(seedUrl, 'utf8');

    const videoId = firstVideoId(seed);
    const [markers, movements] = seedDocuments(seed);

    // The recording identity the ticket promises: the video's canonical URL
    // documented beside the row, and the video's own duration as the row's.
    expect(seed).toMatch(/https:\/\/www\.youtube\.com\/watch\?v=a_B02BZp-5Y/);
    expect(videoId).toBe('a_B02BZp-5Y');
    expect(seed).toMatch(/3036\.0/);

    // The seed is a project, not a label set: it inserts into `projects`, the
    // owner comes from the maintainer's auth.users email, and the user's
    // editable name is distinct from the canonical recording title.
    expect(seed).toMatch(/insert into public\.projects/);
    expect(seed).toMatch(/where email = 'you@example\.com'/);
    expect(seed).toMatch(/'Honeck Tchaikovsky 5'/);
    expect(seed).toMatch(/'Tschaikowsky: 5\. Sinfonie – hr-Sinfonieorchester, Manfred Honeck'/);

    // The seed's whole point is a visible gallery row at launch: public and
    // published.
    expect(seed).toMatch(/'public'/);
    expect(seed).toMatch(/'published'/);

    // The markers parse under the domain's own rules — the guard that keeps a
    // project no reader can parse out of the store. The four movement starts
    // come from the video's chapter list; the rest are development dummies
    // spaced within each movement's range.
    const parsed = parseMarkers(markers);
    expect(parsed.map((m) => m.time)).toEqual([
      34, 150, 300, 450, 600, 750,
      913, 1100, 1300, 1500, 1700,
      1743, 1800, 1900, 2000,
      2074, 2200, 2400, 2600, 2800, 3000,
    ]);

    // The movements parse too, carrying the same four starts as their
    // boundaries (ADR-0005), so the project groups its markers under sticky
    // movement headers and restarts its rehearsal letters at each one.
    const parsedMovements = parseMovements(movements);
    expect(parsedMovements.map((mv) => mv.start)).toEqual([34, 913, 1743, 2074]);
  });
});

/** The video ID the seed inserts — the first quoted 11-character token. */
function firstVideoId(seed: string): string {
  const match = /'([A-Za-z0-9_-]{11})'/.exec(seed);
  if (!match) throw new Error('No video ID found in supabase/seed.sql');
  return match[1];
}

/** The jsonb document literals the seed inserts, in order: markers, movements. */
function seedDocuments(seed: string): unknown[] {
  const matches = [...seed.matchAll(/'(\[[\s\S]*?\])'::jsonb/g)];
  if (matches.length < 2) {
    throw new Error('Expected markers and movements jsonb literals in supabase/seed.sql');
  }
  return matches.map((match) => JSON.parse(match[1]));
}
