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
 * src/domain, and the legal documents live in src/ui/Legal.tsx. The keyboard
 * tables' mirroring is not left to discipline — keyboardReference.test.tsx
 * holds them to the document's, and the document to the keys the player
 * actually answers to.
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
        <p>
          Two surfaces play a recording, and both are keyboard-operable: the{' '}
          <strong>practice surface</strong> — a recording played back, from the public
          gallery or from a project's own page — and the <strong>Markings page</strong>,
          where a project's owner authors what it carries. Playback is the same on both, and
          read-only on both: a student practising never changes the recording. The keys that
          place and correct a marker exist only on the page where a marker may be changed.
        </p>

        <h4 id="help-keyboard-practice">The practice surface</h4>
        <table aria-labelledby="help-keyboard-practice">
          <thead>
            <tr>
              <th>Key</th>
              <th>Action</th>
            </tr>
          </thead>
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
            <tr>
              <td>Click a movement header</td>
              <td>Jump to that movement's start</td>
            </tr>
          </tbody>
        </table>
        <p>
          Markers are labeled A, B, C… by time order, restarting at A within each movement.
          Jumping never selects a marker and never interrupts playback. Labels continue past{' '}
          <kbd>Z</kbd> (<kbd>AA</kbd>, <kbd>AB</kbd>, …), and the arrow keys reach every marker.
        </p>

        <h4 id="help-keyboard-markings">The Markings page</h4>
        <table aria-labelledby="help-keyboard-markings">
          <thead>
            <tr>
              <th>Key</th>
              <th>Action</th>
            </tr>
          </thead>
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
                <kbd>M</kbd>
              </td>
              <td>Place a marker at the playhead</td>
            </tr>
            <tr>
              <td>
                <kbd>[</kbd> / <kbd>]</kbd>
              </td>
              <td>Nudge the row the playhead is on a tenth of a second earlier / later</td>
            </tr>
            <tr>
              <td>Click a marker row</td>
              <td>Jump to it</td>
            </tr>
            <tr>
              <td>Click the time in a movement header</td>
              <td>Jump to that movement's start</td>
            </tr>
          </tbody>
        </table>
        <p>
          <kbd>M</kbd> places a marker where the recording is and touches nothing else: the marker
          falls at the playhead, and the recording plays on. The same act has a control beside the
          markers heading, <strong>Add marker</strong>, for a pointer. A movement boundary is
          placed by ear the same way — <strong>Add movement</strong> — and has no key of its own.
        </p>
        <p>
          <kbd>[</kbd> and <kbd>]</kbd> move the row the recording is on a tenth of a second
          earlier or later; hold <kbd>Shift</kbd> for a whole second. The row is the playhead's:
          the marker the recording has last passed, or the boundary it is sitting on — and a
          boundary wins when one is under the playhead, whether or not a mark stands there too. So
          the block of controls is wherever the recording is, with nothing to click to begin, and
          the mark <kbd>M</kbd> has just made is the mark it is on. It holds still while the caret
          is in one of the row's own fields — the time, or the name beside the label — so the
          recording cannot take the field away mid-entry, and follows the playhead again once no
          caret is in a field of that row.
        </p>
        <p>
          A correction moves the recording to the time it writes: a nudge, or a committed typed
          time, puts the playhead on the new value — mark and boundary alike — so the row stays
          under the correction that moved it, and the change is heard at once. Nothing else about
          playback moves, so the recording keeps playing, or stays paused, exactly as it was. The{' '}
          <strong>−0.1s</strong> and <strong>+0.1s</strong> controls beside the field make the same
          division.
        </p>
        <p>
          This page's <kbd>↑</kbd> and <kbd>↓</kbd> are the practice surface's, and they reach a
          marker the same way: the jump moves the playhead to it, and the playhead is what decides
          the row. The walk is over markers only, so a movement's boundary is reached by clicking
          the time in its header, by the playhead sitting on it, or by letting the recording play
          into it. Before the first marker, and with no boundary under the playhead, <kbd>[</kbd>{' '}
          and <kbd>]</kbd> have no row to act on and do nothing. A typed alias or time is
          committed when the field is left, which <kbd>Enter</kbd> does.
        </p>

        <h4 id="help-keyboard-browser">Keys the browser keeps</h4>
        <p>
          Play, pause, and volume come from the recording's own controls on both surfaces.{' '}
          <kbd>Alt</kbd>+arrows are the browser's again — the marker nudge that used to claim them
          is gone — and <kbd>Shift</kbd>+arrows stay the browser's too (scroll, selection).{' '}
          <kbd>M</kbd> is a plain chord for the same reason: <kbd>⌘M</kbd> minimises the window.
        </p>
      </section>

      <section aria-labelledby="help-markers">
        <h3 id="help-markers">Markers and limits</h3>
        <ul>
          <li>
            A marker is placed on the project's <strong>Markings page</strong> — the{' '}
            <strong>Markings</strong> button on the project's row in your projects list opens
            it, as does the <strong>Markings →</strong> link beside a project's markers. Play
            the recording and press <kbd>M</kbd> where a landmark goes by: the marker falls at
            the playhead, and you name it afterwards. A marker that landed early or late is
            corrected there too, by nudging it or typing the time.
          </li>
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
          <li>
            The panel follows the playhead: jump, or let the recording play on, and the marker
            you are on moves to the top of the list, so it is always the first one you read.
            Scroll the list yourself and it leaves you alone for a few seconds before taking the
            playhead back up — and while the playhead is not moving, a scroll is left alone for
            as long as you like.
          </li>
        </ul>
      </section>

      <section aria-labelledby="help-projects">
        <h3 id="help-projects">Projects</h3>
        <ul>
          <li>
            Your projects live on the server, in your account — <strong>not in this browser</strong>.
            Sign in with Google to create one from a YouTube link, and everything you do is saved{' '}
            <strong>automatically</strong> as you work: a status line shows <strong>Saving…</strong>{' '}
            turning to <strong>Saved</strong>. There is no save button — except on a project
            already out in the world, where saving is a decision you make (see{' '}
            <strong>Public projects and review</strong>).
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
            Editing a <strong>Published</strong> or <strong>Rejected</strong> project is a save
            you make yourself: its Markings page carries a <strong>Save changes</strong> control
            instead of writing as you work, because saving returns a published project to review
            and takes it off the public gallery until a maintainer approves it again. A{' '}
            <strong>trusted user</strong>'s edits publish immediately, and every other project —
            private, or still pending — saves itself as you work.
          </li>
          <li>
            A row that shows <strong>Rejected</strong> was never public. Editing it and saving
            returns it to review.
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
