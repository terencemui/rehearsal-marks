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

## Adding one

Cut the branch while the prototype still exists in the working tree — before the fold deletes its wiring — and capture it in the state it was judged, not after. Put the question, the verdict, and what was faked in the commit message; this index is built from those messages, and they are the prototype's own account of itself.

Add the row here in the same commit that cuts the branch, or as soon as its verdict lands. A prototype whose only pointer is a commit message on a branch nobody fetches is the situation this file exists to prevent.
