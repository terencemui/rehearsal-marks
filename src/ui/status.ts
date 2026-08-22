import type { SaveStatus } from '../storage';

/**
 * The save-state line's wording — one vocabulary for every screen that
 * mutates stored projects: the player's autosave and the Projects screen's
 * rename/delete writes.
 */
export const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: 'Saved',
  dirty: 'Saving…',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Save failed.',
};
