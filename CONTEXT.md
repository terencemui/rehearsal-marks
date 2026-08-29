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
The letter a marker displays (A, B, … Z, AA, AB, …), derived from its time rank within its movement — restarting at A for each movement — and never stored as truth.
_Avoid_: letter, index, number

**Alias**:
A user's own name for a marker ("Recap", "1"), attached to the marker's identity, never the label.
_Avoid_: name, title, custom label

### Projects and recordings

**Project**:
A self-contained, editable unit owned by a signed-in User: one recording plus its name, markers, movements, and visibility. Stored server-side and public by default, so its markings are a contribution unless the owner opts out.
_Avoid_: file, document, track

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
The full-width click-to-seek progress clock below the split — the recording's own strip, a filled bar tracking playback with the elapsed time under its left end and the total duration under its right. It carries no marks; the markers panel is where they show.
_Avoid_: ruler, tick bar, scrubber

### Gallery and sharing

**Public gallery**:
The anonymous browse surface listing published public projects, grouped by recording and newest first — no account is needed to read or play any of them.
_Avoid_: homepage, catalog, browse

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
