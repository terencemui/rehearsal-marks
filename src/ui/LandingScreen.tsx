import './landing.css';

export interface LandingScreenProps {
  /** Starts the Google OAuth flow — the landing's only action. */
  onSignIn: () => void;
  /**
   * A transient failure the anonymous visitor must see — the workspace's
   * notice channel, so a read failure on a project page survives the bounce
   * home (T51): a signed-out user lands here, and the failure is not lost.
   */
  notice?: string | null;
}

/**
 * The anonymous home (T51): the read side of the app is coming, so a signed-
 * out visitor lands on a short page that says what this is, that creating and
 * saving projects needs sign-in, and that a public gallery of projects is
 * coming. There is deliberately no create surface here — creating is a
 * signed-in act now.
 */
export function LandingScreen({ onSignIn, notice = null }: LandingScreenProps) {
  return (
    <section className="landing" aria-label="Welcome">
      {notice !== null && (
        <p role="alert" className="landing-notice">
          {notice}
        </p>
      )}
      <h2>Mark your rehearsal, save it, come back to it.</h2>
      <p>
        Rehearsal Marks is a practice tool for musicians: you pin labeled markers to a YouTube
        recording and jump between them as you play.
      </p>
      <p>
        Creating and saving projects requires signing in with Google. A public gallery of
        projects is on the way — until then, reading projects works from a link you're given.
      </p>
      <button type="button" className="landing-sign-in" onClick={onSignIn}>
        Sign in with Google
      </button>
    </section>
  );
}
