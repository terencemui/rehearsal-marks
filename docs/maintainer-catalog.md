# Maintainer guide: the library catalog

The library is a maintainer role by design, and a small one: verify a CC0
recording, upload it to R2, add a catalog row. Plus one recurring duty:
reviewing label-set pull requests against a fixed checklist. Both are
documented here. This file is the authority on the catalog's rules — when a
rule changes, the spec (0001) and this file change together.

## The CC0-only license rule

Every recording in the library must be **CC0 (public-domain dedication)** or
equivalent explicit public-domain dedication. The rule has two sides:

- **A public-domain composition does not make a recording public domain.**
  A performance carries its own neighboring rights, held by the performers and
  label. Brahms's Op. 118 is public domain; a 1987 Deutsche Grammophon
  recording of it is not. Only an explicit dedication by the rights holders
  counts.
- **Excluded sources, however tempting:** IMSLP recordings are out — their
  licenses are per-file and often non-commercial. Streaming rips, label
  releases, and "found on YouTube" audio are out. Good sources are explicit
  dedications: Musopen, Open Goldberg Variations, and similar projects that
  state the recording itself is CC0.

Record the evidence: keep the source URL in the catalog row's attribution or
in the PR description that adds the row, so the dedication can be re-checked
later. When in doubt, the recording is out — legal posture is a design
constraint here, not a footnote.

## Adding a recording

A recording joins the library in three steps. Audio never enters the repo —
it is hosted on Cloudflare R2 (zero egress fees) and referenced by URL.

### 1. Upload the audio to R2

- Upload the MP3/M4A to the library bucket, publicly readable, with a stable
  path like `library/<entry-id>.mp3`.
- Note the public URL — it becomes the catalog row's `audioUrl`.

### 2. Compute the recording identity

```sh
shasum -a 256 library/brahms-op118-2.mp3
```

The sha256 is the hard identity check: the app verifies cached library audio
against it before trusting it, and label-set imports verify it before applying
a label set's markers. A wrong hash silently breaks both — compute it from the
exact uploaded file, never from a re-encode or a different copy.

### 3. Add a catalog row

Add one entry to `library/library.json`. Every field is required:

```json
{
  "id": "brahms-op118-2-musopen",
  "composer": "Johannes Brahms",
  "piece": "Intermezzo in A major, Op. 118 No. 2",
  "performer": "Musopen performers",
  "duration": 355.0,
  "license": "CC0",
  "attribution": "https://musopen.org/music/2135-intermezzo-op-118-no-2/",
  "audioUrl": "https://<bucket>.r2.dev/library/brahms-op118-2-musopen.mp3",
  "sha256": "<64 hex chars>",
  "labelsetUrl": "https://raw.githubusercontent.com/terencemui/rehearsal-marks/main/library/labelsets/brahms-op118-2-musopen.json"
}
```

- `id` is a stable kebab-case slug — it names the label-set file
  (`library/labelsets/<entry-id>.json`) and is never changed after publish,
  since contributors' PRs reference it.
- `duration` is seconds, float, matching what the app computes from the file.
- `license` is always `"CC0"`; `attribution` links the dedication evidence.
- `labelsetUrl` is the raw GitHub URL of the (initially empty or starter)
  label set file, so the app always has something to fetch.

## Review checklist for label-set PRs

A label-set PR is a single-file change; the checklist is correspondingly
mechanical. Run it top to bottom and post the result on the PR.

- [ ] **Exactly one file changed:** `library/labelsets/<entry-id>.json`. Any
      audio file, any other file, or any change to `library.json` → decline
      with a note (catalog changes are a separate maintainer-side change).
- [ ] **`<entry-id>` matches an existing catalog entry** in
      `library/library.json`.
- [ ] **JSON parses** and `schemaVersion` is ≤ the app's supported version
      (currently 1). Newer versions → decline: the app would reject the file.
- [ ] **`audioMeta.sha256` equals the catalog row's `sha256` exactly.**
      Mismatch → decline: the markers were made against a different performance
      and would misalign every student's recording.
- [ ] **`audioMeta.duration` is within ~2 seconds of the catalog row's
      duration.** A larger gap usually means a differently cut or different
      performance — verify before accepting.
- [ ] **Markers are in time order** and each `label` appears exactly once.
      Labels in the file are informational (re-derived by time rank on
      import), but a file whose labels disagree with its time order is a red
      flag worth a comment.
- [ ] **Aliases are valid:** non-empty, ≤16 characters, unique across labels
      and aliases.
- [ ] **`license` is CC0 and `attribution` matches the catalog row.**
- [ ] **Spot-check 2–3 timestamps by ear** against the published recording.
      This is the only non-mechanical step; it catches misheard markers that all
      the structural checks cannot.

Declines carry the specific line ("sha256 mismatch"), because the fix is
always small: correct the file and re-push the same PR. Merge with a squash
commit; the file ships in the Library on the next deploy.
