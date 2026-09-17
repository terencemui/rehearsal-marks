import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BANNED_PREFIX } from './errors';

/** The repo-root-relative baseline migration, checked like a consumer would check it. */
const migrationUrl = resolve(
  process.cwd(),
  'supabase/migrations/20260917000000_init.sql',
);

/**
 * The baseline migration's contracts, pinned the way the seed test pins the
 * seed: what an actor can and cannot read or write is the database's own rule,
 * so this test holds the migration to the ticket's promises — the projects
 * table's columns, the RLS boundaries, and the moderation gate. The migration
 * is SQL, so these are text contracts — but each one is a promise the app's
 * behaviour depends on, and a drift here fails loudly in this suite instead of
 * silently in production.
 *
 * This file guards a squashed baseline, so it carries a second job: the
 * objects a squash can lose silently. `set_updated_at` and `delete_my_account`
 * were introduced by migrations the projects rewrite never touched, and the
 * bans table's `revoke` is invisible in the projects table's own grants — all
 * three are asserted below, because nothing else would have caught their loss.
 */
describe('the baseline migration', () => {
  const migration = readFileSync(migrationUrl, 'utf8');

  it('defines the projects table with every column the ticket names', () => {
    // Ownership comes from the session and cascades on account delete.
    expect(migration).toMatch(
      /owner_id uuid not null default auth\.uid\(\)[\s\S]*?references auth\.users \(id\) on delete cascade/,
    );
    // The user's editable name, distinct from the canonical, non-editable
    // recording title.
    expect(migration).toMatch(/name text not null check \(btrim\(name\) <> ''\)/);
    expect(migration).toMatch(/recording_title text not null check \(btrim\(recording_title\) <> ''\)/);
    // Recording identity, content documents, visibility, status, and stamps.
    expect(migration).toMatch(/video_id text not null check \(video_id ~ '\^\[A-Za-z0-9_-\]\{11\}\$'\)/);
    expect(migration).toMatch(/duration double precision not null/);
    expect(migration).toMatch(/markers jsonb not null/);
    expect(migration).toMatch(/movements jsonb not null default '\[]'::jsonb/);
    expect(migration).toMatch(
      /visibility text not null default 'public'\s+check \(visibility in \('public', 'private'\)\)/,
    );
    expect(migration).toMatch(
      /publication_status text not null default 'pending'\s+check \(publication_status in \('pending', 'published', 'rejected'\)\)/,
    );
    expect(migration).toMatch(/created_at timestamptz not null default now\(\)/);
    expect(migration).toMatch(/updated_at timestamptz not null default now\(\)/);
  });

  it('keeps the bans table out of every client role\'s reach', () => {
    expect(migration).toMatch(
      /create table public\.banned_users \(\s+id uuid primary key references auth\.users \(id\) on delete cascade/,
    );
    // The load-bearing revoke. Supabase's default privileges grant anon and
    // authenticated full access to every new table in `public`, so creating
    // this table without the revoke would leave the bans table readable *and*
    // writable by any client — a hole that no other assertion here would catch.
    expect(migration).toMatch(
      /revoke all on public\.banned_users from anon, authenticated;/,
    );
  });

  it('carries the objects a baseline must not silently lose', () => {
    // Both predate the projects rewrite and are named nowhere else in it, so a
    // squash that concatenated the projects migration alone would drop them.
    // set_updated_at is loud (the stamp trigger names it); delete_my_account is
    // silent — the app's delete-account path would simply stop existing.
    expect(migration).toMatch(
      /create or replace function public\.set_updated_at\(\)[\s\S]*?language plpgsql/,
    );
    expect(migration).toMatch(
      /create or replace function public\.delete_my_account\(\)[\s\S]*?security definer/,
    );
    // Its execute right is the whole reason the RPC is callable at all.
    expect(migration).toMatch(
      /revoke execute on function public\.delete_my_account\(\) from public;/,
    );
    expect(migration).toMatch(
      /grant execute on function public\.delete_my_account\(\) to authenticated;/,
    );
  });

  it('grants service_role its access explicitly, not by inheritance', () => {
    // The client roles are bounded above; service_role is the trusted
    // server-side role — the maintainer's moderation path and the seed. Its
    // privileges have to be stated here rather than inherited from the
    // platform's default privileges, which differ between a hosted project and
    // a locally built one: a table created by `postgres` inherits defaults
    // that give service_role no DML at all. Inheriting leaves the schema
    // dependent on where it was built, and the gap is invisible until a
    // service-key script fails in one environment and not the other.
    expect(migration).toMatch(
      /grant select, insert, update, delete on public\.projects to service_role;/,
    );
    expect(migration).toMatch(
      /grant select, insert, update, delete on public\.banned_users to service_role;/,
    );
  });

  it('is a baseline, not a transition — it never names the retired world', () => {
    // A squashed baseline builds the schema from nothing, so any `drop` of a
    // schema object or `rename to` in it is a transition statement that
    // survived the squash — and would fail on a fresh database, where the
    // objects it names were never created.
    expect(migration).not.toMatch(/\bdrop\s+(table|function|policy|trigger|index)\b/i);
    expect(migration).not.toMatch(/\brename\s+to\b/i);
    // The Commons and its label sets are retired (ADR-0006); the baseline must
    // not refer to them in any form.
    expect(migration).not.toMatch(/label_sets/i);
    expect(migration).not.toMatch(/contributor/i);
  });

  it('shows anonymous readers published public projects only, banned owners excluded', () => {
    expect(migration).toMatch(
      /create policy "Published public projects are readable by anyone"[\s\S]*?visibility = 'public'\s+and publication_status = 'published'\s+and not public\.user_banned\(owner_id\)/,
    );
    // The ban check runs as its definer — a client role with no grant on the
    // bans table can still evaluate it.
    expect(migration).toMatch(/create or replace function public\.user_banned[\s\S]*?security definer/);
  });

  it('gives an owner their own projects in every status and visibility, with ownership never client-settable', () => {
    // The signed-in select spans every status and both visibilities.
    expect(migration).toMatch(
      /create policy "Users read their own and published public projects"[\s\S]*?or owner_id = auth\.uid\(\)/,
    );
    expect(migration).toMatch(/with check \(owner_id = auth\.uid\(\)\)/);

    // The client's insert carries the project's content; ownership defaults
    // to auth.uid() and status defaults to pending — neither is insertable.
    const insertGrant = migration.match(/grant insert \(([^)]*)\)[\s\S]*?on public\.projects to authenticated;/);
    expect(insertGrant?.[1]).toBe(
      'name, recording_title, video_id, duration, markers, movements, visibility',
    );
    expect(insertGrant?.[1]).not.toContain('owner_id');
    expect(insertGrant?.[1]).not.toContain('publication_status');

    // The client edits name, content, and visibility — never ownership, the
    // recording identity, or the review status.
    const updateGrant = migration.match(/grant update \(([^)]*)\)[\s\S]*?on public\.projects to authenticated;/);
    expect(updateGrant?.[1]).toBe('name, markers, movements, visibility');
    expect(updateGrant?.[1]).not.toContain('owner_id');
    expect(updateGrant?.[1]).not.toContain('publication_status');
    expect(updateGrant?.[1]).not.toContain('recording_title');
    expect(updateGrant?.[1]).not.toContain('video_id');
  });

  it('auto-publishes a trusted owner\'s new public project, with no rate limit and no published-per-video guard', () => {
    expect(migration).toMatch(/create or replace function public\.user_is_trusted[\s\S]*?security definer/);
    expect(migration).toMatch(
      /if tg_op = 'INSERT' then[\s\S]*?if public\.user_is_trusted\(new\.owner_id\) then\s+new\.publication_status = 'published';/,
    );
    // The queue's two limits are gone: no submission counter, no window, and
    // no unique index bounding one published project per video.
    expect(migration).not.toMatch(/v_recent_submissions/);
    expect(migration).not.toMatch(/interval '7 days'/);
    expect(migration).not.toMatch(/create unique index/);
  });

  it('returns an owner\'s edit of a published or rejected public project to the queue', () => {
    expect(migration).toMatch(
      /if old\.publication_status = 'published' then\s+if not public\.user_is_trusted\(new\.owner_id\) then\s+new\.publication_status = 'pending';/,
    );
    expect(migration).toMatch(
      /if old\.publication_status = 'rejected' then[\s\S]*?when public\.user_is_trusted\(new\.owner_id\) then 'published'/,
    );
    // A private project made public enters the queue the same way.
    expect(migration).toMatch(
      /if old\.visibility = 'private' and new\.visibility = 'public' then[\s\S]*?else 'pending'/,
    );
  });

  it('lets private-project writes bypass the moderation gate entirely', () => {
    // The gate's first branch passes every private write through before the
    // ban check and the trusted auto-publish.
    expect(migration).toMatch(/if new\.visibility = 'private' then\s+return new;/);
    expect(migration).toMatch(
      /if current_user <> 'authenticated' then\s+return new;[\s\S]*?if new\.visibility = 'private' then\s+return new;/,
    );
  });

  it('refuses a banned owner\'s public writes with the prefix the transport translates', () => {
    expect(migration).toMatch(/before insert or update on public\.projects/);
    expect(migration).toMatch(
      /if public\.user_banned\(new\.owner_id\) then\s+raise exception 'BANNED:/,
    );
    expect(migration).toContain(`'${BANNED_PREFIX}:`);
  });

  it('gives the maintainer a moderation surface no client role can execute', () => {
    expect(migration).toMatch(/create or replace function public\.moderate_project[\s\S]*?security definer/);
    for (const action of ['publish', 'reject', 'unpublish']) {
      expect(migration).toContain(`when '${action}' then`);
    }
    expect(migration).toMatch(/revoke execute on function public\.moderate_project\(uuid, text\) from public;/);
  });
});
