# Contributing a label set

Label sets are the community's shared marks for a recording, contributed two
ways, depending on the recording:

- **YouTube performances — from the app.** Sign in, submit, await review.
  Nothing to download, nothing to set up. Written for musicians; start at
  [From the app](#from-the-app--youtube-performances).
- **CC0 Library recordings — through the repo.** The Library keeps its
  GitHub pull-request flow, because its rows promise license and attribution.
  [The Library flow](#the-cc0-library--through-the-repo) is unchanged.

## From the app — YouTube performances

You marked a public performance on YouTube and want every student to start
from your marks. The whole path is inside the app — there is nothing to
download or set up.

> **Status:** the in-app submit step is documented here in full so the path
> is in place from day one; it becomes usable when the Commons query (T21)
> and sign-in (T24) land. The flow below is the target.

1. **Open the performance.** Create a project from its YouTube link and
   place your marks while listening (press `M` as each rehearsal mark goes
   by). Labels come out A, B, C… in time order automatically; correct any
   timestamps with the nudge buttons in the inspector.
2. **Sign in with Google.** The only account the app ever asks for. Reading
   label sets never requires one; publishing does.
3. **Submit your label set.** One step in the app. Your marks for this
   video go to the Commons as a **pending** submission — visible to you,
   not yet to anyone else.
4. **Await review.** A maintainer listens and checks the marks, exactly as
   they would check any contribution. Submissions are usually quick.
5. **Published.** Your label set loads for every student who opens the
   video. You can update it any time — edits return it to pending and go
   through review again.

A label set is facts about a recording (like a table of contents), not
copyrightable expression — sharing your own marks is unproblematic. Publish
only marks you placed yourself on this exact performance: marks made against
one recording never transfer to another, and the app says so plainly.

## The CC0 Library — through the repo

The community library of CC0 recordings is labeled by students like you. A
label set is **one JSON file** — your markers plus the facts that tie them to
exactly one recording. Contributing one is a ten-minute, one-pull-request
task. This flow needs a GitHub account; it is the Library's by design (see
ADR-0001) and unchanged. The same workflow is documented in the app's Help
tab; this file is the GitHub-facing version with the review rules made
explicit.

### What a label set is

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

### The rules

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

### Step by step

1. **Open the recording** in the app — from the Library tab. Place your
   markers while listening (press `M` as each rehearsal mark goes by). Labels
   come out A, B, C… in time order automatically; correct any timestamps with
   the nudge buttons in the inspector.
2. **Export the label set.** On the Projects screen, choose **Export labels**
   on the project's row. This downloads one JSON file carrying your markers
   and the recording's identity.
3. **Fork this repository.** On GitHub, fork `terencemui/rehearsal-marks`.
4. **Add the file at `library/labelsets/<entry-id>.json`** (renaming the
   exported file to `<entry-id>.json`), where `<entry-id>` is the recording's
   id in `library/library.json` — one file, no other changes.
5. **Open a pull request** against `main` with that single file. In the
   description, name the piece and performer, and confirm the checklist below.
6. **Address review.** A maintainer runs the review checklist in
   `docs/maintainer-catalog.md` and may ask for timestamp corrections. Review
   is bounded by the one-file rule: there is nothing to bikeshed but the markers
   themselves.
7. **Merged.** Your label set ships in the Library for every student on the
   next deploy.

### Self-check before you open the PR

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
