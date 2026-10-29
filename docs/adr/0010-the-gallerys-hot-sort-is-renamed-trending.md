# ADR-0010 — The gallery's Hot sort is renamed Trending

**Status:** Accepted — 2026-10-29
**Supersedes:** ADR-0009's naming of the sort as "Hot" — not its formula, default, or behavior
**Spec:** #247 (T106)

## Context

ADR-0009 named the gallery's default sort "Hot," after Reddit's formula it borrows. "Hot" needed explaining to a reader who had not seen that formula, and read ambiguously to an anonymous visitor — a card could be "hot" in the sense of popular right now, or just on fire. "Trending" is the term other platforms (YouTube, X, and others) already use for the same blend of recency and attention, so a reader recognizes it without being told what it means.

## Decision

**The sort is renamed "Hot" → "Trending," end to end, with no change to its formula, default, or behavior.** Every reader- and caller-facing name changes: the sort control's option, the `GallerySort` type literal (`'hot'` → `'trending'`), the default state, and — for consistency — the `hotScore` helper, renamed `trendingScore`.

## Consequences

Nothing ranks differently; nothing about the formula, the default, or the tie-break changes. The only risk is a stale mention of "Hot" surviving in a comment, a test name, or the glossary — this ADR's acceptance criteria call out each of those surfaces by name.

## What this invalidates

| Where | What is now false |
| --- | --- |
| ADR-0009 — every mention of "Hot" | the sort is now called "Trending"; the formula, default, and behavior are unchanged |

## Glossary changes

**Hot** is renamed **Trending**, with the same definition. **Public gallery** and **Gallery sort**'s mentions of Hot are updated to Trending. The glossary's **Trending** entry's own *Avoid* list, which previously avoided "trending," now avoids "hot" instead — a deliberate reversal, not an oversight.
