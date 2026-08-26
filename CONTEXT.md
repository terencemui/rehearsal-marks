# Rehearsal Marks

A classical music student pins their score's rehearsal marks to a recording, so they can jump straight to "rehearsal C" instead of scrubbing by ear. Projects live entirely in the browser; the community contributes label sets that apply to the same recordings.

## Language

### The practice problem

**Rehearsal mark**:
A landmark in the printed score — A, B, C — that the student wants to find in a recording.
_Avoid_: reference point, section marker

**Marker**:
A point in time on a recording that pins one rehearsal mark; carries its time and aliases.
_Avoid_: pin, bookmark, mark

**Label**:
The letter a marker displays (A, B, … Z, AA, AB, …), derived from its time rank; never stored as truth.
_Avoid_: letter, index, number

**Alias**:
A user's own name for a marker ("Recap", "1"), attached to the marker's identity, never the label.
_Avoid_: name, title, custom label

### Projects and recordings

**Project**:
A self-contained, editable unit: one recording plus its markers.
_Avoid_: file, document, track

**Recording**:
The performance a project is built on — a YouTube video, streamed from Google.
_Avoid_: audio, media, clip

**Recording identity**:
The facts that make a label set applicable to exactly one recording: the video ID (stored as its canonical URL), with duration as a soft check.
_Avoid_: fingerprint, checksum

**Canonical URL**:
The normalized YouTube URL form a project stores as its recording identity; every accepted link form matches it by video ID.
_Avoid_: permalink, normalized link

**Video ID**:
The token extracted from any accepted YouTube URL form; identity matching compares video IDs.
_Avoid_: youtube key, video key

### The player

**Timeline**:
The full-width, tick-free, click-to-seek clock below the split — the recording's own strip, with a flag at every marker and a live playhead.
_Avoid_: ruler, tick bar

### Community

**Label set**:
Markers plus recording identity for one recording — the community contribution format, copied into a project when loaded.
_Avoid_: labels file, markers file, annotation set

**Commons**:
The hosted collection of community-contributed label sets, keyed by recording identity — readable by anyone, writable only by a contributor.
_Avoid_: store, database, backend, catalog

**Contributor**:
A signed-in person who publishes label sets to the Commons and owns the ones they publish; reading the Commons never requires being one.
_Avoid_: user, author

**Publication status**:
Whether a label set in the Commons is visible to anonymous readers: pending until a maintainer reviews it, then published — or rejected, when a maintainer denies a pending set (visible to its contributor, who can edit and resubmit). A contributor with a track record is trusted: their submissions and edits publish without review.
_Avoid_: state, moderation flag, approved
