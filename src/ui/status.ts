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
