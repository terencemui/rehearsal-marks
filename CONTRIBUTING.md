# Contributing a label set

The community library of CC0 recordings is labeled by students like you. A
label set is **one JSON file** — your markers plus the facts that tie them to
exactly one recording. Contributing one is a ten-minute, one-pull-request
task.

The same workflow is documented in the app's Help tab; this file is the
GitHub-facing version with the review rules made explicit.

> **Status:** the Library tab and the label-set export are still in
> development. This file documents the target workflow in full so the path is
> in place from day one; the app-side steps (open the recording, export the
> label set) become usable as those features land.

## What a label set is

A label set is a `project.json` file containing:

- **markers** — each with a time in seconds and optional aliases ("Recap",
  "Development"), labeled A, B, C… by time order,
- **recording identity** — the `sha256` of the exact recording, its duration,
  source, license, and attribution.

The identity is what makes a label set validatable: it can only ever be
applied to the one recording it was made from. Markers from a different
performance don't transfer, and the app says so plainly.

Label sets are facts about a recording (like a table of contents), not
copyrightable expression — sharing them is unproblematic.

## The rules

1. **One file, one recording, one pull request.** A PR adds exactly
   `library/labelsets/<entry-id>.json` and nothing else. Split unrelated
   recordings into separate PRs.
2. **Library recordings only.** You can contribute labels for a recording
   that is already in `library/library.json`. Audio never lives in this repo —
   new recordings are added by a maintainer (see `docs/maintainer-catalog.md`),
   and your own uploads can never be shared: they never leave your browser.
3. **No audio files.** A PR containing an audio file is rejected outright.
4. **The markers must be your own, placed on this exact recording.** The
   sha256 check makes this verifiable, not just promised.

## Step by step

1. **Open the recording** in the app — from the Library tab. Place your
   markers while listening (press `M` as each rehearsal mark goes by). Labels
   come out A, B, C… in time order automatically; correct any timestamps with
   the nudge buttons in the inspector.
2. **Export the label set.** In the player, choose **Export → Label set
   (JSON)**. This writes one `project.json` carrying your markers and the
   recording's identity.
3. **Fork this repository.** On GitHub, fork `terencemui/rehearsal-marks`.
4. **Add the file at `library/labelsets/<entry-id>.json`**, where
   `<entry-id>` is the recording's id in `library/library.json` — one file, no
   other changes.
5. **Open a pull request** against `main` with that single file. In the
   description, name the piece and performer, and confirm the checklist below.
6. **Address review.** A maintainer runs the review checklist in
   `docs/maintainer-catalog.md` and may ask for timestamp corrections. Review
   is bounded by the one-file rule: there is nothing to bikeshed but the markers
   themselves.
7. **Merged.** Your label set ships in the Library for every student on the
   next deploy.

## Self-check before you open the PR

- [ ] The PR contains exactly one file: `library/labelsets/<entry-id>.json`.
- [ ] The `<entry-id>` matches an existing entry in `library/library.json`.
- [ ] `audioMeta.sha256` matches the catalog entry's `sha256` exactly (it will
      be re-verified in review).
- [ ] `audioMeta.duration` is within a second or two of the catalog's duration
      — a mismatch means the markers were made against a different performance.
- [ ] Markers are in time order and each label letter appears exactly once
      (labels are re-derived from time order on import — the file's labels are
      informational).
- [ ] The recording is CC0 and the attribution matches the catalog entry.

If any check fails, the PR is declined with a note; fix the file and
re-push — the pull request itself is reusable.
