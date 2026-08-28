# ADR-0003 — Playback-only player: the practice surface, and the accepted editing gap

**Status:** Accepted — 2026-08-26
**Caught up — 2026-08-28:** the timeline strip's flags and playhead were retired once the side column gained the markers panel (T38's remake, then the panel refinement). The strip now carries only the played fill; the marks show in the markers panel, whose rows are the click-to-jump surface the passages below describe as flags.
**Supersedes:** the two-posture (Playback | Label) player design, and spec 0001's in-player editing (see _Consequences → What this invalidates_)

## Context

The player grew a full editing surface while the product's actual job stayed the same: a student practises against a recording and jumps to "rehearsal C" by name. The editing chrome competed with that — a Playback | Label posture toggle demanding a decision before anything else, a save-status line reporting "Saved" during a session that changes nothing, an explanatory paragraph under the timeline, and an app-level play/pause and volume transport duplicating what the embedded YouTube recording already provides. The screen was built for editing, not for playing.

The audience is a musician at a music stand, not a technician. Editing a label set is a real task, but it is a different screen's task. The recording — the thing being watched — should dominate, and the player should be honest about what it is. The redesign (issue #74, tickets T37–T40) strips the player back to that: a practice surface and nothing else.

## Decision

**The player is playback-only.** Every editing affordance leaves it — the Playback | Label posture switch, the Add marker control, the marker inspector, delete-with-undo, and the editing keyboard shortcuts (add-at-playhead, nudge, delete, deselect). Marker *selection* ceases to exist in the player, because selection existed only to serve nudge and delete.

Play/pause and volume come from the embedded recording's own controls, not a second app-level transport. Surviving keyboard navigation: `Space` to play/pause, `←`/`→` to seek ∓5 seconds, `↑`/`↓` to walk the marks (wrapping at the ends), and `A`–`Z` to jump straight to that mark — **`M` is no longer a special case**, just the letter for the marker labelled M. A markers-panel row click jumps, never selects. `Alt`+arrows are no longer intercepted — the nudge is gone, so they are the browser's again (Back on Windows and Linux) — an accepted consequence.

Supporting choices:

- **"Ruler" retires from the spoken vocabulary; "Timeline" becomes the term.** The full-width, tick-free, click-to-seek clock below the split is the recording's own strip. Module and DOM names that still say "ruler" are left alone — this is a change to the spoken vocabulary, not a rename of the drawing code.
- **The per-project stored mode field stays in the schema untouched.** Its default-selection helper is still called when a project is created and by the version-2 migration, so it is not vestigial; only the player's reading and writing of the field goes away. **No migration.**
- **The player keeps its record-mutation path for exactly one purpose:** stamping the measured duration after load.
- **The ruler-drawing module is not modified.** Its numbered ticks are hidden with CSS scoped to the player; the strip's played fill is a percentage of the recording, so it is always exactly the content width and never scrolls. The marks are not drawn on the strip — the markers panel in the side column is where they show.

## Consequences

### What this buys

- **An honest practice surface.** There is no posture to choose, no save status to read, no second transport, and no way to damage a label set by fumbling a key mid-practice.
- **The recording and the readout get the space.** The video fills its column, the practice console reads at a glance from a music stand, and the timeline is its own full-width strip.
- **The documented vocabulary matches the screen.** One posture, one timeline, `M` as a plain letter — the glossary, the keyboard reference, and the Help tab describe what exists.

### What it costs

- **The app cannot author markers — accepted.** Editing moves to a label-editing page that does not exist yet. Until it ships, the app cannot create, move, rename, or delete a marker: a project is only as good as the label set it was created with, and a recording with no Commons label set opens as a permanently empty timeline. Contribution from scratch is dormant for the same reason — a new label set cannot be written in-app, and a published set cannot be changed.
- **`Alt`+arrows are the browser's again.** The nudge used to intercept them in both postures; with the nudge gone, the browser's own behaviour (Back on Windows and Linux) is exposed. Accepted, not an oversight.
- **A failed save is no longer visible inside the player.** With editing gone the player's only write is the one-time duration stamp, and a failure still surfaces on the projects screen after exit.

### What this invalidates

| Where | What is now false |
| --- | --- |
| spec 0001 — stories #7–#8 | pressing `M` / the Add-marker button adds a marker at the playhead — `M` is now a letter jump and nothing adds a marker |
| spec 0001 — story #16 | delete with a 5-second undo toast — the delete path is gone from the player |
| spec 0001 — stories #20–#21 | ±0.1s/±1s nudge buttons and loose time entry — the inspector is gone |
| spec 0001 — story #22 | timestamps display as `mm:ss.mmm` — the readout shows whole seconds |
| spec 0001 — story #28 | an in-app volume control — the embedded recording's own controls take over |
| spec 0001 — story #32 | a visible Saved/Saving status in the player — no save-status line renders there |
| spec 0001 — story #46 | shortcuts suppressed while typing in a text field — the player has no text field (the guard survives, future-proof) |
| CONTEXT.md — "The player" | "Playback mode", "Label mode", and "Ruler" — replaced by a single "Timeline" term |
| CONTEXT.md — "Publication status" | "who can edit and resubmit" / "their submissions and edits publish" — resubmission only, until the editing page lands |
| docs/keyboard-reference.md | the two-posture introduction, "Both modes", and "Label mode" sections — collapsed to one posture |
| The Help tab and the projects screen | the two-posture keyboard intro, the Label-mode table, the "markers sit on a ruler" storage line, and the Rejected badge's "edit the set and submit again" — rewritten to the timeline vocabulary and resubmission |

The player section of the glossary (`CONTEXT.md`), `docs/keyboard-reference.md`, and the Help tab were rewritten to match; the projects screen's Rejected-badge copy follows. **ADR-0002 is not overridden by this decision**: its point — that the ruler/timeline *is* the view, not a fallback — stands and is reinforced. What this decision changes is the word it used: "ruler" is retired from the spoken vocabulary in favour of "Timeline", and the player's own strip hides the numbered ticks the shared drawing module still renders. The mode field that survives in the schema is documented above; removing it, if ever, is a later migration.

## Alternatives considered

**Keep the editing tools in the player, behind the toggle.** A two-posture player that keeps both modes ready. **Rejected** because the toggle was the loudest thing on the screen and the editing posture was the one a practising student never wanted; splitting the screen's jobs in two left the video smaller than it should be and the save-status line reporting nothing.

**Keep a read-only player plus an edit-in-place affordance.** A lighter compromise that keeps authoring reachable from the player. **Rejected** because editing belongs on a page of its own — the label-editing page — not as an in-place mode on the practice surface; anything in the player would re-open the posture problem this decision retires.

**Leave the editing gaps in the player.** Keep add/nudge/delete working even as the rest of the chrome is stripped. **Rejected** because a practice surface that can mutate markers is exactly the fumble risk a musician at a music stand cannot afford; read-only is the point.
