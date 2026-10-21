import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
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

/** The account menu's chevron — decorative, so it adds nothing to the trigger's name. */
function Chevron() {
  return (
    <svg
      className="user-chevron"
      viewBox="0 0 10 6"
      width="10"
      height="6"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

/** The legal line — Privacy · Terms, the same two links in both auth states. */
function LegalLine({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <span className="user-legal-line">
      <Link to="/privacy" className="user-legal-link" onClick={onNavigate}>
        Privacy
      </Link>
      <span aria-hidden="true">·</span>
      <Link to="/terms" className="user-legal-link" onClick={onNavigate}>
        Terms
      </Link>
    </span>
  );
}

/**
 * The account control: the navbar's one authentication surface (T86).
 * Anonymous visitors see the legal line to the left of Sign in — one 32px row,
 * so the bar keeps one height in both auth states. A signed-in user sees their
 * name and a chevron, opening a disclosure with My projects, the legal line,
 * Sign out, and the account-deletion path; Delete account replaces the items
 * with the existing warning. An unconfigured deployment never renders here at
 * all — the app gates on the env (T51).
 *
 * A failed sign-in, sign-out, or account deletion arrives as a notice on the
 * state it describes, rendered beneath the control and outside the popup, so
 * it stays visible whether the popup is open or shut. A failed deletion keeps
 * the confirmation open, so the user can read the reason and retry or cancel.
 */
export function UserControl({ state, onSignIn, onSignOut, onDeleteAccount }: UserControlProps) {
  // The disclosure and its delete confirmation — ephemeral UI that lives with
  // the control. Both close on every route change (the menu's own links close
  // on click; this catches Back/Forward and any other navigation), and reset
  // when the auth state changes: a successful delete unmounts the signed-in
  // branch, and the next session must not open onto the previous one's
  // confirmation.
  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const location = useLocation();
  const controlRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const signInRef = useRef<HTMLButtonElement>(null);
  const previousKind = useRef(state.kind);
  const menuRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
    setConfirmingDelete(false);
  }

  useEffect(() => {
    setOpen(false);
    setConfirmingDelete(false);
  }, [state.kind, location.pathname]);

  // Signing out (or a completed deletion) removes the control the user just
  // pressed. Hand focus to the Sign in button that replaces it, so the next
  // Tab continues from the account control rather than the top of the page.
  useEffect(() => {
    if (previousKind.current === 'signed-in' && state.kind === 'anonymous') {
      signInRef.current?.focus();
    }
    previousKind.current = state.kind;
  }, [state.kind]);

  // An outside pointer-down closes the disclosure; Escape closes it and
  // returns focus to the trigger, so the keyboard user is never stranded.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (controlRef.current?.contains(event.target as Node)) return;
      setOpen(false);
      setConfirmingDelete(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setOpen(false);
      setConfirmingDelete(false);
      triggerRef.current?.focus();
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // Opening lands on the first item; the confirmation lands on Cancel, the
  // safe choice for a one-way action.
  useEffect(() => {
    if (!open) return;
    if (confirmingDelete) cancelRef.current?.focus();
    else menuRef.current?.querySelector<HTMLElement>('a, button')?.focus();
  }, [open, confirmingDelete]);

  if (state.kind === 'signed-in') {
    return (
      <div className="user-control" ref={controlRef}>
        <div className="user-account">
          <button
            ref={triggerRef}
            type="button"
            className="user-trigger"
            aria-haspopup="true"
            aria-expanded={open}
            onClick={() => {
              setOpen((current) => !current);
              setConfirmingDelete(false);
            }}
          >
            <span className="user-name">{state.user.name}</span>
            <Chevron />
          </button>
          {open && (
            <div ref={menuRef} className="user-menu" role="group" aria-label="Account">
              {confirmingDelete ? (
                <div className="user-confirm">
                  <p>
                    Deleting your account removes it and every project you've created — this
                    can't be undone.
                  </p>
                  <div className="user-confirm-actions">
                    <button
                      ref={cancelRef}
                      type="button"
                      className="user-cancel"
                      onClick={() => setConfirmingDelete(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="user-delete-forever"
                      onClick={onDeleteAccount}
                    >
                      Delete forever
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <Link to="/projects" className="user-menu-item" onClick={close}>
                    My projects
                  </Link>
                  <div className="user-menu-legal">
                    <LegalLine onNavigate={close} />
                  </div>
                  <div className="user-menu-sep" role="presentation" />
                  <button
                    type="button"
                    className="user-menu-item"
                    onClick={() => {
                      close();
                      onSignOut();
                    }}
                  >
                    Sign out
                  </button>
                  <button
                    type="button"
                    className="user-menu-item user-menu-danger"
                    onClick={() => setConfirmingDelete(true)}
                  >
                    Delete account
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        {state.notice !== undefined && (
          <p role="alert" className="user-notice">
            {state.notice}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="user-control" ref={controlRef}>
      <div className="user-signed-out">
        <LegalLine />
        <button ref={signInRef} type="button" className="user-sign-in" onClick={onSignIn}>
          Sign in
        </button>
      </div>
      {state.notice !== undefined && (
        <p role="alert" className="user-notice">
          {state.notice}
        </p>
      )}
    </div>
  );
}
