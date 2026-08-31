import { useState } from 'react';
import { PrivacyPolicy, TermsOfService } from './Legal';
import './help.css';

/**
 * The Help tab: the discoverable home for everything the player keeps off the
 * visible chrome — the keyboard scheme, the marker rules, how projects and
 * accounts work, and what public means. Static reference content; the only
 * state is which legal document (T26) is showing behind the privacy-policy and
 * terms links, swapped in for the reference content and back again. No storage
 * access.
 *
 * Keep the facts here in sync with their sources of truth: the keyboard
 * reference mirrors docs/keyboard-reference.md, the marker rules live in
 * src/domain, and the legal documents live in src/ui/Legal.tsx.
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
        Everything about this app in one place. Your projects live on the server, tied to your
        Google account — sign in to create and edit, while reading and playing stay open to
        everyone. YouTube playback streams from Google. Read the{' '}
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
              <td>Click a marker row</td>
              <td>Jump to it</td>
            </tr>
          </tbody>
        </table>
        <p>
          Markers are labeled A, B, C… by time order, restarting at A within each movement.
          Jumping never selects a marker and never interrupts playback. Labels continue past{' '}
          <kbd>Z</kbd> (<kbd>AA</kbd>, <kbd>AB</kbd>, …), and the arrow keys reach every marker.
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
            <strong>Recap</strong> — which the readout shows and the marker's row reveals on
            hover. Aliases are non-empty, trimmed, at most <strong>16 characters</strong>, and
            unique across all aliases in a project.
          </li>
          <li>
            Marker labels run A, B, C… by time order and restart at A within each movement, so a
            movement's letters always read the same. They continue past Z as AA, AB, … — you
            never run out.
          </li>
          <li>
            When a recording has movements, the markers group under sticky movement headers —
            click one to jump to that movement's start.
          </li>
        </ul>
      </section>

      <section aria-labelledby="help-projects">
        <h3 id="help-projects">Projects</h3>
        <ul>
          <li>
            Your projects live on the server, in your account — <strong>not in this browser</strong>.
            Sign in with Google to create one from a YouTube link, and everything you do is saved{' '}
            <strong>automatically</strong> as you work: a status line in the player shows{' '}
            <strong>Saving…</strong> turning to <strong>Saved</strong>. There is no save button.
          </li>
          <li>
            Reading and playing never requires an account; creating and editing do. Anonymous
            visitors can open public projects but can't change them, and nothing project-shaped
            is stored in the browser at all.
          </li>
          <li>
            A project plays its video from YouTube itself: playback <strong>streams from
            Google's</strong> servers while the video stays visible, per YouTube's terms. Your
            markers sit on a full-width <strong>timeline</strong> below the video — click
            anywhere to seek — and live in your project on the server:{' '}
            <strong>Google never sees them</strong>.
          </li>
        </ul>
      </section>

      <section aria-labelledby="help-review">
        <h3 id="help-review">Public projects and review</h3>
        <p>
          A new project is <strong>public by default</strong>: once it clears review, anyone can
          read and play it. The whole path is in the app — sign in with Google, create from a
          link, and await review. There is nothing to download or set up.
        </p>
        <ol>
          <li>
            Sign in with Google and create a project from a YouTube link. It is public by
            default and sits as <strong>pending</strong> — visible to you, not yet to anyone
            else.
          </li>
          <li>
            A maintainer reviews it. A row that shows <strong>Published</strong> is public —
            anyone who opens this video gets your project's markers.
          </li>
          <li>
            A row that shows <strong>Rejected</strong> was never public; editing the project and
            saving returns it to review.
          </li>
          <li>
            Make a project <strong>private</strong> and only you can see it. Making it public
            again sends it to review once more.
          </li>
        </ol>
        <p>
          A public project is <strong>public by definition</strong> — anyone who opens this video
          reads your markers, and the project is attributed to you (your Google account). Publish
          only markers you placed yourself on this exact performance.
        </p>
      </section>

      <section aria-labelledby="help-account">
        <h3 id="help-account">Your account</h3>
        <p>
          Sign-in is with Google — the only account the app ever asks for. Reading and playing
          never requires one; creating and editing do.
        </p>
        <p>
          Your projects are tied to your account. Deleting your account from the header removes
          the account and <strong>every project you've created</strong> — it can't be undone.
        </p>
      </section>
    </section>
  );
}
