# The community library

Pre-marked CC0 recordings that load instantly into an editable project. This
directory **is** the library: the app fetches `library.json` from the site
root, and the label sets sit beside it. Audio is **never committed here** — it
lives on a static host and the catalog points at it by URL.

## Layout

```
library/
├── library.json              # the catalog manifest — one row per recording
└── labelsets/
    └── <entry-id>.json       # one label set per entry, named after its id
```

- **`library.json`** — `{ "schemaVersion": 1, "entries": [...] }`. One entry
  per recording, with the facts the app lists and the trust anchors it verifies:
  `id`, `composer`, `piece`, `performer`, `duration` (seconds), `license`,
  `attribution`, `audioUrl`, `sha256`, `labelsetUrl` (relative to this file).
  `id` must be unique; the label set file is `<id>.json`; `sha256` is the
  lowercase hex digest of the **hosted audio file's bytes**.
- **`labelsets/<id>.json`** — a `project.json` label set in the app's export
  format: markers (with informational labels), plus the recording's identity
  in `audioMeta` (`sha256`, `duration`, `mimeType`, `filename`, `sizeBytes`,
  `source`, `license`, `attribution`). The app rejects a label set whose
  `sha256` doesn't match the catalog row — marks never transfer between
  performances.
- **Audio** — hosted outside the repo (Cloudflare R2 in production; the demo
  entry streams from archive.org), and must be served with CORS
  (`Access-Control-Allow-Origin: *`) so the browser can fetch and cache it.
  The sha256 in the catalog is computed on the hosted file itself, so moving
  hosts changes `audioUrl` but never the hash.

## How loading works

The Library tab fetches the manifest, then Load streams the audio from its
URL immediately while the full download runs in the background — it is
sha256-verified against the catalog before the first cache write, and repeat
loads come straight from that cache, offline. The loaded entry seeds an
**editable user project** (marks copied in, fresh project id); the catalog
then shows the entry as Loaded and opens that copy instead of seeding a
duplicate.

## Contributing a label set

1. Pick a recording already in `library.json` (audio is added by maintainers
   only — contributors mark existing recordings).
2. Open it in the app, place your rehearsal marks, then export the label set
   (a single `project.json` file).
3. Open a PR that adds **one file**: `library/labelsets/<entry-id>.json`.
   The app validates `sha256`, marker ids, and alias rules on import, and a
   hand-checked PR review keeps the marks honest.

## Copyright posture

Catalog entries must be **CC0 / public-domain-dedicated recordings** (e.g.
Musopen, the Open Goldberg Variations). A public-domain composition does not
make a recording public domain — only an explicit dedication counts, and
IMSLP recordings are excluded (per-file, often non-commercial licenses).
Label sets are facts about a recording and are unproblematic to share.

## The demo entry

`goldberg-aria` is the Open Goldberg Variations Aria (Kimiko Ishizaka, CC0),
mirrored on archive.org. Its three marks sit at the section onsets — the A
repeat (~74.95s), the B section (~148.7s), and the B repeat (~221.25s) —
derived from the ~73.5s-periodic silence gaps between the Aria's four
16-bar halves, so they are verifiable structure rather than a listening pass.
Listening-verified marks (the score's true rehearsal letters) are exactly
the kind of contribution the workflow above invites.
