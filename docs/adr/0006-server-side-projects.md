# ADR-0006 — Server-side projects: one concept, not two

**Status:** Accepted — 2026-08-28
**Supersedes:** ADR-0001 (hosted label-set backend with Google sign-in)

## Context

A student's data is split across two places that are nearly the same shape. Their own **projects** — recordings, movements, markers, aliases — live entirely in the browser's IndexedDB: private by default, unrecoverable if browser data is cleared, impossible to reach from another device, and silently gone the moment a project is deleted. Community **label sets** live on the server in the `label_sets` table (ADR-0001's Commons): published or pending, one per video, readable by anyone. The split makes the app feel half-local and half-shared — none of the user's own work is safe, there is no way to discover what other students have marked, and the labels a student uses every day must be copied out of a set into a project before they are useful.

The Commons already proved the machinery a shared marking surface needs: Row Level Security as the authorization boundary, a `pending → published → rejected` review queue, a trusted-owner escape valve, and a ban table that hides a banned contributor's rows and refuses their writes. That machinery was built for a read-only contribution format; the move here is to make the *project itself* the contribution.

## Decision

**All data moves to the server, and `projects` becomes the app's single server-side concept.** A `projects` table replaces `label_sets`; the browser stores are deleted and no existing browser data is migrated. A project belongs to a signed-in **User** — `owner_id` defaults to `auth.uid()` and is never client-supplied — and is **public by default** (`visibility` public | private), carrying the user's editable `name` alongside the recording's canonical, non-editable `recording_title`, plus the recording identity (`video_id`, `duration`), `markers`, `movements`, `publication_status`, and timestamps.

- **Row Level Security is the authorization boundary.** Anonymous readers select only published public projects, excluding banned owners. An owner selects and writes their own projects in every status and both visibilities. Ownership is never settable by the client; visibility and publication status transitions are bounded by column grants and the gate trigger.
- **The moderation gate is ported with two changes.** A **trusted** User's new public project publishes immediately — unconditionally: the published-per-video unique index is removed (many public projects per recording are allowed) and the submission rate limit is removed. Editing a published public project returns it to pending (unless its owner is trusted). A private project made public enters the queue the same way.
- **The gate applies to public writes only.** Private-project writes bypass it entirely — a private project is visible to its owner alone, so there is nothing to review and nothing to refuse.
- **Bans survive, re-pointed at projects.** A banned owner's public writes are refused and their published public rows are hidden from readers; their private projects keep saving.
- **The seed becomes a published public project** owned by the maintainer, carrying the real Honeck movements and the existing markers. `label_sets` is retired.
- **The maintainer's moderation surface** is ported as `moderate_project(row_id, action)` — strict publish / reject / unpublish transitions over public rows, execute revoked from PUBLIC.

## Consequences

### What this buys

The app's data feels like one thing again. A student's work is safe on the server and reachable from any device; the public gallery makes markings discoverable; and a public project *is* a contribution — there is no separate publish step and no copy. A deployment without the backend shows an honest "not wired up" screen instead of a half-working app.

### What it costs

- **Privacy, permanently.** The app now holds every user's projects and streams them from a server. The privacy policy, terms, and account-deletion path from ADR-0001 remain, now covering projects instead of label sets; the `owner_id` FK cascades on account delete.
- **Moderation, permanently.** Human review of every pending public project is still the real bill. The trusted-user escape valve bounds the queue; the submission rate limit, which tried to bound it further, is gone — the gallery tolerates many projects per recording, and a small community keeps the queue reviewable.
- **A new failure mode.** Previously a database outage blocked only contributions; now it blocks everything, including reading the gallery and a user's own projects.
- **Everything the label-set era built for contributions** — the separate Commons read/write surface, the one-per-video rule, the copy-into-project flow — is deleted rather than migrated.

### What this invalidates

| Where | What is now false |
| --- | --- |
| ADR-0001 | the hosted **label-set** backend — the Commons and its `label_sets` table are retired |
| ADR-0001 — "label sets are stored as documents" | still true in spirit, but now on `projects`, the one concept |
| #20 — Implementation Decisions | _"The app stays client-only: no server"_ |
| #105 (parent) | the browser IndexedDB stores, the local project repository, the Commons read/write, the unconfigured-deployment auth degradation — all replaced by one `ProjectsApi` surface over `projects` |

### Glossary changes

ADR-0001's glossary gap (Contributor, Publication status) is resolved by renaming, not by addition: **Label set** and **Commons** are deleted; **Contributor** becomes **User**; **Publication status** is redefined as applying to public projects only; and the glossary gains **Visibility**, **Public gallery**, **Recording title**, and **Trusted user**. **Project** is redefined as owned, server-side, and visible.

## Considered options

- **Keep the split — browser projects plus server label sets.** The status quo. Rejected: it preserves the half-local/half-shared feel, keeps every student's own work at risk, and forces a copy step before shared marks are usable.
- **Server projects with copying/forking.** Rejected for now (out of scope): public projects are view-only until a later ticket; copying existing public work would blur whose markings a project carries.
- **Keep the submission rate limit and one-per-video rule on projects.** Rejected with the rest of the queue's flood control: many public projects per recording are now a feature, and the limit's only purpose was protecting a curated one-per-video catalog, which no longer exists.
