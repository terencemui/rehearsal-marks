# ADR-0008 — The public gallery browses recordings

**Status:** Accepted — 2026-10-21
**Amends:** ADR-0004's gallery search and gallery measure
**Prototype:** `proto/gallery-cards` (tip `3080321`) — never merged, never imported
**Superseded in part — 2026-10-28 (#238):** the sentence "Ordering is by the recording's newest published project, newest first" is superseded by ADR-0009; that order is now Newest, one of four gallery sorts. Everything else here stands.

## Context

The public gallery is the app's front door, and its natural unit is the **recording**. A project is one person's markings for a recording; ADR-0006 removed the published-per-video unique index, so a recording may carry several public projects. The gallery nonetheless rendered projects: a heading per recording, then a ruled row per published project. Under the intended one-set-per-video assumption that was one heading and one row per recording, but the page exposed nothing about the recording itself at a glance — no still, no duration — and a recording with more than one project read as a list of near-duplicates.

Two facts identified a performance in the catalogue: what the video looks like and how long it runs. The page had neither, and its static "Published … newest first." subtitle told a reader nothing the list did not.

Spec #208 posed the card's anatomy on `proto/gallery-cards`, judged against a local gallery of four hr-Sinfonieorchester recordings — a working fixture, not the branch's one-recording seed, so the comparison is not reproducible from the primary source. T90 (#209, PR #212) folded the winning card and T91 (#210, PR #213) made the search recording-level.

## Decision

**The gallery's unit is the recording.** The anonymous read is unchanged — published public projects, newest first — and the existing grouping helper collapses that flat list by video ID.

- **One card per recording with at least one published public project.** The card is the recording's 16:9 YouTube still with a duration chip in its bottom-right corner, and the canonical recording title beneath it. No project name, marker count, movement count, or owner attribution. The title is clamped to two lines. A recording with several published projects still renders once.
- **A card opens the recording's oldest published project** at `/gallery/:id`. The oldest is the default target, resolved from the *unfiltered* group so a project-name query cannot silently move the link.
- **Ordering is by the recording's newest published project, newest first.** The card's link target (oldest) and its position (newest) deliberately differ: the position is a recency signal, the target a stable canonical one.
- **Search is recording-level.** A trimmed, case-insensitive substring match against the recording title or any project name keeps the *whole* group, untrimmed, so the card's contents and link are invariant under a query. Unmatched recordings drop; a blank query returns everything.
- **Extra published projects are temporarily unreachable from the gallery.** A recording with more than one published project exposes only its oldest until the player's set switcher ships. The data is untouched and no project is hidden from its owner; only the gallery's route to the others is deferred. This is accepted under the one-set-per-video assumption.
- **The gallery fills the shared rail.** The grid is an ordered list of link cards, three across by default, two at 860px, one at 560px, and no horizontal scroll. The prose cap and the static subtitle are gone; the `Gallery` heading stands over the grid, and the status live region remains.
- **The read, schema, API, and RLS are unchanged.** This is a presentation and search-rule change; no movement-count data is added.

## Consequences

### What this buys

- **The front door looks like a catalogue**, and a performance is recognisable by its still and running time before it is opened.
- **A recording is one thing to look at.** Several projects on a video no longer read as separate rows.
- **Search speaks in recordings**, matching either the canonical title or a remembered project name without splitting the card.

### What it costs

- **Some published projects are unreachable from the gallery** until the player's set switcher exists. The oldest is the only default; the rest are not listed, disclosed, or linked.
- **The card is deliberately sparse.** There is no marker count, movement count, or owner attribution, so the gallery cannot answer "how much is marked here?" at a glance.
- **Two orderings live on one card.** Its position follows the newest project, its link the oldest — a distinction a maintainer must keep in mind when touching grouping or search.

## What this invalidates

| Where | What is now false |
| --- | --- |
| ADR-0004 — the search amendment (2026-10-21) | *"a project-name match keeps only the matching projects"* — it keeps the whole recording card |
| ADR-0004 — the frame amendment (2026-10-21) | *"the public gallery's 760px … stays inside the frame"* — the gallery declares no prose cap and fills the rail |

## Glossary changes

**Public gallery** is redefined as the anonymous browse surface of one card per recording, ordered by its newest published project, a card opening the oldest, no account needed to read or play.

## Considered options

The prototype's three losing card anatomies, all judged against the same data and grid:

- **A — YouTube-literal.** Facts stacked under the image, duration on the image. Rejected: a video listing's metadata line, not a catalogue card.
- **B — Plate.** The recording title in a ruled band under the image. Rejected: the band gave the title weight the still had already earned, and the metadata line remained.
- **C — Contents.** A three-row table of contents under the image. Rejected: it made the card a summary of one project rather than a way into the recording.

**D — Title only** won: the still, its duration, and the canonical recording title, and nothing else.
