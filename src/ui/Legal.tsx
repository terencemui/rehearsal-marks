/**
 * The privacy policy and terms (T26) — in-app documents reachable from the
 * Help tab. Static content, deliberately short, and written in the app's own
 * honest voice: the privacy promise is restated per ADR-0006 — projects live
 * on the server in your account, while public projects are public by
 * definition. Keep the facts in sync with the behavior they describe: the
 * project rules in `src/projects/`, the YouTube streaming in
 * `src/audio/youtube.ts`, and the account deletion in `src/auth/`.
 */

/** The privacy policy: what the app holds, what it never holds, and what is public. */
export function PrivacyPolicy() {
  return (
    <>
      <h2>Privacy policy</h2>
      <p className="legal-updated">Last updated: August 31, 2026</p>

      <h3>Your projects live on the server, in your account</h3>
      <p>
        Projects — your markers, aliases, and the YouTube links they're pinned to — live in your
        account on the server, and only you can change them. Creating and editing require signing
        in with Google; anonymous visitors can read and play public projects but are never asked
        for an account. Nothing project-shaped is stored in your browser.
      </p>

      <h3>YouTube playback streams from Google</h3>
      <p>
        A YouTube project plays its video from YouTube itself. Playing a video sends Google the
        usual data a video player sends, under{' '}
        <a href="https://policies.google.com/privacy">Google's privacy policy</a>. Your markers
        live in your project on the server — Google never sees them.
      </p>

      <h3>Public projects are public by definition</h3>
      <p>
        New projects are public by default, and a public project is readable and playable by
        anyone who opens the video. Each sits as <strong>pending</strong> until a maintainer
        reviews it — then <strong>published</strong> or <strong>rejected</strong>. Making a
        project private hides it from everyone but you.
      </p>

      <h3>Creating holds an account</h3>
      <p>
        Creating and editing a project requires signing in with Google. The app stores the name
        and email your Google account provides; that identity is what your projects are
        attributed to. A <strong>public project is public by definition</strong> — every student
        can read it — and it is attributed to you.
      </p>

      <h3>Deleting your account</h3>
      <p>
        You can delete your account from the app at any time — the <strong>Delete account</strong>{' '}
        control in the header. Deleting removes your account and <strong>every project you've
        created</strong> — public or private — and it can't be undone.
      </p>

      <h3>Where the data lives</h3>
      <p>
        The server runs on Supabase, a hosted Postgres database. Your Google sign-in and your
        projects are held there, behind row-level security: anonymous readers see published
        public projects only, and only you can change your own.
      </p>

      <h3>Contact</h3>
      <p>
        Questions about this policy? Open an issue on the{' '}
        <a href="https://github.com/terencemui/rehearsal-marks">project's GitHub repository</a>.
      </p>
    </>
  );
}

/** The terms: what the app is, what publishing means, and the honest limits. */
export function TermsOfService() {
  return (
    <>
      <h2>Terms</h2>
      <p className="legal-updated">Last updated: August 31, 2026</p>

      <h3>What the app is</h3>
      <p>
        Rehearsal Marks is a practice tool: your projects live on the server in your account, and
        public projects are readable by everyone. Using the app means accepting these terms.
      </p>

      <h3>Your projects are your responsibility</h3>
      <p>
        Your account and the projects in it are yours. A project that is public can be read and
        played by anyone; a private one is visible only to you. Keep your account's access — the
        app can't restore a project you delete, and deleting your account removes every project
        you've created.
      </p>

      <h3>Public projects</h3>
      <p>
        When a project of yours is public, you confirm that you placed the markers yourself on
        the exact performance the project describes and that you're allowed to share them. A
        public project is public and attributed to you; your account deletion removes your
        projects.
      </p>

      <h3>Moderation</h3>
      <p>
        New projects sit as pending until a maintainer reviews them. The maintainer may reject a
        project or remove a published one; the app may also remove projects that break these
        terms.
      </p>

      <h3>No warranty</h3>
      <p>
        The app is provided as-is, without warranty of any kind. It may have bugs, and the server
        may be unavailable.
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
