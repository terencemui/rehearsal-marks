# Keyboard reference

The player is fully keyboard-operable. Every shortcut below is suppressed
while focus is in a text field (the marker time or aliases inputs), so typing
never seeks, jumps, or deletes.

## Playback

| Key | Action |
|---|---|
| `Space` | Play / pause |
| `←` / `→` | Seek ∓5 seconds |

## Marking

| Key | Action |
|---|---|
| `M` (or the Add marker button) | Add a marker at the playhead, without pausing |
| Double-click the waveform | Add a marker at that position |
| Long-press (touch) | Add a marker at that position |

## Navigation

Markers are labeled A, B, C… by time order. Jumping never selects a marker —
selection exists only for nudge and delete — and never interrupts playback.

| Key | Action |
|---|---|
| `↑` / `↓` | Jump to the previous / next marker, wrapping at the ends |
| `A`–`Z` | Jump straight to that marker (`M` is reserved for adding — the marker labeled `M` is reached with the arrow keys) |
| Click a marker flag | Jump to it (and select it for editing) |

Labels continue past `Z` (`AA`, `AB`, …); the arrow keys reach every marker,
including those a single letter key cannot.

## Editing the selected marker

Click a flag to select a marker; the inspector opens with its time, nudges,
and aliases.

| Key | Action |
|---|---|
| `Alt`+`←` / `Alt`+`→` | Nudge the selected marker ∓0.1 seconds |
| `Delete` / `Backspace` | Delete the selected marker (undo toast for 5 seconds) |
| `Esc` | Deselect |

The same nudges exist as ±0.1s and ±1s buttons in the inspector, next to the
time field (accepts `5:10.5`, `310.5`, `5 10`) and the aliases field
(non-empty, ≤16 characters, unique per project).
