import type { AuthState } from '../auth';
import './contributor.css';

export interface ContributorControlProps {
  /** The current auth state — the app owns the controller, this renders it. */
  state: AuthState;
  onSignIn: () => void;
  onSignOut: () => void;
}

/**
 * The sign-in surface: one control in the app header. Anonymous visitors see
 * Sign in with Google (viewing never requires an account); a signed-in
 * contributor sees who they are and Sign out; an unconfigured deployment
 * states so plainly — the app never blocks on auth.
 *
 * A failed sign-in or sign-out arrives as a notice on the state it describes,
 * next to the control that caused it, the same way the create surface keeps
 * rejection guidance beside its input.
 */
export function ContributorControl({ state, onSignIn, onSignOut }: ContributorControlProps) {
  if (state.kind === 'unavailable') {
    return (
      <p className="contributor-status contributor-status-unavailable" title={state.reason}>
        Sign-in isn't set up yet
      </p>
    );
  }

  if (state.kind === 'signed-in') {
    return (
      <div className="contributor-status">
        <span>Signed in as {state.contributor.name}</span>
        <button type="button" className="contributor-sign-out" onClick={onSignOut}>
          Sign out
        </button>
        {state.notice !== undefined && (
          <p role="alert" className="contributor-notice">
            {state.notice}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="contributor-status">
      <button type="button" className="contributor-sign-in" onClick={onSignIn}>
        Sign in with Google
      </button>
      {state.notice !== undefined && (
        <p role="alert" className="contributor-notice">
          {state.notice}
        </p>
      )}
    </div>
  );
}
