# ADR-0004 — Routed pages and a persistent navbar

**Status:** Accepted — 2026-08-27
**Scope:** the workspace pages (spec #89, ticket T44). The project pages (`/projects/:id`, route-as-session) are the next slice of the same spec and will extend this ADR rather than replace it.

## Context

The app was one screen. Projects and Help sat at the top of a single workspace behind a tab bar; opening a project replaced the whole screen with the player, and no URL ever changed. There was no address for a page — a refresh landed you back at first paint, browser Back and Forward did nothing meaningful, and there was nothing to bookmark. The player even drew its own little "Projects" button because there was no way to navigate away from it. The shell carried a header-plus-tabs pair, and the player carried its own rail.

## Decision

**The app is served by a router, and the workspace becomes pages (T44).**

- **Router: React Router v7 in declarative mode.** The `react-router` package, `BrowserRouter` at the app entry, no framework plugin, no server data loading. This is the one new runtime dependency.
- **History-mode URLs.** `/` is the Projects home (create-from-link, the list, rename, delete, submission, notices and status); `/help` is the reference; a catch-all route sends any unknown path back to `/`. This requires the eventual static host to serve `index.html` for unknown paths — an SPA-fallback rewrite. The hosting decision is not made yet; the requirement is recorded where the router mounts (`main.tsx`) and here.
- **One persistent navbar replaces the header-plus-tabs pair.** The app name, **Projects** and **Help** links with active states (the router's `aria-current`), and the contributor sign-in render on every routed page. The navbar is the shell chrome; the header's tagline does not survive the replacement.
- **The page rail frames the workspace pages.** The player's rail (a maximum content width with fluid side margins) becomes the shared `page-rail`, applied to the navbar's contents and to every page, so the frame is coherent and no page scrolls sideways when the window narrows.
- **The player keeps its own frame for now — a flagged interim gap.** Opening a project still swaps the whole screen to the player, without the navbar, and the player keeps its Projects button and `onExit`. A later ticket folds the player into the page frame.
- **The App-level test seam is the router.** `App.test.tsx` renders the shell inside a `MemoryRouter` to control the starting URL and to drive Back and Forward (a `navigate(delta)` probe), asserting on what renders for a URL rather than on internal state.

## Consequences

### What this buys

- **Pages instead of a tab bar.** `/` and `/help` are real addresses: a refresh restores the workspace page, browser Back and Forward move between them, and a URL can be shared.
- **One chrome.** The navbar — name, page links with active states, sign-in — is the single persistent frame; the duplicated header and tabs are gone.
- **A coherent width frame.** The same rail wraps the navbar, the workspace pages, and the player, so content is never jammed against the window edge at any width.

### What this costs or defers

- **The project pages are not built here.** `/projects/:id` (route-as-session, the player folded into the navbar frame, the not-found page) is the next slice of spec #89. Until it lands, opening a project still drops into the player without the navbar — the flagged interim gap.
- **The header's tagline is dropped.** "Pin your score's rehearsal marks to your recording." was part of the replaced header; the navbar carries only the name, the links, and the sign-in, per the ticket's description.
- **A real refresh needs the SPA fallback.** Until the host rewrites unknown paths to `index.html`, a hard refresh on a routed URL is a deployment concern, not an app one — recorded, not implemented.
- **The duration stamp's write is unaffected.** The workspace re-reads the list on return exactly as before; the routing change does not touch the create/rename/delete/submit surface.
