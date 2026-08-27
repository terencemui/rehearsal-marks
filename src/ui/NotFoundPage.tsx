import { Link } from 'react-router';
import './not-found.css';

/**
 * The not-found page (T47): the routed surface a `/projects/:id` URL that
 * names no record lands on — a project deleted in another tab, a stale link,
 * a hand-edited address. The plain statement replaces the blank or broken
 * surface, and the page itself carries the way back to the Projects list, so
 * a reader reaching a dead project URL is never stranded with no exit but
 * the navbar.
 */
export function NotFoundPage() {
  return (
    <section className="not-found">
      <h2>This project could not be found</h2>
      <p className="not-found-copy">It may have been deleted, or the link may be out of date.</p>
      <Link to="/" replace className="not-found-back">
        Back to Projects
      </Link>
    </section>
  );
}
