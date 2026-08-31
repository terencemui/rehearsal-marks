import { useState } from 'react';
import type { AuthState } from '../auth';
import './user.css';

export interface UserControlProps {
  /** The current auth state — the app owns the controller, this renders it. */
  state: AuthState;
  onSignIn: () => void;
  onSignOut: () => void;
  /** Requests the signed-in user's account deletion (T26). */
  onDeleteAccount: () => void;
}

/**
 * The sign-in surface: one control in the persistent navbar (T44). Anonymous
 * visitors see Sign in with Google (viewing never requires an account); a
 * signed-in user sees who they are, Sign out, and the account-deletion path.
 * An unconfigured deployment never renders here at all — the app gates on the
 * env and shows its "not wired up" screen (T51).
 *
 * A failed sign-in, sign-out, or account deletion arrives as a notice on the
 * state it describes, next to the control that caused it, the same way the
 * create surface keeps rejection guidance beside its input.
 */
export function UserControl({ state, onSignIn, onSignOut, onDeleteAccount }: UserControlProps) {
  // The delete confirmation's open state — ephemeral UI that lives with the
  // control. A successful delete unmounts this branch; a failure arrives as
  // a notice on the signed-in state while the confirmation stays open, so
  // the user sees what happened and can retry or cancel.
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (state.kind === 'signed-in') {
    return (
      <div className="user-status">
        <div className="user-account">
          <div className="user-account-line">
            <span>Signed in as {state.user.name}</span>
            <button type="button" className="user-sign-out" onClick={onSignOut}>
              Sign out
            </button>
            <button type="button" className="user-delete" onClick={() => setConfirmingDelete(true)}>
              Delete account
            </button>
          </div>
          {confirmingDelete && (
            <p className="user-confirm-delete">
              Deleting your account removes it and every project you've created — this can't be
              undone.
              <button type="button" className="user-delete-confirm" onClick={onDeleteAccount}>
                Delete forever
              </button>
              <button type="button" className="user-delete-cancel" onClick={() => setConfirmingDelete(false)}>
                Cancel
              </button>
            </p>
          )}
          {state.notice !== undefined && (
            <p role="alert" className="user-notice">
              {state.notice}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="user-status">
      <button type="button" className="user-sign-in" onClick={onSignIn}>
        Sign in with Google
      </button>
      {state.notice !== undefined && (
        <p role="alert" className="user-notice">
          {state.notice}
        </p>
      )}
    </div>
  );
}
