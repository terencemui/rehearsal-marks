import { NavLink } from 'react-router';
import type { AuthState } from '../auth';
import { UserControl } from './UserControl';
import './navbar.css';

export interface NavbarProps {
  /**
   * The rail the page under this navbar takes (T74) — the shell's own class
   * string, handed in rather than decided here, so the navbar and the page it
   * heads are always the same width. Decided separately, they disagreed on
   * every player route: the page widened and the navbar did not.
   */
  railClass: string;
  /** The user session — the same state the workspace's create gate reads. */
  authState: AuthState;
  onSignIn: () => void;
  onSignOut: () => void;
  /** Requests the signed-in user's account deletion (T26). */
  onDeleteAccount: () => void;
}

/**
 * The one global navbar (T44): the app name, the Gallery and Projects links
 * with active states, and the user sign-in — the shell chrome that
 * replaced the workspace's header-plus-tabs pair. Renders on every routed
 * page, including the project page (T45): the player's own Projects control
 * is retired, and the navbar links are the only navigation. The gallery is
 * the front door at `/` (T50); the owner's workspace lives at `/projects`.
 *
 * The wordmark wears the direction (T76): the name is set in the document's
 * face with the rehearsal mark in its box in front of it, and it is the
 * navbar's way home — a link rather than a label, so the identity is also a
 * control. The box is markup carrying `aria-hidden`, not a decorative
 * pseudo-element as it was on the prototype, since the mark is no longer
 * throwaway and only a real element can be kept out of the accessible name:
 * the wordmark is announced as the app's name alone, and the box that draws
 * its initial adds nothing to read.
 */
export function Navbar({
  railClass,
  authState,
  onSignIn,
  onSignOut,
  onDeleteAccount,
}: NavbarProps) {
  return (
    <nav className="app-nav" aria-label="Primary">
      <div className={`${railClass} app-nav-inner`}>
        <h1 className="app-name">
          <NavLink to="/" end className="app-name-link">
            <span className="app-mark" aria-hidden="true">R</span>
            Rehearsal Marks
          </NavLink>
        </h1>
        <NavLink to="/" end className="app-nav-link">
          Gallery
        </NavLink>
        <NavLink to="/projects" end className="app-nav-link">
          Projects
        </NavLink>
        <div className="app-nav-auth">
          <UserControl
            state={authState}
            onSignIn={onSignIn}
            onSignOut={onSignOut}
            onDeleteAccount={onDeleteAccount}
          />
        </div>
      </div>
    </nav>
  );
}
