import { Link } from 'react-router';
import './not-wired-up.css';

/**
 * The "not wired up" screen (T50): the gallery's honest face on a deployment
 * without the Supabase project that serves it — a dev build, a test run, a
 * preview. No gallery exists to show, so the screen says so plainly instead of
 * pretending; the workspace at `/projects` needs no server and keeps working,
 * and the link makes that the way out. Anonymous browsing needs no account,
 * but it does need the backend configured — this is the state that tells an
 * operator why the front door is empty.
 */
export function NotWiredUp() {
  return (
    <section className="not-wired-up">
      <h2>Public gallery isn’t connected yet</h2>
      <p className="not-wired-up-copy">
        This build has no Supabase project configured, so there is no public gallery to show.
        Your own projects still work — open them from the Projects list.
      </p>
      <Link to="/projects" className="not-wired-up-link">
        Open my projects
      </Link>
    </section>
  );
}
