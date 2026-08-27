import { waitFor } from '@testing-library/react';
import { expect } from 'vitest';

/**
 * Waits for the player's load to settle — the `data-settled` marker on the
 * player page's root, set on the success and failure paths alike. This is the
 * one sentinel the render helpers wait on (T39): the Play button and the
 * explanatory note they used to wait on are gone with the transport.
 *
 * The player page is the shell's content now (T45) — a `data-settled` element
 * under the shell's own `<main>` (which carries the persistent navbar), not a
 * lone `<main>` — so the helper reads the marker directly.
 */
export async function waitForPlayerSettled(): Promise<void> {
  await waitFor(() => {
    expect(document.querySelector('[data-settled="true"]')).not.toBeNull();
  });
}
