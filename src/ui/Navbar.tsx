import { NavLink } from 'react-router';
import type { AuthState } from '../auth';
import { ContributorControl } from './Contributor';
import './navbar.css';

export interface NavbarProps {
  /** The contributor session — the same state the Projects list's badges read. */
  authState: AuthState;
  onSignIn: () => void;
  onSignOut: () => void;
  /** Requests the signed-in contributor's account deletion (T26). */
  onDeleteAccount: () => void;
}

/**
 * The one global navbar (T44): the app name, the Projects and Help links with
 * active states, and the contributor sign-in — the shell chrome that replaced
 * the workspace's header-plus-tabs pair. Renders on every routed page; the
 * player is folded into the frame by a later ticket, so until then the player
 * keeps its own Projects control.
 */
export function Navbar({ authState, onSignIn, onSignOut, onDeleteAccount }: NavbarProps) {
  return (
    <nav className="app-nav" aria-label="Primary">
      <div className="page-rail app-nav-inner">
        <h1 className="app-name">Rehearsal Marks</h1>
        <NavLink to="/" end className="app-nav-link">
          Projects
        </NavLink>
        <NavLink to="/help" className="app-nav-link">
          Help
        </NavLink>
        <div className="app-nav-auth">
          <ContributorControl
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
