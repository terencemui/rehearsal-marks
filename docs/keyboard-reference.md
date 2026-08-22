# Keyboard reference

The player is fully keyboard-operable. Every shortcut below is suppressed
while focus is in a text field (the marker time or aliases inputs), so typing
never seeks, jumps, or deletes.

The player has two postures, switched from the **Playback | Label** segmented
control in the transport bar. **Playback mode** is the practice posture:
navigation tools with read-only markers. **Label mode** keeps every
navigation tool and adds the editing tools. A project opens in Playback mode
when it already has markers — its community label set loaded — and in Label mode
otherwise. The last-used mode is remembered per project.

## Both modes

| Key | Action |
|---|---|
| `Space` | Play / pause |
| `←` / `→` | Seek ∓5 seconds |
| `↑` / `↓` | Jump to the previous / next marker, wrapping at the ends |
| `A`–`Z` | Jump straight to that marker |
| Click a marker flag | Jump to it |
| The volume slider | Adjust playback level |

Markers are labeled A, B, C… by time order. Jumping never selects a marker —
selection exists only for editing — and never interrupts playback. Labels
continue past `Z` (`AA`, `AB`, …); the arrow keys reach every marker,
including those a single letter key cannot.

`M` means different things per posture: in Label mode it adds a marker (the
marker labeled `M` is reached with the arrow keys there); in Playback mode it
jumps to the marker labeled `M` like every other letter.

## Label mode

Label mode adds the editing tools to everything above:

| Key | Action |
|---|---|
| `M` (or the Add marker button) | Add a marker at the playhead, without pausing |
| Click a marker flag | Jump to it **and select it** for editing |
| `Alt`+`←` / `Alt`+`→` | Nudge the selected marker ∓0.1 seconds |
| `Delete` / `Backspace` | Delete the selected marker (undo toast for 5 seconds) |
| `Esc` | Deselect |

The same nudges exist as ±0.1s and ±1s buttons in the inspector, next to the
time field (accepts `5:10.5`, `310.5`, `5 10`) and the aliases field
(non-empty, ≤16 characters, unique per project).
