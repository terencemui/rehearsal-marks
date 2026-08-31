import { useSyncExternalStore } from 'react';
import type { Autosave } from '../projects/autosave';
import { STATUS_TEXT } from './status';
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
 */
export function SaveStatusLine({ autosave }: SaveStatusLineProps) {
  const status = useSyncExternalStore(autosave.subscribe, autosave.status);

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
      {STATUS_TEXT[status]}
    </p>
  );
}
