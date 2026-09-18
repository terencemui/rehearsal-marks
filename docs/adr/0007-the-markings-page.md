# ADR-0007 — The Markings page: authoring, and the save split

**Status:** Accepted — 2026-09-17
**Closes:** ADR-0003's accepted editing gap (the "label-editing page that does not exist yet")

## Context

ADR-0003 stripped the player back to a practice surface and accepted the cost explicitly: *"The app cannot author markers — accepted. Editing moves to a label-editing page that does not exist yet."* Until that page shipped, the ADR reasoned, a project was only as good as the markings it was created with, and contribution from scratch stayed dormant.

The page never shipped, and two later decisions sharpened the cost rather than softening it:

- **ADR-0006 made the project the app's one concept and the app's front door a link field.** Creating a project became trivial — paste a URL — so the app began minting empty projects at speed, each one a recording with a blank timeline and no way to fill it.
- **ADR-0005 made labels restart at A within each movement.** That is the whole point of movements, and nothing anywhere in the app can author one: the movement module exports a lookup and nothing else. A student marking a symphony therefore gets a flat A…Z sequence running straight across all four movements — precisely the labelling movements exist to prevent.

The review machinery built for server-side projects has also never fired in anger. The save path detects a return-to-review and the status vocabulary carries a state for it, but no surface could change a marker's time, so the trigger has only ever been exercised in tests.

## Decision

**A project's markings are authored on a page of their own.** The **Markings page** is a routed surface at its own URL, hosting its own player, where a project's owner edits what the recording carries: its markers and its movements. ADR-0003's posture is untouched — the practice surface stays playback-only and gains no editing affordance, only a quiet way through.

Supporting choices:

- **The page owns the markings and nothing else.** Markers and movements yes; the project's name and visibility no. Those keep their single home on the workspace list, so a project is never edited in two places for the same field.
- **Saving splits by what the project is.** A project requires a deliberate **Save changes** exactly when it is public and its publication status is anything but pending — the two states, published and rejected, where a write has a consequence the owner did not ask for. Everything else — private, or public and pending — autosaves. Both modes share one write path and one status line.
- **The client never asks whether the owner is trusted.** The server's re-review trigger already keeps a trusted User's edit published and returns everyone else's to review. Asking would mean a second save mode per user and a new server surface, to produce the same outcome behind a differently-labelled button.
- **Unsaved changes block the exit.** Leaving in explicit mode with a dirty record prompts, and confirming discards. No draft is kept in the browser — ADR-0006 deleted the browser stores and this page does not bring them back.
- **Movements are markers' peers, not their superiors.** Creating, naming, re-timing and deleting a movement are all in scope, starts stay strictly increasing, and deleting a movement never deletes the markers inside it — they fall to the movement before, and the confirm says the labels will renumber.
- **`M` adds a marker at the playhead.** ADR-0005 removed the letter-jump keys entirely, so the key is unclaimed and the collision that retired it the first time no longer exists. `[` and `]` nudge by a tenth of a second, `Shift` for a second; `Alt` and the arrows stay the browser's, as ADR-0003 promised.

## Consequences

### What this buys

- **A created project can be filled.** The link field stops minting work that can never be completed, and a recording nobody has marked becomes a recording a student can mark for themselves.
- **Contribution from scratch is unblocked**, on the terms ADR-0006 set — a public project *is* a contribution, and now one can be authored rather than only renamed.
- **Movements become real.** The feature ADR-0005 added to fix labelling is now authorable by the people who need it.

### What it costs

- **Two save modes in one app.** Autosave is the idiom everywhere else, and the page breaks it for exactly the projects where a save is most consequential. The rule is state-derived and testable, but it is a second thing to learn.
- **The review machinery goes live.** Marker edits now demote published public projects, which is the design — but it is the first time the queue has faced owner-initiated churn, and the trusted-user valve is the only thing bounding it.
- **The owner can damage their own markings.** A practice surface the owner cannot fumble is a surface where the owner also cannot work; the editing tools and the risk arrive together.

### What this invalidates

| Where | What is now false |
| --- | --- |
| ADR-0003 — "What it costs" | _"The app cannot author markers — accepted"_ — it can, on its own page |
| ADR-0003 — same section | _"a new label set cannot be written in-app, and a published set cannot be changed"_ — both are now possible |
| ADR-0003 — "What this invalidates" | the "Publication status" note that resubmission is unavailable "until the editing page lands" — it has landed |
| ADR-0003 — the `A`–`Z` clause | the letter jumps it listed as surviving were removed by ADR-0005; `M` is an unclaimed key, not "a plain letter" |
| ADR-0003's name for this page | "the label-editing page" — a misnomer: labels are derived from time rank and never edited |

### Glossary changes

The glossary gains two terms: **Markings** — a project's markers and movements taken together, as distinct from the recording they are pinned to and the name its owner gives it — and **Markings page**, the surface where they are authored and the only place they can be changed. "Label set" is now recorded as a term to avoid rather than merely a retired one.

## Considered options

- **Marker editing inside the player, behind a posture toggle or an in-place affordance.** ADR-0003 rejected both, and this does not reopen them: editing on the practice surface competes with the recording and reintroduces the fumble risk the practice surface exists to remove.
- **Autosave everywhere, no Save control.** Rejected: a stray keypress would take a published project off the public gallery, and unlike every other save in the app that consequence lands outside the owner's own account.
- **Explicit Save everywhere.** Rejected: it costs a commit step on private projects where nothing is at risk, and leaves the app with one save model that is wrong for the common case.
- **Ask the server whether the owner is trusted, and skip the gate for trusted owners.** Rejected: two save modes per user, a new server surface exposing a published-project count to any signed-in caller, and a warning that must be hedged anyway — all to reach an outcome the server's trigger already produces from the same button.
- **Keep unsaved work in the browser so nothing is ever lost.** Rejected: it reintroduces the browser stores ADR-0006 deleted and needs reconciliation rules for a server row that moved on.
- **A page that only creates sets and never revises them.** Rejected: marking is iterative by nature — a mark pressed at the moment a landmark is heard always lands late — so a set that cannot be corrected is a set that is wrong.
