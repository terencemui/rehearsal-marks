# ADR-0005 — Movements in recordings: repeated labels, derived membership, and the authoring gap

**Status:** Accepted — 2026-08-28
**Supersedes:** the A–Z "surviving keyboard navigation" clause of ADR-0003

## Context

The domain model has no concept of a subdivision of a recording. A single video of a symphony presents its markers as one flat, globally-labelled list — A, B, C … T — but the printed score restarts rehearsal letters at every movement. A student practising a four-movement work therefore faces a screen that cannot represent "rehearsal C in the third movement" at all. Handling multi-movement videos means giving the recording internal structure, making labels mirror the score, and reconciling the practice surface to repeated labels.

## Decision

**A Movement is a named subdivision of a recording**: `{ id, name, start }`. Boundaries are **start-only** — a movement's extent runs to the next movement's start or the recording's end — and starts are strictly increasing. Movements are **optional**: a project or label set with zero movements behaves exactly as before, and every reader tolerates the absence of movement data, so existing files and published sets keep working.

- **Membership is derived from time, never stored.** A marker belongs to the movement whose start is the latest start ≤ its time (a marker at a movement's start belongs to that movement); before the first movement's start it belongs to none. Markers carry no movement reference.
- **Labels restart per movement.** A marker's label is its rank within its own movement — movement I runs A, B, C; movement II starts fresh at A. Labels remain derived, never stored.
- **The A–Z letter-jump keys are removed entirely** — for every project, not just multi-movement ones. Labels became ambiguous, and resolving that ambiguity (current-movement, next-occurrence, or a movement-key-first press) all fought the single-press premise of ADR-0003. With the keys gone, the alias-vs-label collision rule — which existed only to keep letter navigation unambiguous — is **dropped**; aliases keep non-empty, ≤16 chars, per-set dedupe, and case-insensitive uniqueness against *other aliases only*.
- **The practice surface.** The markers panel groups rows by movement under a sticky, scroll-driven movement header that swaps as the next movement's group scrolls into place and seeks to the movement's start when clicked. ↑/↓ still walk the full recording across movement boundaries; the practice readout's passed/next slots stay bare (movement-qualified slots and a movement subtitle line are held as prototype candidates, not shipped).
- **Movements ship in the label set.** The project file and Commons row gain an additive `movements` array alongside markers; membership and labels are derived from it at load. Whether this rides as schema version 1 (tolerant) or 2 is a migration detail for implementation.

## Consequences

- **Authoring is deferred**, exactly as it is for markers (ADR-0003): nothing in-app creates, renames, moves, or deletes a movement yet. Movement data can only arrive via a hand-edited project file or a future tool until the label-editing page ships — the format carries it and the surface displays it, nothing produces it.
- **A published set now implies a label reading that depends on the set's own data** — movement boundaries are a fact about this performance, like markers, so they belong in the contribution rather than as a per-viewer local overlay. Without this, the same set would render different rehearsal letters to different students depending on whether they drew boundaries, breaking the Commons.
- The player's keyboard behaviour loses the A–Z keys that ADR-0003 documented as surviving; `docs/keyboard-reference.md` and the Help tab need to follow.
- The glossary gains **Movement** and **Label** now reads "derived from its time rank within its movement — restarting at A for each movement."

## Considered options

- **Start+end boundaries** vs start-only — start-only chosen: no redundant span state (overlaps, ends before starts), the end is derived, and performers think in starts.
- **Stored membership** vs derived — derived chosen: mirrors labels (never stored), no invariant surface for a marker whose stored movement contradicts its time.
- **Labels continue globally** vs restart — restart chosen: it mirrors the score, which is the point of the feature; continuation makes movements purely cosmetic.
- **Resolve the A–Z ambiguity** (jump to current movement's marker / next occurrence / movement key first) vs **remove the keys** — removal chosen: one keyboard behaviour, no data-dependent branching, and the keys' only design constraint (alias collision) disappears with them.
- **Readout presentation**: movement-qualified slots and a movement subtitle line were real alternatives; bare slots shipped, the other two held for prototyping.
