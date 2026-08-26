import type { SaveStatus } from '../storage';

/**
 * The save-state line's wording — the vocabulary for the Projects screen's
 * rename/delete writes. (The player's autosave had its own line until the
 * player shell was stripped down to a single Projects control.)
 */
export const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: 'Saved',
  dirty: 'Saving…',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Save failed.',
};
