# ADR-0009 — The gallery sorts by hot, newest, oldest, and most popular

**Status:** Accepted — 2026-10-28
**Supersedes:** ADR-0008's sentence "Ordering is by the recording's newest published project, newest first."
**Spec:** #235 (T100–T103)
**Superseded in part — 2026-10-29 (#247):** every mention of "Hot" is superseded by ADR-0010, which renames the sort to "Trending." The formula, default, and behavior stand.

## Context

ADR-0008 made the gallery's unit the recording and gave it one order: each recording's newest published project, newest first. That told a reader what was published last and nothing else. They could not see what other people were opening, dig back to the earliest recordings, or surface recordings that are both fresh and drawing attention. The app recorded no engagement signal, so it had nothing to rank by besides publish time.

## Decision

**The gallery has four sorts, and Hot is the default.** Every sort ranks recording cards, so a recording with several published projects still renders once and is never split by sorting.

- **A card's age** is the date of its newest published project — the date the gallery already used.
- **A card's views** are the sum of the views of all its published projects, so a recording with several popular projects is not under-ranked.
- **Hot** is Reddit's formula with the decay tuned for low traffic: `log10(max(views, 1)) + age_seconds / 604800`. A recording one week newer ranks the same as one with ten times the views. A recording with no views scores by its age alone, so new recordings appear high and the gallery does not freeze around early popular ones.
- **Newest** orders by age, newest first. **Oldest** is exactly its reverse. **Most popular** orders by views, most first.
- **Ties under any sort fall back to newest first.**
- **A view** is recorded each time anyone opens a published public project's read-only page. It is counted every time, from the public page only — never from the editor, the Markings page, or playback. It is held in a `view_count` column that no client role can update directly; a security-definer function adds one to a published public project and silently ignores any other id, so it never reveals whether a hidden project exists. Recording a view changes neither `updated_at` nor `publication_status`. The caller fires it and forgets it, so a failed count never breaks reading.
- **The browser does the ordering.** The read's server-side order is unchanged; a pure ordering rule beside the grouping and search helpers turns cards and a sort into an order. Search filters, the sort orders what it leaves, and changing the sort keeps the search text.
- **The sort lives in the gallery's own state.** It resets to Hot when the reader leaves and returns.
- **The card is unchanged.** Views are never shown on it.

## Consequences

### What this buys

- **The front door answers "what is worth opening?"** Hot blends recency and attention; the other three sorts are predictable.
- **Search and sort compose.** A reader can search inside any order.
- **No new failure modes.** The read, empty gallery, failed read and retry behave as before; only the order changes.

### What it costs

- **A refresh inflates a count.** Views are not deduplicated, so Most popular can be gamed by reloading. That is accepted while the count is invisible and nothing depends on it.
- **Ordering is in the browser.** Hot is a per-card aggregate that cannot be precomputed or indexed, so a gallery that outgrows a single read must move ordering to the server and store a per-recording score. That change would get its own ADR.
- **A card's position and link still differ.** Its position follows the active sort; its link is still the oldest published project (ADR-0008).

## What this invalidates

| Where | What is now false |
| --- | --- |
| ADR-0008 — the Decision's ordering bullet | *"Ordering is by the recording's newest published project, newest first."* — that is Newest, one of four sorts |

ADR-0008's per-recording cards, sparse card and oldest-project link target all stand.

## Glossary changes

**Public gallery** is redefined as ordered by the reader's gallery sort. **Gallery sort**, **Hot** and **View** are added, along with a card's **age** and **views**.

## Considered options

- **Likes, favourites or votes.** Rejected: an explicit signal needs an account, a control and a moderation story, for a gallery whose readers are mostly anonymous. A view needs none of those, and a reader's opening a page is the signal the gallery already has.
- **Deduplicating views by visitor, session, IP or day.** Rejected: it needs identity or storage the anonymous reader does not otherwise have, and it protects a number nothing yet depends on. Revisit it if the count is ever shown.
- **Keeping the sort in the URL.** Rejected: the gallery is the front door and a bare `/` should open on Hot. A shared link to a sort, or a sort that survives a visit, is not something a reader asked for.
- **Showing the count on the card.** Rejected: the card is deliberately sparse (ADR-0008), and a visible count is an invitation to inflate it. With the count hidden, an inflated view only moves a ranking, and the cost of gaming the gallery stays low.
- **Reddit's 12.5-hour decay constant.** Rejected: it suits a feed that turns over by the hour. This gallery gains a handful of recordings a week, so a half-day constant would sink everything older than a day to the bottom regardless of attention. A week makes one week of age worth tenfold the views, which keeps both signals in play at low traffic.
