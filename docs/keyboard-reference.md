# Keyboard reference

Two surfaces play a recording, and both are keyboard-operable: the **practice
surface** — a recording played back, from the public gallery or from a project's
own page — and the **Markings page**, where a project's owner authors what it
carries. Playback is the same on both, and read-only on both: a student
practising never changes the recording. The keys that place and correct a marker
exist only on the page where a marker may be changed.

## The practice surface

| Key | Action |
|---|---|
| `Space` | Play / pause |
| `←` / `→` | Seek ∓5 seconds |
| `↑` / `↓` | Jump to the previous / next marker, wrapping at the ends |
| Click a marker row | Jump to it |
| Click a movement header | Jump to that movement's start |

Markers are labeled A, B, C… by time order, restarting at A within each
movement. Jumping never selects a marker and never interrupts playback. Labels
continue past `Z` (`AA`, `AB`, …), and the arrow keys reach every marker.

## The Markings page

| Key | Action |
|---|---|
| `Space` | Play / pause |
| `←` / `→` | Seek ∓5 seconds |
| `↑` / `↓` | Jump to the previous / next marker, wrapping at the ends, and pick out the marker it lands on |
| `M` | Place a marker at the playhead |
| `[` / `]` | Nudge the marker being corrected a tenth of a second earlier / later |
| Click a marker row | Jump to it, and pick it out to be corrected |
| Click the time in a movement header | Jump to that movement's start, and pick it out to be re-timed |

`M` places a marker where the recording is and touches nothing else: the marker
falls at the playhead, and the recording plays on. The same act has a control
beside the markers heading, **Add marker**, for a pointer. A movement boundary
is placed by ear the same way — **Add movement** — and has no key of its own.

`[` and `]` move the marker being corrected a tenth of a second earlier or
later; hold `Shift` for a whole second. A correction moves the marker and
nothing else, so the recording keeps playing, or stays paused, exactly as it was
— the same division the `−0.1s` and `+0.1s` controls make.

This page's `↑` and `↓` do one thing the practice surface's do not: the marker
they land on is picked out as the one being corrected, which is how a marker is
reached for nudging without a pointer. No marker picked out means `[` and `]` do
nothing. The walk is over markers only — a movement's boundary is picked out by
clicking the time in its header — and a typed alias or time is committed when
the field is left, which `Enter` does.

## Keys the browser keeps

Play, pause, and volume come from the recording's own controls on both surfaces.
`Alt`+arrows are the browser's again — the marker nudge that used to claim them
is gone — and `Shift`+arrows stay the browser's too (scroll, selection). `M` is
a plain chord for the same reason: `⌘M` minimises the window.
