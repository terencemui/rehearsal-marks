# Spec: Classical Rehearsal-Mark Player — MVP

> *This spec was synthesized by Claude Code from a grilling session with the maintainer. Every decision in it was confirmed by a human.*

## Problem Statement

A classical music student practicing a movement has a score full of rehearsal marks — A, B, C — but a recording that has none of them. Finding "rehearsal C" means scrubbing the audio by ear, every practice session, again and again. Generic audio players have no concept of practice marks; score tools are heavyweight and don't touch audio; nothing in between lets a student pin their score's landmarks to their recording once and navigate them instantly forever after.

## Solution

A web app where the student uploads a recording of one movement, sees a waveform, and drops markers at the rehearsal points while listening — pressing one key as each mark goes by. Markers get labels automatically (A, B, C…), carry optional user aliases ("Recap", "Development"), and are navigable by letter key, arrow keys, or click. Projects persist entirely in the browser — no accounts, no uploads — and export as a portable zip. A curated library of CC0 public-domain recordings comes pre-labeled, so a student can load a fully-marked recording instantly; the community contributes new label sets through GitHub pull requests.

## User Stories

1. As a practice student, I want to create a project by uploading an MP3 or M4A recording, so that I can start marking immediately without any setup ceremony.
2. As a practice student, I want the project to be named after my file by default and renameable later, so that I never fill a form before practicing.
3. As a practice student, I want a clear explanation when I try to upload WAV or FLAC and guidance on converting, so that I understand the storage constraint instead of hitting a silent failure.
4. As a practice student, I want my projects listed with name, duration, marker count, size, and last-modified time, so that I can find and manage them.
5. As a practice student, I want to delete a project with a confirmation step, so that I never lose marks and audio to a mis-click.
6. As a first-time user, I want an empty state offering "Create project" and "Browse the library", so that the app teaches me its two paths immediately.
7. As a practice student, I want to press M while listening to drop a marker at the current playback position without pausing, so that marking during a real practice pass is one keypress per mark.
8. As a practice student, I want a visible "Add marker" button that does the same thing as M, so that the core action is discoverable without reading a manual.
9. As a practice student, I want to double-click the waveform to add a marker at that exact position, so that I can aim marks when paused.
10. As a mobile practice student, I want to long-press the waveform to add a marker at that position, so that touch devices have an equivalent to double-click.
11. As a practice student, I want markers auto-labeled A, B, C… in time order, so that labels match my score's rehearsal letters without me typing them.
12. As a practice student, I want a marker I add out of chronological order to receive the next free letter and appear in time order, so that the sequence stays dense no matter how I work.
13. As a practice student, I want the sequence to continue past Z (AA, AB, …), so that long movements never run out of labels.
14. As a practice student, I want deleting a marker to re-label the remaining ones densely, so that labels always match time rank exactly.
15. As a practice student, I want moving a marker in time to re-rank its label against its neighbors, so that the letter order always matches playback order.
16. As a practice student, I want a delete action with a 5-second undo toast, so that mistakes are cheap to fix without confirmation dialogs on every delete.
17. As a practice student, I want to attach aliases like "Recap" or "1" to markers, so that I can name marks after my score's reality without breaking the canonical letter sequence.
18. As a practice student, I want aliases to be unique and constrained (non-empty, trimmed, ≤16 chars), so that the marker list stays unambiguous and the flags stay renderable.
19. As a practice student, I want aliases to follow their marker through re-labels and re-times, so that my names never silently migrate to a different mark.
20. As a practice student, I want to adjust a marker's timestamp with ±0.1s and ±1s nudge buttons, so that fine corrections are precise and keyboard-free.
21. As a practice student, I want to type times in the marker field loosely ("5:10.5", "310.5", "5 10"), so that entering exact timestamps never fights a strict format.
22. As a practice student, I want timestamps displayed as mm:ss.mmm (h:mm:ss.mmm for recordings ≥1 hour), so that I see the true precision of my marks.
23. As a practice student, I want Space to play/pause and clicking the waveform to seek, so that the player behaves like every audio tool I already know.
24. As a practice student, I want ←/→ to seek ±5 seconds, so that I can re-hear a phrase without the mouse.
25. As a practice student, I want ↑/↓ to jump to the previous/next marker and keep playing if already playing, so that I can audition marks in sequence.
26. As a practice student, I want to press a letter A–Z to jump straight to that marker, so that "take it from C" is one keypress.
27. As a practice student, I want to click a marker's flag to jump to it, so that the mouse path exists for the same action.
28. As a practice student, I want a volume control, so that playback level is adjustable in-app.
29. As a practice student, I want ctrl/cmd+scroll (and pinch on touch) to zoom the waveform around my cursor, so that I can see and target individual phrases in long recordings.
30. As a practice student, I want jumping to a marker to scroll the zoomed view to it, so that the target is always visible after a jump.
31. As a practice student, I want the app to degrade to a ruler-only view (no waveform) if decoding fails, so that marking and playback still work even when the waveform cannot be rendered.
32. As a practice student, I want everything saved automatically (no save button) with a visible Saved/Saving status, so that I never lose marks to a forgotten save.
33. As a practice student, I want to reopen the app later and find my projects intact, so that persistence is something I never think about.
34. As a practice student, I want an honest "storage full" message with per-project sizes when browser storage runs out, so that I can free space deliberately — and export before anything is lost.
35. As a practice student, I want to export a project as a single zip containing my marks and the audio, so that my work is portable and safe from browser eviction.
36. As a practice student, I want to export a label-set-only JSON file, so that I can contribute my marks for a public-domain recording to the community library.
37. As a practice student, I want importing a zip to always create a new project and never overwrite an existing one, so that import can never destroy my work.
38. As a practice student, I want the app to reject files from a future schema version and ignore unknown fields within a known version, so that imports fail safely rather than corrupting state.
39. As a practice student, I want importing a label set to verify it against the recording's identity (sha256) before applying, so that I never see someone else's timestamps on the wrong recording — with a clear explanation when it doesn't match.
40. As a practice student, I want to browse the library showing composer, piece, performer, duration, license, and attribution, so that I know exactly what I'm loading and its legal status.
41. As a practice student, I want loading a library recording to start playing almost immediately while it caches in the background, so that "load instantly" is literally true.
42. As a practice student, I want library recordings I've loaded to open from cache instantly and offline, so that repeat practice sessions never re-download.
43. As a practice student, I want loaded library entries to show a "Loaded" state that opens my editable copy, so that I never accidentally seed a duplicate.
44. As a practice student, I want the cached library audio verified against its published sha256 before it's trusted, so that a corrupted or tampered download can't silently misalign my marks.
45. As a practice student, I want a Help tab with the keyboard reference, format limits, storage explanation, and the label-contribution workflow, so that every hidden feature has a discoverable home.
46. As a practice student, I want keyboard shortcuts suppressed while I'm typing in a text field, so that editing an alias never seeks, deletes, or jumps.
47. As a privacy-conscious practice student, I want confirmation that my recordings and marks never leave my browser, so that I can use the app with material I don't want shared.
48. As a community contributor, I want to submit a label set for an existing library recording as a pull request containing only one JSON file, so that contributing is a ten-minute task with clear review boundaries.
49. As a community contributor, I want label sets to carry recording identity (sha256, duration, source, license, attribution), so that my contribution is auditable and only ever applied to the right recording.

## Implementation Decisions

### Product and platform

- **Client-only web app.** No server, no accounts, no backend processing. The only network access is static assets (app shell + library audio + catalog).
- **Evergreen browsers only**: latest two versions of Chrome, Edge, Firefox, Safari. Anything beyond is unsupported, not tested.
- **Stack:** React + TypeScript + Vite. Wavesurfer.js for waveform rendering and interaction — but **all audio I/O is consumed through an `AudioController` seam**, so wavesurfer remains swappable (it was chosen "for now" and sits behind an interface for exactly that reason).

### Domain module (the single primary seam)

- **Marker model** — the agreed shape from the grilling session:

```ts
interface Marker {
  id: string;         // uuid — stable identity; aliases, undo, and export follow this, never the label
  time: number;       // seconds, float, full precision — rounding is display-only
  aliases: string[];  // user-facing names; constraints below
  createdAt: number;  // epoch ms
  // label is NOT stored as source of truth. It is derived.
}
```

- **Labels are derived, never stored as truth.** Sort markers by `time`; assign `A, B, … Z, AA, AB, …` (Excel-style continuation) by rank. Re-derived after *every* mutation — add, delete, and re-time — so the sequence is always dense, letters always match time order, and duplicates are impossible by construction.
- **Aliases** attach to the marker `id` and never cascade. Constraints: non-empty, whitespace-trimmed, ≤16 chars, any characters; unique across all labels *and* aliases within a project.
- **Time parsing is lenient**: accepts `5:10.5`, `5:10`, `310.5`, `5 10`; normalizes to float seconds on commit.
- **Recording identity lives on the project, not the marker**: piece, performer, source, license, attribution, audio `sha256`, duration. This is what makes community label sets validatable.

### Storage

- **One IndexedDB database (`rehearsal-marks`), versioned from day one** with migration support on `onupgradeneeded`:
  - `projects` — self-contained user projects: name, timestamps, audio Blob, `audioMeta` (duration, mimeType, filename, sizeBytes, sha256), markers.
  - `library-cache` — evictable: community audio Blobs + label sets + metadata. Evict this store first under storage pressure; user projects are never auto-evicted.
- **Audio is copied into IndexedDB as a Blob.** (File System Access handles are Chrome/Edge-only; the evergreen-browser requirement rules them out.)
- **sha256 computed once at import** via `crypto.subtle.digest`; used for label-set validation and cache verification.
- **Autosave: debounced ~500ms after any mutation. No save button.** Save state is a status line: Saved / Saving / Storage-full.
- **Quota handling:** catch `QuotaExceededError`; surface an honest message with per-project sizes on the Projects screen; point at export as the backstop.
- **Uploads restricted to MP3 and M4A.** WAV/FLAC rejected at the file picker with conversion guidance. (ffmpeg.wasm client-side transcoding is the known upgrade path if this proves painful.)

### Audio pipeline

- **Playback: always streamed via an HTMLAudioElement** (wavesurfer streaming mode with pre-decoded peaks + duration). Never retain a decoded AudioBuffer for playback; resident memory stays near-zero regardless of recording length.
- **Peaks: one full `decodeAudioData` pass → bucket min/max per pixel column → discard the buffer.** Transient memory ~200–500MB for typical 10–25 min movements (~950MB worst case at 45 min). Peaks themselves are small and retained.
- **Failure fallback: ruler-only mode.** If decoding fails or memory is exhausted, the app renders a timeline with markers, and click-to-add, jump, and playback all still work — only the waveform drawing disappears.
- **Deferred:** WebCodecs chunked peak extraction (decode one packet at a time) for memory-bounded handling of 40+ min files.

### Interactions

- **Click = seek. Double-click = add marker at that position. `M` (or the visible button) = add marker at the current playhead** — the primary marking path during playback. Touch: tap = seek, long-press = add.
- **Zoom: ctrl/cmd+scroll and pinch, cursor-anchored, ~5–10 px/s floor.** Marker flags are a DOM overlay whose x-positions recompute under zoom. Jump-to-marker scrolls the view to the marker.
- **Keyboard scheme:**

| Key | Action |
|---|---|
| `Space` | Play/pause |
| `M` | Add marker at playhead |
| `←` / `→` | Seek ∓5s |
| `↑` / `↓` | Previous / next marker (wraps; keeps playing) |
| `A`–`Z` | Jump to that marker (except `M`, reserved) |
| Click marker flag | Jump to it |
| `Alt`+`←` / `→` | Nudge selected marker ∓0.1s |
| `Delete` / `Backspace` | Delete selected marker → 5s undo toast (no dialog) |
| `Esc` | Deselect marker |

- All shortcuts are suppressed while focus is in any text input.
- **Marker selection** (by clicking a flag) is required only for Alt-nudge and Delete — never for jumping.

### App shell

- Three tabs: **Projects** (home: list, upload, rename, delete-with-confirm, export), **Library** (browse CC0 catalog, load, "Loaded" state), **Help** (keyboard reference, format limits, storage explanation, contribution workflow).
- Upload drops the user straight into the player; project name defaults to the filename.
- First-run empty state with "Create project" and "Browse the library" CTAs.
- Loading a library entry **seeds an editable user project** (audio cached + label set copied into `projects`); the library entry itself remains a read-only reference. No read-only project mode exists.

### Export / import

- **Full project export: a single zip** (fflate) containing `project.json` + the audio file. One file, atomic, portable.
- **Label-set-only export: bare `project.json`** — the community contribution format, carrying recording identity.
- **Schema v1, versioned.** The agreed shape:

```jsonc
{
  "schemaVersion": 1,
  "project": { "id": "uuid", "name": "…", "createdAt": 0, "updatedAt": 0 },
  "markers": [
    { "id": "uuid", "time": 222.35, "label": "C",      // informational — re-derived on import
      "aliases": ["Recap"], "createdAt": 0 }
  ],
  "audioMeta": { "sha256": "…", "duration": 1234.5, "mimeType": "audio/mpeg",
                 "filename": "…", "sizeBytes": 0,
                 "source": "https://…", "license": "CC0", "attribution": "…" }
}
```

- **Import rules:** zip import always creates a new project with a new id (name gets " (imported)" on collision); label-set import validates `sha256` (duration as a soft check) against a known recording before applying, and explains the mismatch plainly ("marks don't transfer between performances"); `schemaVersion` newer than supported is rejected; unknown fields within a known version are ignored.
- **Labels are informational in the file** (human-readable facts) and re-derived by time rank on import — a hand-edited file cannot break the no-holes invariant.

### Library & community

- **GitHub repo layout** (the contribution surface):

```
library/
├── library.json          // catalog: composer, piece, performer, duration, license,
│                         // attribution, audioUrl, sha256, labelsetUrl — one entry per recording
└── labelsets/
    └── <entry-id>.json   // markers + recording identity, one file per entry
```

- **Audio never lives in the repo.** Library audio is hosted on Cloudflare R2 (zero egress fees); `audioUrl` points there. Consequence accepted: new recordings require the maintainer to upload audio and add a catalog row — contributors label existing recordings only.
- **App flow:** Library tab fetches `library.json` (normal HTTP caching); clicking Load **streams the audio from its URL** (playback starts in ~1s) and background-caches audio + labelset into `library-cache`, verifying sha256 on first cache write. Repeat loads are instant and offline.
- **Contribution flow for MVP:** documented manual PR workflow in the Help tab. A "contribute" button that opens the pre-filled PR flow is deferred.

### Copyright posture

- The library is restricted to **CC0 / public-domain-dedicated recordings** (e.g., Musopen, Open Goldberg Variations). Compositions being public domain does **not** make recordings public domain; only explicit dedication counts. IMSLP recordings are excluded (per-file, often non-commercial licenses).
- Label sets are facts about a recording and are not copyrightable subject matter — sharing them is unproblematic.
- **In-app audio sharing is categorically excluded.** Users' recordings never leave their browser.

### Hosting & distribution

- **GitHub** — source + library catalog + labelsets; CI deploys; community PR channel.
- **Cloudflare Pages** — the app (static build).
- **Cloudflare R2** — library audio.
- **PWA-lite** — web app manifest + service worker caching the app shell and `library.json`. Home-screen installation is also the mitigation for iOS Safari's ~7-day eviction of script-writable storage.
- **No analytics.**

## Testing Decisions

### What makes a good test here

- Test **external behavior only** — call the public API of the domain module, the repository, or the rendered UI; never reach into internals. If a test breaks when the implementation is refactored without behavior change, it's a bad test.
- Prefer asserting **invariants** ("labels are dense", "aliases are unique", "import never overwrites") over asserting snapshots.
- Mock only at the seams. Component tests mock `AudioController`; nothing else gets mocked.

### The seams

- **Primary seam: the domain module** (pure TypeScript — marker model, label derivation, time parsing, export/import schema, validation). This is the one seam all invariant tests pass through.
- **Secondary: `AudioController`** — the adapter wrapping wavesurfer/HTMLAudioElement. Mock-only seam: component tests never touch real audio.
- **Storage: no extra seam** — the repository is tested against real IndexedDB semantics via fake-indexeddb.

### Modules tested

1. **Domain invariants** (highest value): label derivation by time rank, Excel continuation (Z → AA, AB), cascade re-label on delete, re-rank on re-time, alias uniqueness and constraints, no-holes guarantee.
2. **Time parsing**: lenient formats and boundary garbage.
3. **Export/import**: zip round-trip integrity; label-set application gated on sha256 match/mismatch; schema version rejection; unknown-field tolerance.
4. **Storage**: save/load round-trips, autosave behavior, quota-error surfacing.
5. **Component flows** (with mocked `AudioController`): M adds at playhead; ↑/↓ and letter-jump; delete → undo toast; double-click adds at x-position; click→time mapping under zoom; shortcut suppression in inputs.

### Discipline

- **TDD red-green for the domain module and storage** — pure logic, test-first.
- **Pragmatic for UI components** — tests alongside or just after implementation; they're regression nets, not design tools.
- **No coverage number.** The bar: every domain invariant has a test, every storage path has a test, every core interaction has a test.
- **Prior art: none** — greenfield repo.

## Out of Scope

- Accounts, authentication, or any server-side processing
- Score view, score parsing, OCR/OMR, or automatic alignment/auto-labeling (**tabled** — may return post-MVP; nothing in this design blocks it)
- Multi-movement projects; repeats/jumps; measure-number fallback
- Playback speed adjustment, looping, pitch adjustment
- WAV/FLAC upload (rejected with guidance; ffmpeg.wasm transcode is a possible later upgrade)
- Drag-to-move markers on the waveform (numeric entry + nudge cover adjustment for MVP)
- Auto-scroll-follow during playback, minimap, zoom buttons
- WebCodecs chunked peak extraction (v2 hardening for 40+ min files)
- In-app audio sharing or user-generated catalog contributions outside the GitHub PR flow
- User-defined label naming schemes (e.g., 1/2/3) — post-MVP
- Playwright full-browser E2E — manual smoke checklist until the app earns it
- Analytics, moderation UI, CI beyond build/deploy

## Further Notes

- **Auto-labeling is tabled, not abandoned.** The original "PDF → timestamps" ambition was descoped for MVP; the domain model (point markers, derived labels, recording identity via sha256) was deliberately designed so an alignment pipeline could later *produce* markers without schema changes.
- **iOS Safari storage eviction** (~7 days for script-writable storage on sites not added to the home screen) is mitigated by export-as-backstop, the PWA manifest, and Help-tab guidance to add the app to the home screen.
- **The library catalog is a maintainer role**: uploading new CC0 recordings to R2, adding catalog rows, reviewing label-set PRs. This workload is small by design and bounded by the CC0-only rule.
- **Legal posture is a design constraint, not a footnote**: CC0-only catalog, facts-only label sets, and no audio sharing were each deliberate decisions; any feature that changes one of them needs a maintainer-level revisit.
