import './help.css';

/**
 * The Help tab: the discoverable home for everything the player keeps off the
 * visible chrome — the keyboard scheme, the accepted formats and their limits,
 * how storage works, what eviction can do, and the label-set contribution
 * workflow. Static reference content; no state, no storage access.
 *
 * Keep the facts here in sync with their sources of truth: the keyboard
 * reference mirrors docs/keyboard-reference.md, the format rules live in
 * src/upload/upload.ts, and the contribution workflow matches CONTRIBUTING.md.
 */
export function HelpTab() {
  return (
    <section className="help">
      <h2>Help</h2>
      <p className="help-intro">
        Everything about this app in one place. Your projects stay in your browser — YouTube
        playback streams from Google, and nothing leaves the app unless you choose to publish
        a label set to the Commons.
      </p>

      <section aria-labelledby="help-keyboard">
        <h3 id="help-keyboard">Keyboard reference</h3>
        <p>
          The player is fully keyboard-operable. Every shortcut below is suppressed while focus
          is in a text field (the marker time or aliases inputs), so typing never seeks, jumps,
          or deletes.
        </p>
        <p>
          The player has two postures, switched from the <strong>Playback | Label</strong>{' '}
          segmented control in the transport bar. <strong>Playback mode</strong> is the practice
          posture: navigation tools with read-only markers. <strong>Label mode</strong> keeps
          every navigation tool and adds the editing tools. Uploads open in Label mode; YouTube
          projects open in Playback mode when community labels load for the video, in Label mode
          otherwise; library-seeded projects open in Playback mode. The last-used mode is
          remembered per project.
        </p>
        <h4>Both modes</h4>
        <table>
          <tbody>
            <tr>
              <td>
                <kbd>Space</kbd>
              </td>
              <td>Play / pause</td>
            </tr>
            <tr>
              <td>
                <kbd>←</kbd> / <kbd>→</kbd>
              </td>
              <td>Seek ∓5 seconds</td>
            </tr>
            <tr>
              <td>
                <kbd>↑</kbd> / <kbd>↓</kbd>
              </td>
              <td>Jump to the previous / next marker, wrapping at the ends</td>
            </tr>
            <tr>
              <td>
                <kbd>A</kbd>–<kbd>Z</kbd>
              </td>
              <td>Jump straight to that marker</td>
            </tr>
            <tr>
              <td>Click a marker flag</td>
              <td>Jump to it</td>
            </tr>
            <tr>
              <td>The volume slider</td>
              <td>Adjust playback level</td>
            </tr>
          </tbody>
        </table>
        <p>
          Markers are labeled A, B, C… by time order. Jumping never selects a marker — selection
          exists only for editing — and never interrupts playback. Labels continue past{' '}
          <kbd>Z</kbd> (<kbd>AA</kbd>, <kbd>AB</kbd>, …); the arrow keys reach every marker,
          including those a single letter key cannot.
        </p>
        <p>
          <kbd>M</kbd> means different things per posture: in Label mode it adds a marker (the
          marker labeled M is reached with the arrow keys there); in Playback mode it jumps to
          the marker labeled M like every other letter.
        </p>
        <h4>Label mode</h4>
        <table>
          <tbody>
            <tr>
              <td>
                <kbd>M</kbd> (or the Add marker button)
              </td>
              <td>Add a marker at the playhead, without pausing</td>
            </tr>
            <tr>
              <td>Double-click the waveform</td>
              <td>Add a marker at that position</td>
            </tr>
            <tr>
              <td>Long-press (touch)</td>
              <td>Add a marker at that position</td>
            </tr>
            <tr>
              <td>Click a marker flag</td>
              <td>Jump to it and select it for editing</td>
            </tr>
            <tr>
              <td>
                <kbd>Alt</kbd>+<kbd>←</kbd> / <kbd>Alt</kbd>+<kbd>→</kbd>
              </td>
              <td>Nudge the selected marker ∓0.1 seconds</td>
            </tr>
            <tr>
              <td>
                <kbd>Delete</kbd> / <kbd>Backspace</kbd>
              </td>
              <td>Delete the selected marker (undo toast for 5 seconds)</td>
            </tr>
            <tr>
              <td>
                <kbd>Esc</kbd>
              </td>
              <td>Deselect</td>
            </tr>
          </tbody>
        </table>
        <p>
          The same nudges exist as ±0.1s and ±1s buttons in the inspector, next to the time field
          (accepts <code>5:10.5</code>, <code>310.5</code>, <code>5 10</code>) and the aliases
          field (non-empty, ≤16 characters, unique per project).
        </p>
      </section>

      <section aria-labelledby="help-formats">
        <h3 id="help-formats">Formats and limits</h3>
        <ul>
          <li>
            Uploads accept <strong>MP3</strong> and <strong>M4A</strong> recordings. WAV and FLAC
            are rejected with conversion guidance — convert with e.g.{' '}
            <code>ffmpeg -i recording.wav -b:a 192k recording.mp3</code>.
          </li>
          <li>
            Marker times accept loose input: <code>5:10.5</code>, <code>310.5</code>, or{' '}
            <code>5 10</code>. They display as <code>mm:ss.mmm</code> (<code>h:mm:ss.mmm</code> for
            recordings an hour or longer).
          </li>
          <li>
            Aliases are non-empty, trimmed, at most <strong>16 characters</strong>, and unique
            across all labels and aliases in a project.
          </li>
          <li>
            Marker labels run A, B, C… and continue past Z as AA, AB, … — you never run out, and
            labels always follow time order.
          </li>
        </ul>
      </section>

      <section aria-labelledby="help-storage">
        <h3 id="help-storage">Storage</h3>
        <ul>
          <li>
            Projects live entirely in this browser: your markers and your uploaded recordings{' '}
            <strong>stay in your browser</strong>. There are no accounts for projects and no
            server uploads — the app is your hard drive. The one exception is the Commons: a
            label set you submit there is shared with every student once it's published.
          </li>
          <li>
            A <strong>YouTube project</strong> plays its video from YouTube itself: playback
            streams from Google's servers while the video stays visible, per YouTube's terms.
            The project still lives entirely in this browser — its marks stay in it, and
            Google never sees them.
          </li>
          <li>
            Everything is saved <strong>automatically</strong> as you work (no save button), with a
            Saved / Saving status line in the player.
          </li>
          <li>
            If browser storage fills up, the app tells you honestly and shows each project's size,
            so you can free space deliberately.
          </li>
          <li>
            <strong>Export is the backstop.</strong> Each project row has an Export button: it
            downloads a single zip (your markers plus the audio) and you hold a copy nothing in
            the browser can touch — re-import it any time, on any machine.
          </li>
        </ul>
      </section>

      <section aria-labelledby="help-eviction">
        <h3 id="help-eviction">Storage eviction</h3>
        <p>
          Browser storage is not permanent storage. A browser can evict site data under disk
          pressure, privacy settings, or policy — most aggressively in iOS Safari, which clears
          script-writable storage of sites not added to the home screen after about{' '}
          <strong>7 days</strong>.
        </p>
        <ul>
          <li>
            <strong>Add Rehearsal Marks to your home screen</strong> (browser menu → Add to Home
            Screen) — installed apps are exempt from the 7-day iOS eviction.
          </li>
          <li>
            <strong>Export your projects.</strong> The zip export is the only guarantee that
            survives any eviction; treat the browser copy as a cache, the zip as the truth.
          </li>
        </ul>
      </section>

      <section aria-labelledby="help-contribute">
        <h3 id="help-contribute">Contribute a label set</h3>
        <p>
          Label sets are the community's shared marks for a performance — contributed two ways,
          depending on the recording. YouTube performances are published from inside the app,
          with nothing to download or set up; CC0 Library recordings keep the repo's
          pull-request flow.
        </p>

        <h4>From the app — YouTube performances</h4>
        <p>
          If you marked a public performance on YouTube and want every student to start from
          your marks, the whole path is in the app:
        </p>
        <ol>
          <li>
            Create a project from the performance's YouTube link and place your marks — labels
            come out A, B, C… in time order automatically.
          </li>
          <li>
            Sign in with Google — the only account the app ever asks for. Reading label sets
            never requires one; publishing does.
          </li>
          <li>
            Submit your label set. It sits as <strong>pending</strong> — visible to you, not
            yet to anyone else — until a maintainer reviews it.
          </li>
          <li>
            Once <strong>published</strong>, anyone who opens this video gets your marks, and
            you can update them any time — updates return the set to pending and go through
            review again.
          </li>
        </ol>
        <p>
          Publishing makes your marks public — publish only marks you placed yourself on this
          exact performance.
        </p>

        <h4>The CC0 Library — through the repo</h4>
        <p>
          Label sets for Library recordings go through the repo's pull-request flow, which
          needs a GitHub account — the Library's rows promise license and attribution, so
          contributions are reviewed in git. The GitHub-facing version with the review rules
          is <code>CONTRIBUTING.md</code>; the path is:
        </p>
        <ol>
          <li>
            Open the library recording in the app and place your markers — labels come out
            A, B, C… in time order automatically.
          </li>
          <li>
            On the Projects screen, choose <strong>Export labels</strong> on that project's row.
            This downloads one JSON file carrying your markers and the recording's identity
            (sha256, duration, source, license, attribution) — the facts that make the set
            applicable to exactly one recording.
          </li>
          <li>
            Fork the{' '}
            <a href="https://github.com/terencemui/rehearsal-marks">rehearsal-marks repo</a> and
            add the exported file, renamed to <code>&lt;entry-id&gt;.json</code>, at{' '}
            <code>library/labelsets/</code> — one file, one recording, nothing else.
          </li>
          <li>
            Open a pull request with that single file. Reviewers verify the checklist in
            docs/maintainer-catalog.md — recording identity, marker sanity, and the CC0-only
            rule.
          </li>
          <li>
            Once merged, your label set ships in the Library for every student. Only label sets
            for library recordings can be contributed this way: your own uploads never leave
            your browser.
          </li>
        </ol>
      </section>
    </section>
  );
}
