import type { SaveStatus } from '../projects/autosave';

/**
 * The save-state line's wording — the vocabulary shared by the workspace's
 * rename/delete writes and the project page's autosave line.
 */
export const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: 'Saved',
  dirty: 'Saving…',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Save failed.',
};
