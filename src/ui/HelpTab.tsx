import { useState } from 'react';
import { PrivacyPolicy, TermsOfService } from './Legal';
import './help.css';

/**
 * The Help tab: the discoverable home for everything the player keeps off the
 * visible chrome — the keyboard scheme, the marker rules, how storage works,
 * what eviction can do, and the label-set contribution workflow. Static
 * reference content; the only state is which legal document (T26) is showing
 * behind the privacy-policy and terms links, swapped in for the reference
 * content and back again. No storage access.
 *
 * Keep the facts here in sync with their sources of truth: the keyboard
 * reference mirrors docs/keyboard-reference.md, the marker rules live in
 * src/domain, the contribution workflow matches CONTRIBUTING.md, and the
 * legal documents live in src/ui/Legal.tsx.
 */
export function HelpTab() {
  // Which document is showing: null is the reference content itself.
  const [doc, setDoc] = useState<'privacy' | 'terms' | null>(null);

  if (doc !== null) {
    return (
      <section className="help">
        <button type="button" className="help-back" onClick={() => setDoc(null)}>
          ← Back to Help
        </button>
        {doc === 'privacy' ? <PrivacyPolicy /> : <TermsOfService />}
      </section>
    );
  }

  return (
    <section className="help">
      <h2>Help</h2>
      <p className="help-intro">
        Everything about this app in one place. Two kinds of data live here: your projects,
        which stay in your browser and never leave it, and the label sets you contribute to the
        Commons, which are public by definition. YouTube playback streams from Google. Read the{' '}
        <button type="button" className="help-link" onClick={() => setDoc('privacy')}>
          Privacy policy
        </button>{' '}
        and{' '}
        <button type="button" className="help-link" onClick={() => setDoc('terms')}>
          Terms
        </button>
        .
      </p>

      <section aria-labelledby="help-keyboard">
        <h3 id="help-keyboard">Keyboard reference</h3>
        <p>The player is fully keyboard-operable.</p>
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
              <td>
                Jump straight to that marker — <kbd>M</kbd> is just the letter for the marker
                labelled M
              </td>
            </tr>
            <tr>
              <td>Click a marker flag</td>
              <td>Jump to it</td>
            </tr>
          </tbody>
        </table>
        <p>
          Markers are labeled A, B, C… by time order. Jumping never selects a marker and never
          interrupts playback. Labels continue past <kbd>Z</kbd> (<kbd>AA</kbd>, <kbd>AB</kbd>,{' '}
          …); the arrow keys reach every marker, including those a single letter key cannot.
        </p>
        <p>
          Play, pause, and volume come from the recording's own controls. The player no longer
          intercepts <kbd>Alt</kbd>+arrows — the marker nudge that used to claim them is gone,
          so <kbd>Alt</kbd>+arrows are the browser's again.
        </p>
      </section>

      <section aria-labelledby="help-markers">
        <h3 id="help-markers">Markers and limits</h3>
        <ul>
          <li>
            The readout shows marker times in whole seconds — easy to read from a music stand —
            while each marker keeps its full precision for seeking.
          </li>
          <li>
            A marker can carry an alias — a second name beside its letter, like{' '}
            <strong>Recap</strong> — which the readout shows and the marker's flag reveals on
            hover. Aliases are non-empty, trimmed, at most <strong>16 characters</strong>, and
            unique across all labels and aliases in a project.
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
            Projects live entirely in this browser: your markers, aliases, and the YouTube links
            they're pinned to <strong>stay in your browser</strong>. There are no accounts for
            projects and no server uploads. Local projects <strong>never leave your browser</strong>,
            not even to the Commons.
          </li>
          <li>
            The Commons is the one hosted surface. A label set you contribute there is stored on
            a server, and once <strong>published</strong> it is public: every student can read
            it, and it is attributed to you.
          </li>
          <li>
            A project plays its video from YouTube itself: playback <strong>streams from
            Google's</strong> servers while the video stays visible, per YouTube's terms. Your
            markers sit on a full-width <strong>timeline</strong> below the video — click
            anywhere to seek — and stay in your browser: <strong>Google never sees them</strong>.
          </li>
          <li>
            Everything is saved <strong>automatically</strong> as you work — there is no save
            button.
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
            <strong>The Commons is the only durable home for your markers.</strong> A published
            label set lives on the server, not in this browser — submit your label set if you
            can't afford to lose it. That copy is public, though; the markers you keep to
            yourself survive only as long as this browser does.
          </li>
        </ul>
      </section>

      <section aria-labelledby="help-contribute">
        <h3 id="help-contribute">Contribute a label set</h3>
        <p>
          Label sets are the community's shared markers for a performance. Publishing one happens
          entirely in the app — sign in with Google, submit, and await review. There is nothing
          to download or set up.
        </p>
        <p>
          <strong>Markers can't be written in the app yet.</strong> The player is read-only over
          your markers, and the label-editing page that lets you place, move, and rename them
          hasn't been built. Until it lands, a project can't be given its own markers, and a
          published set can't be changed.
        </p>

        <h4>From the app</h4>
        <p>
          If you marked a public performance on YouTube and want every student to start from
          your markers, the whole path is in the app:
        </p>
        <ol>
          <li>
            Open the project you want to contribute.
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
            A rejected set comes back to you: the row shows <strong>Rejected</strong>, your
            markers were never public, and submitting it again returns it to review. Once{' '}
            <strong>published</strong>, anyone who opens this video gets your markers; updating
            the set — once the label-editing page can change it — returns it to pending and
            goes through review again.
          </li>
        </ol>
        <p>
          A published label set is <strong>public by definition</strong> — anyone who opens
          this video reads your markers, and the set is attributed to you (your Google account).
          Publish only markers you placed yourself on this exact performance. Submissions are
          limited to three label sets in any 7 days.
        </p>
      </section>
    </section>
  );
}
