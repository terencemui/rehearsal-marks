import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BANNED_PREFIX, RATE_LIMITED_PREFIX } from '../auth/write';

/** The repo-root-relative moderation migration, checked like a consumer would check it. */
const migrationUrl = resolve(process.cwd(), 'supabase/migrations/20260820140000_moderation_gate.sql');

/**
 * The moderation gate's cross-file contracts, pinned the way the seed test
 * pins the seed: the app's transport matches the trigger's exception
 * prefixes, the row parser accepts the statuses the constraint allows, and
 * the RLS policies hide exactly what the ticket promises. The migration is
 * SQL, so these are text contracts — but each one is a promise the app's
 * behaviour depends on, and a drift here fails loudly in this suite instead
 * of silently in production.
 */
describe('the moderation-gate migration', () => {
  const migration = readFileSync(migrationUrl, 'utf8');

  it('accepts the third status the app\'s row parser accepts: rejected', () => {
    expect(migration).toMatch(/publication_status in \('pending', 'published', 'rejected'\)/);
  });

  it('raises the exact prefixes the write transport translates', () => {
    expect(migration).toContain(`'${RATE_LIMITED_PREFIX}:`);
    expect(migration).toContain(`'${BANNED_PREFIX}:`);
  });

  it('hides banned contributors\' published rows from anonymous readers', () => {
    // The anon select policy consults the ban helper — the ticket's "a
    // contributor can be banned, which hides their published label sets".
    expect(migration).toMatch(
      /create policy "Published label sets are readable by anyone"[\s\S]*?not public\.contributor_banned\(contributor_id\)/,
    );
    // And the ban check itself runs as its definer — a client role with no
    // grant on the contributors table can still evaluate it.
    expect(migration).toMatch(/create or replace function public\.contributor_banned[\s\S]*?security definer/);
  });

  it('refuses a banned contributor\'s writes, insert and update alike', () => {
    // The gate fires on every contributor write; the ban check runs first,
    // so a banned account can neither submit nor edit a row back into the
    // queue.
    expect(migration).toMatch(/before insert or update on public\.label_sets/);
    expect(migration).toMatch(/if public\.contributor_banned\(new\.contributor_id\) then/);
  });

  it('rate-limits submissions per contributor per period — resubmissions included', () => {
    // The insert branch counts rows created in the rolling 7-day window.
    expect(migration).toMatch(/count\(\*\) into v_recent_submissions[\s\S]*?created_at > now\(\) - interval '7 days'/);
    expect(migration).toMatch(/if v_recent_submissions >= 3 then/);
    // The update branch counts queue-returning edits (rejected set
    // resubmitted, published set edited) against the same window, using the
    // edit stamp T23's set_updated_at maintains.
    expect(migration).toMatch(/if old\.publication_status in \('rejected', 'published'\) then/);
    expect(migration).toMatch(/updated_at > now\(\) - interval '7 days'/);
  });

  it('auto-publishes once a contributor has a track record', () => {
    // The trust rule lives in one security-definer helper — one threshold,
    // consulted by both triggers; the auto-publish defers to the
    // published-per-video unique index.
    expect(migration).toMatch(/create or replace function public\.contributor_is_trusted[\s\S]*?security definer/);
    expect(migration).toMatch(/if public\.contributor_is_trusted\(new\.contributor_id\) and not exists/);
  });

  it('gives the maintainer a moderation surface no client role can execute', () => {
    expect(migration).toMatch(/create or replace function public\.moderate_label_set[\s\S]*?security definer/);
    for (const action of ['publish', 'reject', 'unpublish']) {
      expect(migration).toContain(`when '${action}' then`);
    }
    expect(migration).toMatch(/revoke execute on function public\.moderate_label_set\(uuid, text\) from public;/);
  });

  it('returns a contributor\'s edit of a rejected row to review', () => {
    expect(migration).toMatch(/if old\.publication_status = 'rejected' then/);
    expect(migration).toMatch(/when public\.contributor_is_trusted\(new\.contributor_id\) then 'published'/);
    expect(migration).toMatch(/new\.publication_status = case\s*when public\.contributor_is_trusted\(new\.contributor_id\) then 'published'\s*else 'pending'\s*end/);
  });
});
