import { screen, waitFor } from '@testing-library/react';
import { expect } from 'vitest';

/**
 * Waits for the player's load to settle — the `data-settled` marker on its
 * root `<main>`, set on the success and failure paths alike. This is the one
 * sentinel the render helpers wait on (T39): the Play button and the
 * explanatory note they used to wait on are gone with the transport.
 *
 * The player seam and the app seam both render a lone `<main>` while the
 * player is open, so this helper reads whichever one is mounted.
 */
export async function waitForPlayerSettled(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByRole('main').getAttribute('data-settled')).toBe('true');
  });
}
