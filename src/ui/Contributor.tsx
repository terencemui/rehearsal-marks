import { useState } from 'react';
import type { AuthState } from '../auth';
import './contributor.css';

export interface ContributorControlProps {
  /** The current auth state — the app owns the controller, this renders it. */
  state: AuthState;
  onSignIn: () => void;
  onSignOut: () => void;
  /** Requests the signed-in contributor's account deletion (T26). */
  onDeleteAccount: () => void;
}

/**
 * The sign-in surface: one control in the persistent navbar (T44). Anonymous
 * visitors see
 * Sign in with Google (viewing never requires an account); a signed-in
 * contributor sees who they are, Sign out, and the account-deletion path;
 * an unconfigured deployment states so plainly — the app never blocks on
 * auth.
 *
 * A failed sign-in, sign-out, or account deletion arrives as a notice on the
 * state it describes, next to the control that caused it, the same way the
 * create surface keeps rejection guidance beside its input.
 */
export function ContributorControl({ state, onSignIn, onSignOut, onDeleteAccount }: ContributorControlProps) {
  // The delete confirmation's open state — ephemeral UI that lives with the
  // control. A successful delete unmounts this branch; a failure arrives as
  // a notice on the signed-in state while the confirmation stays open, so
  // the user sees what happened and can retry or cancel.
  const [confirmingDelete, setConfirmingDelete] = useState(false);

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
        <div className="contributor-account">
          <div className="contributor-account-line">
            <span>Signed in as {state.contributor.name}</span>
            <button type="button" className="contributor-sign-out" onClick={onSignOut}>
              Sign out
            </button>
            <button type="button" className="contributor-delete" onClick={() => setConfirmingDelete(true)}>
              Delete account
            </button>
          </div>
          {confirmingDelete && (
            <p className="contributor-confirm-delete">
              Deleting your account removes it and every label set you've contributed — this
              can't be undone.
              <button type="button" className="contributor-delete-confirm" onClick={onDeleteAccount}>
                Delete forever
              </button>
              <button type="button" className="contributor-delete-cancel" onClick={() => setConfirmingDelete(false)}>
                Cancel
              </button>
            </p>
          )}
          {state.notice !== undefined && (
            <p role="alert" className="contributor-notice">
              {state.notice}
            </p>
          )}
        </div>
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
