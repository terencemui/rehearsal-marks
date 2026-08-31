import { NavLink } from 'react-router';
import type { AuthState } from '../auth';
import { UserControl } from './UserControl';
import './navbar.css';

export interface NavbarProps {
  /** The user session — the same state the workspace's create gate reads. */
  authState: AuthState;
  onSignIn: () => void;
  onSignOut: () => void;
  /** Requests the signed-in user's account deletion (T26). */
  onDeleteAccount: () => void;
}

/**
 * The one global navbar (T44): the app name, the Gallery, Projects, and Help
 * links with active states, and the user sign-in — the shell chrome that
 * replaced the workspace's header-plus-tabs pair. Renders on every routed
 * page, including the project page (T45): the player's own Projects control
 * is retired, and the navbar links are the only navigation. The gallery is
 * the front door at `/` (T50); the owner's workspace lives at `/projects`.
 */
export function Navbar({ authState, onSignIn, onSignOut, onDeleteAccount }: NavbarProps) {
  return (
    <nav className="app-nav" aria-label="Primary">
      <div className="page-rail app-nav-inner">
        <h1 className="app-name">Rehearsal Marks</h1>
        <NavLink to="/" end className="app-nav-link">
          Gallery
        </NavLink>
        <NavLink to="/projects" end className="app-nav-link">
          Projects
        </NavLink>
        <NavLink to="/help" className="app-nav-link">
          Help
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
