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
| `↑` / `↓` | Jump to the previous / next marker, wrapping at the ends |
| `M` | Place a marker at the playhead |
| `[` / `]` | Nudge the row the playhead is on a tenth of a second earlier / later |
| Click a marker row | Jump to it |
| Click the time in a movement header | Jump to that movement's start |

`M` places a marker where the recording is and touches nothing else: the marker
falls at the playhead, and the recording plays on. The same act has a control
beside the markers heading, **Add marker**, for a pointer. A movement boundary
is placed by ear the same way — **Add movement** — and has no key of its own.

`[` and `]` move the row the recording is on a tenth of a second earlier or
later; hold `Shift` for a whole second. The row is the playhead's: the marker
the recording has last passed, or the boundary it is sitting on — and a boundary
wins when one is under the playhead, whether or not a mark stands there too. So
the block of controls is wherever the recording is, with nothing to click to
begin, and the mark `M` has just made is the mark it is on. It holds still while
the caret is in its time field, so the recording cannot take the field away
mid-entry, and follows the playhead again once the field is left.

A correction moves the recording to the time it writes: a nudge, or a committed
typed time, puts the playhead on the new value — mark and boundary alike — so
the row stays under the correction that moved it, and the change is heard at
once. Nothing else about playback moves, so the recording keeps playing, or
stays paused, exactly as it was. The `−0.1s` and `+0.1s` controls beside the
field make the same division.

This page's `↑` and `↓` are the practice surface's, and they reach a marker the
same way: the jump moves the playhead to it, and the playhead is what decides
the row. The walk is over markers only, so a movement's boundary is reached by
clicking the time in its header, by the playhead sitting on it, or by letting
the recording play into it. Before the first marker, and with no boundary under
the playhead, `[` and `]` have no row to act on and do nothing. A typed alias or
time is committed when the field is left, which `Enter` does.

## Keys the browser keeps

Play, pause, and volume come from the recording's own controls on both surfaces.
`Alt`+arrows are the browser's again — the marker nudge that used to claim them
is gone — and `Shift`+arrows stay the browser's too (scroll, selection). `M` is
a plain chord for the same reason: `⌘M` minimises the window.
