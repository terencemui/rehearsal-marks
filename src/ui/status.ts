import type { SaveStatus } from '../projects/autosave';

/**
 * The save-state line's wording — the vocabulary shared by the workspace's
 * rename/delete writes and the project page's autosave line. `saved-review`
 * (T52) is a save that returned a public project to the review queue.
 */
export const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: 'Saved',
  dirty: 'Saving…',
  saving: 'Saving…',
  saved: 'Saved',
  'saved-review': 'Saved — back to review',
  error: 'Save failed.',
};

/**
 * The same vocabulary in explicit-save mode (T56, ADR-0007). Only `dirty`
 * differs: nothing writes itself there, so a dirty record is work waiting to be
 * committed rather than work in flight, and "Saving…" would claim a write that
 * is not happening. Every other state is the same fact it is in autosave mode —
 * the commit's own saving, saved, failed and returned-to-review.
 */
export const MANUAL_STATUS_TEXT: Record<SaveStatus, string> = {
  ...STATUS_TEXT,
  dirty: 'Unsaved changes',
};
