# ADR-0001 — Hosted label-set backend with Google sign-in

**Status:** Accepted — 2026-08-20
**Supersedes:** parts of issue #20 (see _Consequences → What this invalidates_)

## Context

The app is client-only by design: projects live in the browser, and community
**label sets** are contributed as pull requests against this repo — one JSON file
plus one catalog index row. Issue #20 states the posture plainly: _"The app stays
client-only: no server."_ The Help tab promises that marks never leave the
browser.

That contribution flow silently assumes contributors have GitHub accounts and
know what a pull request is. The actual target contributor is a classical music
student — a conservatory cellist pinning **rehearsal marks** to a Mahler
recording. They are not developers. The PR flow does not exclude them by
accident; it excludes them by construction.

Two questions had to be answered together, because the second depends on the
first:

1. **Who contributes?** Developers (GitHub-literate) or musicians (not)?
2. **Where do contributed label sets live?** Git, or a database?

Sizing established that the data itself is nearly free. A label set is a
document of ~30 **markers**; normalized it is ~3.5 KB, so a million contributed
label sets fit in ~3.5 GB. Storage was never going to be the constraint. The
cost is in identity, moderation, and the duty of holding user records.

## Decision

**Contributors are not assumed to be GitHub-literate.** Community label sets move
out of git and into a hosted Postgres database (Supabase), with contribution
gated behind **Sign in with Google**. Viewing stays anonymous — no account is
needed to read community label sets.

Supporting choices:

- **Supabase over Cloudflare Workers + D1.** D1 is cheaper on paper, but with
  auth in scope Supabase removes the API layer entirely: Google sign-in is a
  dashboard config plus `supabase.auth.signInWithOAuth({ provider: 'google' })`,
  and Row Level Security expresses the authorization rule declaratively —
  `anon` reads, `authenticated` writes, owner edits. On D1 all of that is
  hand-rolled. The labor saved exceeds the price difference.
- **Google only; no password login.** Email/password would add hash storage and
  breach liability, an email-delivery vendor for resets, and recurring support
  load — strictly more cost than the option it replaces. Additional providers
  are later config changes, not rewrites.
- **A label set is stored as a document, not as rows.** `markers` is a `jsonb`
  column on a single `label_sets` row. This keeps RLS single-table (no ownership
  joins through a child table), makes a read 1 row instead of ~31, and
  round-trips to the existing export format with no impedance mismatch.
- **Publication status is the moderation gate.** Rows default to `pending` and
  are invisible to `anon` until `published`. The column is excluded from the
  `authenticated` update grant, so a contributor cannot self-publish — an
  `UPDATE` policy's `with check` validates ownership only, not column values.

## Consequences

### What this buys

Contribution is open to the audience the app is actually for. A musician can
publish a label set without knowing git exists.

### What it costs

- **~$25/month.** Supabase Pro. The Free tier fits on size but pauses projects
  after a week of inactivity, which is not acceptable for a public read path.
  Auth is free well past any plausible scale (50,000 MAU included).
- **Moderation, permanently.** This is the real bill, and it is paid in time.
  Google accounts are free and bulk-creatable, so Sign in with Google stops
  casual vandalism and nothing more. What protects the catalog is human review
  of every `pending` row. The PR flow got that labor from GitHub for free; it now
  falls to the maintainer. An escape valve (auto-publish after N accepted
  contributions from the same contributor) should be designed before the queue
  becomes painful.
- **The privacy posture changes.** The app now holds user records and streams
  contributed content from a server. This requires a privacy policy, terms, and
  a working account-deletion path — `on delete cascade` from `auth.users` covers
  the data, but the obligation is new.
- **A new failure mode.** Previously a CDN outage was the worst case. Now a
  database outage means nobody can read community label sets at all. Projects
  themselves remain local and unaffected.

### What this invalidates

| Where | What is now false |
| --- | --- |
| #20 — Implementation Decisions | _"The app stays client-only: no server"_ |
| #20 — story #29, Help tab copy | _"marks never leave the browser"_ — untrue for contributions |
| #20 — story #30 | one-file-PR contribution flow — retired |
| #28 (T21) | fetches a static index file — now a backend query |
| #29 (T22) | seeds a git catalog for PR review — flow retired |

Uploaded-recording projects, YouTube playback (#23/T16), and the CC0 **Library**
catalog are all unaffected. The Library keeps its separate git-based flow: its
rows promise license and attribution, which is a claim that warrants human
review at contribution time.

### Glossary gap

This decision introduces two terms not yet in `CONTEXT.md`:

- **Contributor** — a signed-in user who owns the label sets they publish.
- **Publication status** — whether a label set is visible to anonymous readers
  (`pending` until reviewed, then `published`).

Both should be added when the domain model is next revised.

## Alternatives considered

**GitHub App SPA client (preview) with PR-on-behalf.** Technically the strongest
option: `$0/month`, no server, no database, no user records, and the client-only
posture survives intact. The GitHub Apps SPA client type forbids the client
secret, mandates PKCE, and enables CORS on the token endpoint, so a static SPA
can complete the flow and open a PR as the contributor. **Rejected because it
requires every contributor to have a GitHub account** — precisely the exclusion
this ADR exists to remove. Worth revisiting only if the contributor audience
changes back.

**Cloudflare Workers + D1.** ~$0–5/month and no egress charges, but every piece
of auth, session handling, and authorization is hand-written. Rejected on labor,
not cost.

**Keep git for reads, add a server only for submission intake.** A write-only
endpoint that opens a PR on the contributor's behalf. Rejected together with the
GitHub-account requirement it implies; without that requirement the server would
be vouching for anonymous submissions, which returns the moderation burden
without returning the benefit.
