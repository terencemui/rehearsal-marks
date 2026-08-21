/**
 * The privacy policy and terms (T26) — in-app documents reachable from the
 * Help tab. Static content, deliberately short, and written in the app's own
 * honest voice: the privacy promise is restated per ADR-0001 — local
 * projects never leave the browser, while published label sets are public by
 * definition. Keep the facts in sync with the behavior they describe: the
 * storage rules in `src/storage/`, the YouTube streaming in
 * `src/audio/youtube.ts`, and the account deletion in `src/auth/`.
 */

/** The privacy policy: what the app holds, what it never holds, and what is public. */
export function PrivacyPolicy() {
  return (
    <>
      <h2>Privacy policy</h2>
      <p className="legal-updated">Last updated: August 20, 2026</p>

      <h3>Your projects stay in your browser</h3>
      <p>
        Projects — your recordings, markers, and aliases — live in this browser's storage and
        never leave it. There are no accounts for projects and no server uploads; nothing about
        a project is transmitted. Browser storage is not permanent storage, though — see{' '}
        <strong>Storage eviction</strong> in Help, and use Export to hold a copy nothing in the
        browser can touch.
      </p>

      <h3>YouTube playback streams from Google</h3>
      <p>
        A YouTube project plays its video from YouTube itself. Playing a video sends Google the
        usual data a video player sends, under{' '}
        <a href="https://policies.google.com/privacy">Google's privacy policy</a>. Your marks
        stay in your browser — Google never sees them.
      </p>

      <h3>The Commons</h3>
      <p>
        When you create a YouTube project, the app checks the Commons — the hosted collection of
        community label sets — for a published set for that video. That anonymous read sends
        the video's ID, and nothing else.
      </p>

      <h3>Contributing holds an account</h3>
      <p>
        Publishing a label set requires signing in with Google. The app stores the name and
        email your Google account provides; that identity is what your label sets are attributed
        to. A <strong>published label set is public by definition</strong> — every student can
        read it — and it is attributed to you. Submissions sit as pending until a maintainer
        reviews them.
      </p>

      <h3>Deleting your account</h3>
      <p>
        You can delete your account from the app at any time — the <strong>Delete account</strong>{' '}
        control in the header. Deleting removes your account and every label set you've
        contributed — published or still pending — and it can't be undone. Local projects are
        unaffected: they live in your browser, not on your account.
      </p>

      <h3>Where the data lives</h3>
      <p>
        The Commons runs on Supabase, a hosted Postgres database. Your Google sign-in and your
        label sets are held there, behind row-level security: anonymous readers see published
        sets only, and only you can change your own.
      </p>

      <h3>Contact</h3>
      <p>
        Questions about this policy? Open an issue on the{' '}
        <a href="https://github.com/terencemui/rehearsal-marks">project's GitHub repository</a>.
      </p>
    </>
  );
}

/** The terms: what the app is, what contributing means, and the honest limits. */
export function TermsOfService() {
  return (
    <>
      <h2>Terms</h2>
      <p className="legal-updated">Last updated: August 20, 2026</p>

      <h3>What the app is</h3>
      <p>
        Rehearsal Marks is a practice tool: your projects live in your browser, and community
        label sets live in the Commons. Using the app means accepting these terms.
      </p>

      <h3>Your projects are your responsibility</h3>
      <p>
        Keep an export of anything you can't afford to lose. Browser storage can be evicted at
        any time — by disk pressure, privacy settings, or policy — and the app can't restore
        what a browser removes.
      </p>

      <h3>Contributions</h3>
      <p>
        When you publish a label set, you confirm that you placed the marks yourself on the
        exact performance the set describes and that you're allowed to share them. A published
        label set is public and attributed to you; your account deletion removes your sets.
      </p>

      <h3>Moderation</h3>
      <p>
        Submissions sit as pending until a maintainer reviews them. The maintainer may reject a
        submission or remove a published set; the app may also remove sets that break these
        terms.
      </p>

      <h3>No warranty</h3>
      <p>
        The app is provided as-is, without warranty of any kind. It may have bugs, and the
        Commons may be unavailable.
      </p>

      <h3>Changes</h3>
      <p>
        These terms may be updated as the app changes; the date above shows the latest revision.
      </p>

      <h3>Contact</h3>
      <p>
        Questions about these terms? Open an issue on the{' '}
        <a href="https://github.com/terencemui/rehearsal-marks">project's GitHub repository</a>.
      </p>
    </>
  );
}
