# Rehearsal Marks

A classical music student pins their score's rehearsal marks to a recording, so they can jump straight to "rehearsal C" instead of scrubbing by ear. Projects live on the server (ADR-0006): each belongs to a signed-in User and is public by default, so a browseable **public gallery** is the app's front door.

## Language

### The practice problem

**Rehearsal mark**:
A landmark in the printed score — A, B, C — that the student wants to find in a recording.
_Avoid_: reference point, section marker

**Marker**:
A point in time on a recording that pins one rehearsal mark; carries its time and aliases.
_Avoid_: pin, bookmark, mark

**Label**:
A marker's derived name (A, B, … Z, AA, AB, …), written from its time rank within its movement — restarting at A for each movement — and never stored as truth. A project's Naming decides how it is written, and whether it is the mark's name at all.
_Avoid_: letter, index, number

**Alias**:
A user's own name for a marker ("Recap", "1"), attached to the marker's identity, never the label.
_Avoid_: name, title, custom label

**Naming**:
A project's answer to how its score marks its rehearsals: `letters` or `numbers`, where the derived Label is each marker's name, or `measures`, where the authored Alias is. Held by the project rather than the viewer, so a published project reads to everyone as it reads to its owner.
_Avoid_: label style, numbering mode, naming scheme

### Projects and recordings

**Project**:
A self-contained, editable unit owned by a signed-in User: one recording plus its name, markers, movements, and visibility. Stored server-side and public by default, so its markings are a contribution unless the owner opts out.
_Avoid_: file, document, track

**Markings**:
A project's authored substance: its markers and movements taken together, as distinct from the recording they are pinned to and the name its owner gives it.
_Avoid_: label set, labels, annotations

**Markings page**:
The surface where a project's owner authors its markings — its markers and movements — and the only place they can be changed.
_Avoid_: label-editing page, label set page, editor

**Recording**:
The performance a project is built on — a YouTube video, streamed from Google.
_Avoid_: audio, media, clip

**Recording title**:
The canonical title of the recording's video, fetched once from YouTube when the project is created and never editable afterwards — the gallery groups projects by it, so a user's project rename never mislabels the recording.
_Avoid_: title, video name

**Movement**:
A named subdivision of a recording — a self-contained portion of the musical work, such as a symphony's first movement. Each movement has a name and a start time; its extent runs to the next movement's start or the recording's end. A project may carry any number.
_Avoid_: part, section, track

**Recording identity**:
The facts that make a project applicable to exactly one recording: the video ID (stored as its canonical URL), with duration as a soft check.
_Avoid_: fingerprint, checksum

**Canonical URL**:
The normalized YouTube URL form a project stores as its recording identity; every accepted link form matches it by video ID.
_Avoid_: permalink, normalized link

**Video ID**:
The token extracted from any accepted YouTube URL form; identity matching compares video IDs.
_Avoid_: youtube key, video key

### The player

**Timeline**:
The full-width click-to-seek strip below the split — the recording's own clock, with the elapsed time under its left end and the total duration under its right. The practice surface draws it as a stave — the drawing's name in the code, not a second word for the strip: five hairlines ruled across the recording's whole length, a heavier bar line where each movement begins, a final barline at the right edge, a pencil rule at the playhead, and the project's marks in boxes at the times they occupy. A movement's bar line is a rule and not a mark.
_Avoid_: ruler, tick bar, scrubber

**Active row**:
The row the playhead is on: the marker it has last passed, or the movement boundary it is sitting on — a boundary wins when both are true. On the Markings page it carries the correction controls.
_Avoid_: selected row, picked-out row, current row, highlighted row

### Gallery and sharing

**Public gallery**:
The anonymous browse surface: one card per recording with at least one published public project, ordered by the reader's **Gallery sort**, Trending unless they choose otherwise. A card opens the recording's oldest published project, and no account is needed to read or play any of them.
_Avoid_: homepage, catalog, browse

**Workspace**:
The signed-in owner's surface: one card per project they created, newest first, reusing the public gallery's own grid, thumbnail, and typography rather than a plain list. A card's thumbnail or title opens the project directly; every other action — Markings, Rename, the visibility toggle, the naming select, Delete — sits behind the card's own "More" disclosure.
_Avoid_: projects list, dashboard, my projects page

**Gallery sort**:
The order of the public gallery's cards: **Trending** (the default), **Newest**, **Oldest** or **Most popular**. Every sort ranks recording cards, never individual projects. A card's **age** is the date of its newest published project; its **views** are the sum of the views of all its published projects. Newest orders by age, newest first; Oldest is exactly its reverse; Most popular orders by views, most first. Ties under any sort fall back to newest first. The choice lives in the gallery's own state, not the URL, and resets to Trending when the reader leaves and returns.
_Avoid_: ordering, filter, ranking

**Trending**:
The gallery sort that ranks a card by `log10(max(views, 1)) + age_seconds / 604800`, so a recording one week newer ranks the same as one with ten times the views. A recording with no views still scores by its age alone.
_Avoid_: hot, score

**View**:
One count against a published public project, recorded each time anyone opens its read-only page — every time, with no deduplication, and never from the editor. It is never shown in the UI, and recording one changes nothing else about the project.
_Avoid_: hit, visit, play

**Gallery search**:
The reader's text filter over the public gallery: a trimmed, case-insensitive match against a recording's title or any of its projects' names, keeping the whole recording.
_Avoid_: filter, keyword search

**User**:
A signed-in person who owns the projects they create; browsing the public gallery never requires being one.
_Avoid_: contributor, account holder

**Visibility**:
Whether a project is public (visible on the public gallery after review) or private (visible to its owner alone, and never reviewed).
_Avoid_: shared flag, privacy toggle

**Publication status**:
Whether a public project is visible to anonymous readers: pending until a maintainer reviews it, then published — or rejected, when a maintainer denies a pending project (visible to its owner, who can edit and resubmit it). Meaningful for public projects only; private projects never enter review.
_Avoid_: state, moderation flag, approved

**Trusted user**:
A User with a track record of published public projects, whose new public projects publish immediately and whose edits skip review.
_Avoid_: approved, verified
