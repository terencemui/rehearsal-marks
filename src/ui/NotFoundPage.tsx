import { Link } from 'react-router';
import './not-found.css';

export interface NotFoundPageProps {
  /**
   * Where the back link points — the Projects list by default, and the
   * gallery for the public read-only view (T50), whose "not found" surfaces
   * belong to a different list than the owner's own.
   */
  backTo?: string;
  /** The back link's label, naming the surface it leads back to. */
  backLabel?: string;
}

/**
 * The not-found page (T47): the routed surface a project URL that names no
 * record lands on — a project deleted in another tab, a stale link, a
 * hand-edited address. The plain statement replaces the blank or broken
 * surface, and the page itself carries the way back to the list, so a reader
 * reaching a dead project URL is never stranded with no exit but the navbar.
 * The default leads back to the owner's Projects list; the public read-only
 * view (T50) points it at the gallery instead.
 */
export function NotFoundPage({ backTo = '/projects', backLabel = 'Back to Projects' }: NotFoundPageProps) {
  return (
    <section className="not-found">
      <h2>This project could not be found</h2>
      <p className="not-found-copy">It may have been deleted, or the link may be out of date.</p>
      <Link to={backTo} replace className="not-found-back">
        {backLabel}
      </Link>
    </section>
  );
}
