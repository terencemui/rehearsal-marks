import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMarkers, parseMovements } from '../domain';

/** The repo-root-relative seed file, checked like a consumer would check it. */
const seedUrl = resolve(process.cwd(), 'supabase/seed.sql');

/**
 * The development fixture, checked for the invariants that exist today: it
 * must create its own owner, so a `db reset` succeeds on any machine with no
 * account pre-created; its markers and movements must parse under the domain's
 * own rules; and the row must carry the project shape — editable name distinct
 * from the canonical recording title, public and published. The video identity
 * facts (the canonical URL and duration) are pinned here so an edit can't
 * silently re-key the row to another recording. The row's shape is otherwise
 * pinned by these SQL-text assertions.
 */
describe('the development seed', () => {
  it('is one published public project for the Tchaikovsky No. 5 video, with parseable content', () => {
    const seed = readFileSync(seedUrl, 'utf8');

    const videoId = firstVideoId(seed);
    const [markers, movements] = seedDocuments(seed);

    // The recording identity the ticket promises: the video's canonical URL
    // documented beside the row, and the video's own duration as the row's.
    expect(seed).toMatch(/https:\/\/www\.youtube\.com\/watch\?v=a_B02BZp-5Y/);
    expect(videoId).toBe('a_B02BZp-5Y');
    expect(seed).toMatch(/3036\.0/);

    // The seed is a project, not a label set: it inserts into `projects`, and
    // the user's editable name is distinct from the canonical recording title.
    expect(seed).toMatch(/insert into public\.projects/);
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

  it('creates its own owner, so a reset needs no account to exist first', () => {
    const seed = readFileSync(seedUrl, 'utf8');

    // The fixture supplies the account the project is foreign-keyed to...
    expect(seed).toMatch(/insert into auth\.users/);
    expect(seed).toMatch(/'dev@example\.com'/);
    expect(seed).toMatch(/on conflict \(id\) do nothing/);

    // ...rather than looking one up by an address that must already exist.
    // That lookup aborted every `db reset` on a machine without the account,
    // and keeping it working meant committing a real address to a public repo.
    // Neither may come back.
    expect(seed).not.toMatch(/where email =/);
    expect(seed).not.toMatch(/raise exception/);

    // The project names the account this same file creates: a mismatch is an
    // FK violation on reset, not a silent no-op.
    const created = uuidsAfter(seed, /insert into auth\.users/);
    const referenced = uuidsAfter(seed, /insert into public\.projects/);
    expect(referenced).toContain(created[0]);
  });
});

/**
 * The uuids the SQL names from the marked statement onward, in order. The
 * markers and movements documents are excluded for free: their ids are
 * double-quoted JSON, not single-quoted SQL.
 */
function uuidsAfter(sql: string, marker: RegExp): string[] {
  const from = sql.slice(marker.exec(sql)?.index ?? 0);
  return [...from.matchAll(
    /'([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'/g,
  )].map((match) => match[1]);
}

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
