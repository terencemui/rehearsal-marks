# ADR-0002 — YouTube-only projects: uploads, Library, and import/export removed

**Status:** Accepted — 2026-08-22
**Supersedes:** spec 0001's upload, waveform, Library, and export/import sections (see _Consequences → What this invalidates_)

## Context

Spec 0001 shipped three ways to start a project: **upload** an MP3 or M4A,
**browse a curated Library** of CC0 recordings, or **paste a YouTube link**.
Each path dragged its own cost behind it:

- **Uploads** put the recording *in the browser* — IndexedDB blobs, a
  `sha256` pass, WAV/FLAC rejection with conversion guidance, quota
  handling, and an honest "storage full" message. That is storage and
  format support for material the app never owned and could only evict.
- **The Library** was a catalog of CC0 recordings whose rows promise
  license and attribution — a claim that warrants a maintainer and a git
  review workflow. Its contribution path was the one-file-PR flow, which
  assumes a GitHub-literate contributor: exactly the exclusion ADR-0001
  already removed for the Commons. Its `library-cache` store, its R2 audio,
  and its catalog maintenance doc were all machinery serving a second,
  GitHub-shaped audience the app no longer wants to reach.
- **Import/export** existed as the backstop for browser eviction — a zip of
  marks plus audio. It only made sense while there was audio to carry and a
  file to contribute by PR.

The rescope (issue #60, tickets T28–T33) cuts all of that. The decision this
document records is which one path remains and why.

## Decision

**Every project is a YouTube project.** Uploads and the Library are removed,
so the recording is always a YouTube video, streamed from Google, and the
player is always the **ruler** — there is no audio to decode, so there is no
waveform and no double-click-to-add. **Import and export are removed**: the
Commons already round-trips a project's marks and recording identity, so a
file format carrying audio bytes has nothing left to carry.

Supporting choices:

- **One create surface.** Pasting a YouTube link is the only way into a
  project. The recording identity is the video ID (stored as the canonical
  URL) plus duration as a soft check — no sha256, no blob, no source
  discriminator.
- **The ruler is the view, not a fallback.** Spec 0001's "ruler-only
  mode" degraded to ticks when a decode failed; now ticks *are* the view.
- **The Commons is the only durable home for marks.** Without export, a
  browser can still evict a project's local marks (most aggressively in iOS
  Safari, ~7 days). The one way a mark survives eviction is publication —
  which makes it public by definition. The Help tab says exactly that.

## Consequences

### What this buys

- **No audio in the browser.** No blobs, no quota handling, no decode, no
  format whitelist. Storage is marks and a video ID — nearly nothing to
  evict, and nothing to hash.
- **One honest storage story.** The browser copy is a cache; the Commons is
  the durable home. There is no export to mislead anyone into thinking a
  download is a backup.
- **A single maintainer role.** Moderation of the Commons only. The catalog
  (CC0 verification, R2 uploads, catalog rows, label-set PR review) is gone.

### What it costs

- **No offline or private recordings.** A project needs YouTube reachable,
  and there is no way to mark a file the user cannot publish. Practicing
  against an unreachable video degrades to a stored-duration ruler.
- **Eviction is harsher.** The only durable copy of a mark is a *public*
  copy. A user who wants to keep a private mark has no backstop but the
  browser's own storage.

### What this invalidates

| Where | What is now false |
| --- | --- |
| spec 0001 — Solution | "uploads … sees a waveform … export as a portable zip … curated library" |
| spec 0001 — stories #1–#3 | upload MP3/M4A, WAV/FLAC guidance |
| spec 0001 — stories #9–#10 | double-click / long-press the waveform to add |
| spec 0001 — story #6, #40–#44 | the Library tab, its catalog, cache, and Load flow |
| spec 0001 — stories #29–#31 | zoom, and ruler-only as a *fallback* (the ruler is the view now) |
| spec 0001 — stories #34–#39 | storage-full message, zip/label-set export, import |
| spec 0001 — story #48–#49 | one-file-PR contribution for library recordings |
| spec 0001 — Implementation Decisions | Storage (blob, sha256, quota), Audio pipeline (peaks), App shell (three tabs), Export/import, Library & community |
| ADR-0001 — final note | "the CC0 Library catalog [is] unaffected" — the Library is now retired entirely |

The domain glossary (`CONTEXT.md`), the Help tab, `CONTRIBUTING.md`, and the
keyboard reference were rewritten to match; `library/` and
`docs/maintainer-catalog.md` were deleted. The `library-cache` IndexedDB store
is now vestigial — `src/storage/db.ts` still creates it in the v1 migration,
but nothing reads it — and its removal is left as a later migration.

## Alternatives considered

**Keep uploads for private recordings.** Retaining an upload path would
preserve the ability to mark a file that cannot be published. **Rejected**
because it re-opens everything this rescope closes — blob storage, quota, a
decode pipeline, and a format whitelist — for a use case the Commons cannot
serve and the app was not built to hold.

**Keep the Library as a read-only browse surface.** A catalog without the
contribution flow would still need a maintainer to verify CC0 status and host
audio. **Rejected** because the Commons already hosts the one shared thing
the app needs (marks), and the Library's value was its promise of license and
attribution — a promise ADR-0001's Commons does not make, and which the
rescope does not want to make on the app's behalf.

**Keep export as the eviction backstop.** A label-set-only export would give
private marks a durable home without publication. **Rejected** because the
Commons already round-trips a project's marks and identity; reintroducing a
file format for a private copy would restore import validation for a path the
app no longer has, and its absence keeps the storage story honest — the
browser is a cache, the Commons is durable.
