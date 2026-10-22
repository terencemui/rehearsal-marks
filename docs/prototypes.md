# Prototypes

Throwaway design explorations, kept on their own branches as primary sources after the winning layout is folded into main. The fold ships the winner and deletes the losers from the main line, so a prototype branch is often the only home the rejected alternatives have.

## When a prototype branch is kept

Keep it when it holds something main structurally cannot:

- **The rejected alternatives.** Main carries the winner. The layouts that lost have nowhere else to live, and *"why not a side panel?"* is a question someone will ask again.
- **The judged state.** The comparison as it was actually made, including the fakes it declared.

Delete it when its only content was the winning design — main has that now, and better.

Two rules for every kept prototype:

- **It is pushed.** A citation into a branch that exists on one machine is a dangling reference. T41's acceptance criteria for `prototype/player-redesign` said as much: *"A branch exists, is pushed, and contains the three layouts and their switcher in the state they were judged."*
- **It is never merged and never imported.** Main carries no prototype code — T42 swept the last of it.

## The index

| Branch | Question it settled | Verdict | Cited from |
| --- | --- | --- | --- |
| `prototype/player-redesign`<br>`180f25b` | Which layout the playback-only player's practice surface wears — three console layouts (Split rail / Floating deck / Metro console) behind a dev-only switcher | Metro console won and was folded into the player. Split rail and Floating deck are this branch's reason to exist. | T41 (#76) cut it; spec #74; T42 (#82) removed the prototype from main |
| `capture/prototype-chapters`<br>`2fc5f0f` | The bottom timeline and chapters section — three variants (stacked list / side panel / chip strip) switched by `?variant=` on `/prototype/chapters` | Side panel won. The metro readout sits in the player's side column above a scrollable markers list, and the recording's clock became the full-width click-to-seek **timeline**. Shipped as the markers panel + timeline. | PR #103 |
| `prototype/markings-rows`<br>`0787d5a` | Where the **active row**'s correction controls live — three shapes, each judged at the panel's three real side-column widths (280 / 340 / 416px) | The correction in the row won: the clock slot becomes the time field while the row is active, the decks sit under it, the alias is text until the row is active. A block below the row, and one inline strip, were rejected. | ADR-0007's amendment; spec #152; PR #159 |
| `prototype/navbar-search`<br>`78257c4` | How the rebuilt navbar should carry the public gallery's search, the account menu (My projects / Privacy · Terms / Sign out / Delete account), and the signed-out sign-in and legal line without losing the paper-and-hairline direction — four layouts judged against a realistic gallery | **D won**: a permanent field centred in the frame, dropping to its own full-width row when narrow, every control a 32px ink-ruled box, brought onto the player's wide rail, serif content and sans chrome. **A** (an icon expands into the field), **B** (a permanent field in the row) and **C** (a two-row catalogue masthead) were rejected. The winner was re-derived on main as ordinary code; the branch is pushed and never merged, never imported. | T89 (#201); spec #195, folded by PRs #202–#206 |
| `proto/gallery-cards`<br>`3080321` | What a public-gallery card should carry — one card per recording, with the still, duration, recording title, project name, marker count and movement count to arrange. Four anatomies behind a dev-only `?variant=` switcher on the real `/`: **A** YouTube-literal (facts stacked under the image, duration on the image), **B** plate (title in a ruled band under the image), **C** contents (a three-row table of contents under the image), **D** title only (image, duration and recording title, no metadata) | **D won**: the 16:9 still with its duration chip, the canonical recording title, and nothing else. A, B and C were rejected — each carried the project name and counts D leaves off, and the card is a way into a recording, not a summary of one project. The card was re-derived on main as ordinary code; the branch is pushed and never merged, never imported. | T90 (#209), folded by PR #212; recording-level search folded by T91 (#210), PR #213; spec #208 |
| `prototype/visual-direction`<br>`b3f682c` | What the site's **first** design system is — the app has none, only placeholder CSS — posed as two whole directions (A *The Part*, a document you read / B *The Console*, an instrument you play) behind a dev-only `?variant=` switcher on the real gallery and player | **The Part won as a style; the current layout won as a structure — and the hybrid of the two is what shipped.** Part's chrome (score-white ground, hairlines, square corners, an engraving serif for content and a grotesque for chrome, a rehearsal mark as a letter in a ruled box) and Part's navbar were kept. Its *stave* was first rejected on the player in favour of today's split layout; re-judged as the hybrid's bottom element it was **kept after all**, so the marks are drawn on the strip and **ADR-0003 is amended rather than standing** — the panel survives beside the stave as the complete list. The Console was rejected outright, which restores the `capture/prototype-chapters` and `prototype/player-redesign` verdicts it had deliberately reversed. The branch is pushed and never merged and never imported — its own PR (#171), opened as a draft, was closed unmerged, and the winner was re-derived on main as ordinary code. | T81 (#181) refreshed it; spec #172, folded by PRs #182–#189 |

## Adding one

Cut the branch while the prototype still exists in the working tree — before the fold deletes its wiring — and capture it in the state it was judged, not after. Put the question, the verdict, and what was faked in the commit message; this index is built from those messages, and they are the prototype's own account of itself.

Add the row here in the same commit that cuts the branch, or as soon as its verdict lands. A prototype whose only pointer is a commit message on a branch nobody fetches is the situation this file exists to prevent.
