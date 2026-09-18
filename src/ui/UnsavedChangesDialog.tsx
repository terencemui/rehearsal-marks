import { useEffect, useRef } from 'react';
import './unsavedChangesDialog.css';

export interface UnsavedChangesDialogProps {
  /** Leaves, discarding everything not committed. */
  onDiscard: () => void;
  /** Stays on the page, with the work intact. */
  onStay: () => void;
}

/** Everything inside the dialog a Tab can land on, in DOM order. */
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * The one question a page that saves by deliberate commit has to ask before it
 * lets its owner walk away (T60, ADR-0007). It is a prompt and not a warning:
 * the work is still in hand, and the two answers are the two things the owner
 * can actually do with it.
 *
 * `alertdialog` rather than `dialog`, because the question interrupts an
 * action the owner has already taken — they clicked a link — and whoever is
 * listening should hear it without going looking. Focus lands on **Stay**:
 * the safe answer is the one a stray Return key must not undo, and the
 * destructive one keeps its own verb, *Discard*, rather than a bare "OK".
 *
 * There is no third answer. Keeping the work in the browser until next time is
 * what ADR-0006 deleted the browser stores to stop doing, and this page does
 * not bring them back — so what is offered is a real choice between losing the
 * work and staying with it, not a way to have both.
 *
 * It is a modal, where every other confirmation in the app is inline
 * (`.projects-confirm`, `.user-confirm-delete`), because those confirm a row
 * being changed in place and this one confirms leaving the page — there is no
 * row left to answer beside once the answer is *leave*, so the question has to
 * hold the page rather than sit inside it. Holding it is what `aria-modal`
 * claims, and the Tab wrap is what makes the claim true: without it a Return
 * on one of the page's own controls would commit or edit the work while the
 * question about that work was still standing.
 */
export function UnsavedChangesDialog({ onDiscard, onStay }: UnsavedChangesDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // At the document, not the dialog: the trap has to catch a Tab that has
    // already escaped to the page behind, as well as one leaving the last
    // answer. Nothing else is mounted alongside this.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (dialog === null) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => !element.hasAttribute('disabled'),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const outside = active === null || !dialog.contains(active);
      // Only the edges wrap: in the middle the browser's own order is right.
      if (event.shiftKey ? active === first || outside : active === last || outside) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="unsaved-dialog-backdrop">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-changes-question"
        className="unsaved-dialog"
      >
        <p id="unsaved-changes-question" className="unsaved-dialog-question">
          You have unsaved changes to this project’s markings. Leaving now discards them.
        </p>
        <div className="unsaved-dialog-actions">
          <button type="button" className="unsaved-dialog-stay" autoFocus onClick={onStay}>
            Stay
          </button>
          <button type="button" className="unsaved-dialog-discard" onClick={onDiscard}>
            Discard changes
          </button>
        </div>
      </div>
    </div>
  );
}
