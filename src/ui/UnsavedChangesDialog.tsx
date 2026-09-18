import './unsavedChangesDialog.css';

export interface UnsavedChangesDialogProps {
  /** Leaves, discarding everything not committed. */
  onDiscard: () => void;
  /** Stays on the page, with the work intact. */
  onStay: () => void;
}

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
 */
export function UnsavedChangesDialog({ onDiscard, onStay }: UnsavedChangesDialogProps) {
  return (
    <div className="unsaved-dialog-backdrop">
      <div
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
