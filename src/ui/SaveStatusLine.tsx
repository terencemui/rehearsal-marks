import { useSyncExternalStore } from 'react';
import type { Autosave } from '../projects/autosave';
import { MANUAL_STATUS_TEXT, STATUS_TEXT } from './status';
import './saveStatusLine.css';

export interface SaveStatusLineProps {
  /** The page's autosave — the line is a live subscription to its state. */
  autosave: Autosave;
}

/**
 * The project page's save-state line (T51): every edit is autosaved, so the
 * line is the only way to know a write is in flight, landed, or failed. The
 * one interactive state is a failed save: the autosave parks in `error` until
 * the next mutation, so the line offers Retry — a flush now — instead of
 * waiting for the user to make another edit.
 *
 * Under a manual autosave (T56) the line says the same things about the same
 * states, but a dirty record reads as unsaved work rather than as a write in
 * flight — the mode is the autosave's own, so the line reads it rather than
 * being told.
 */
export function SaveStatusLine({ autosave }: SaveStatusLineProps) {
  const status = useSyncExternalStore(autosave.subscribe, autosave.status);
  const text = autosave.mode === 'manual' ? MANUAL_STATUS_TEXT : STATUS_TEXT;

  if (status === 'error') {
    return (
      <p role="alert" className="save-status save-status-error">
        Save failed.
        <button
          type="button"
          className="save-status-retry"
          // A failed flush rejects; the line is the retry's own surface, and
          // an unhandled rejection would drown the failure it is showing.
          onClick={() => void autosave.flush().catch(() => {})}
        >
          Retry
        </button>
      </p>
    );
  }

  return (
    <p role="status" data-save-status={status} className="save-status">
      {text[status]}
    </p>
  );
}
