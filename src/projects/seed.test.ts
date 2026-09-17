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

    // Structural claims run against the executable SQL, with comments
    // stripped: a presence assertion against the raw file is satisfied by
    // prose, so commenting out the insert it is guarding would leave it green.
    const sql = executableSql(seed);

    // The fixture supplies the account the project is foreign-keyed to...
    expect(sql).toMatch(/insert into auth\.users/);
    expect(sql).toMatch(/'dev@example\.com'/);
    expect(sql).toMatch(/on conflict \(id\) do nothing/);

    // ...rather than looking one up by an address that must already exist.
    // That lookup aborted every `db reset` on a machine without the account,
    // and keeping it working meant committing a real address to a public repo.
    // The ban is on the lookup, not on raising in general: a seed that refuses
    // to run against a database it was not meant for is worth having.
    expect(sql).not.toMatch(/where email =/);

    // The project's `owner_id` is the second value in its insert — the row's
    // own id comes first — and it must be the account this same file created,
    // so a mismatch is an FK violation on reset rather than a silent no-op.
    // Positional on purpose: `toContain` alone is existential and would pass
    // with the id appearing anywhere at all.
    const created = uuidsAfter(sql, /insert into auth\.users/);
    const referenced = uuidsAfter(sql, /insert into public\.projects/);
    expect(referenced[1]).toBe(created[0]);
  });
});

/**
 * The seed's executable SQL, with comments removed so that an assertion about
 * what the file *does* cannot be satisfied by what it *says*. The seed's
 * strings carry no `--` or `/*`, so line comments cannot hide inside a literal
 * here; a brace-aware pass would be needed if that ever changed.
 */
function executableSql(seed: string): string {
  return seed.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

/**
 * The uuids the SQL names from the marked statement onward, in order. The
 * markers and movements documents are excluded for free: their ids are
 * double-quoted JSON, not single-quoted SQL. A marker that does not match
 * throws rather than scanning from the top of the file, which would answer
 * with the wrong statement's uuids and quietly pass the cross-check above.
 */
function uuidsAfter(sql: string, marker: RegExp): string[] {
  const at = marker.exec(sql);
  if (!at) throw new Error(`Marker ${marker} not found in supabase/seed.sql`);
  return [...sql.slice(at.index).matchAll(
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
