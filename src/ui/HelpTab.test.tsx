import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { HelpTab } from './HelpTab';

/**
 * The Help tab is a static reference: these tests pin the discoverable homes
 * the ticket promises — keyboard reference, marker limits, server-backed
 * projects, the review flow, and the account rules — as facts, not as layout.
 */
describe('HelpTab', () => {
  it('documents the single-posture keyboard reference', () => {
    render(<HelpTab />);

    const keyboard = screen.getByRole('heading', { name: 'Keyboard reference' }).closest('section')!;
    expect(keyboard).toHaveTextContent('Space');
    expect(keyboard).toHaveTextContent('Seek ∓5 seconds');
    // The A–Z letter jump is gone (ADR-0005); navigation is Space, the arrows,
    // and clicks. Labels restart at A within each movement.
    expect(keyboard).not.toHaveTextContent('A–Z');
    expect(keyboard).toHaveTextContent(/restarting at A within each movement/i);
    // One posture only: the editing rows are gone.
    expect(keyboard).not.toHaveTextContent('Add a marker');
    expect(keyboard).not.toHaveTextContent(/Nudge the selected marker/i);
    expect(keyboard).not.toHaveTextContent('Delete');
    expect(keyboard).not.toHaveTextContent('Esc');
  });

  it('states the marker rules and their limits', () => {
    render(<HelpTab />);

    const markers = screen.getByRole('heading', { name: /markers/i }).closest('section')!;
    expect(markers).toHaveTextContent('16');
    expect(markers).toHaveTextContent('AA');
    // Times read in whole seconds on the readout; the loose-input formats
    // described the inspector that the playback-only player no longer has.
    expect(markers).toHaveTextContent(/whole seconds/i);
    expect(markers).not.toHaveTextContent('5:10.5');
  });

  it('describes server-backed projects honestly', () => {
    render(<HelpTab />);

    const projects = screen.getByRole('heading', { name: 'Projects' }).closest('section')!;
    expect(projects).toHaveTextContent(/live on the server/i);
    expect(projects).toHaveTextContent(/not in this browser/i);
    expect(projects).toHaveTextContent('automatically');
    // Autosave replaced the save button; nothing project-shaped is evictable
    // browser storage anymore.
    expect(projects).toHaveTextContent(/no save button/i);
  });

  it('says reading and playing never need an account; creating and editing do', () => {
    render(<HelpTab />);

    const projects = screen.getByRole('heading', { name: 'Projects' }).closest('section')!;
    expect(projects).toHaveTextContent(/reading and playing never requires an account/i);
    expect(projects).toHaveTextContent(/creating and editing do/i);
    expect(projects).not.toHaveTextContent(/in your browser/i);
  });

  it('keeps the privacy promise honest about YouTube streaming', () => {
    render(<HelpTab />);

    const projects = screen.getByRole('heading', { name: 'Projects' }).closest('section')!;
    // Playback streams from Google; the marks stay on the server, not in
    // Google's hands.
    expect(projects).toHaveTextContent(/streams from Google/i);
    expect(projects).toHaveTextContent(/Google never sees them/i);
  });

  it('walks through the public-project review flow', () => {
    render(<HelpTab />);

    const review = screen.getByRole('heading', { name: /public projects/i }).closest('section')!;
    const steps = withinOrderedList(review, 0);
    expect(steps.length).toBeGreaterThanOrEqual(4);
    const text = steps.map((step) => step.textContent).join('\n');
    expect(text).toMatch(/sign in/i);
    expect(text).toMatch(/pending/i);
    expect(text).toMatch(/published/i);
    // The in-app flow is the musician's path: no pull requests, no GitHub.
    expect(text).not.toMatch(/pull request/i);
    expect(text).not.toMatch(/github/i);
  });

  it('says plainly that a public project is public and attributable', () => {
    render(<HelpTab />);

    const review = screen.getByRole('heading', { name: /public projects/i }).closest('section')!;
    expect(review).toHaveTextContent(/public by definition/i);
    expect(review).toHaveTextContent(/attributed to you/i);
    // Public is the default posture, not a separate contribution step.
    expect(review).toHaveTextContent(/public by default/i);
  });

  it('makes the privacy policy reachable, with the honest line intact', async () => {
    const user = userEvent.setup();
    render(<HelpTab />);

    await user.click(screen.getByRole('button', { name: 'Privacy policy' }));

    const privacy = screen.getByRole('heading', { name: 'Privacy policy' }).closest('section')!;
    expect(privacy).toHaveTextContent(/live on the server/i);
    expect(privacy).toHaveTextContent(/streams from Google/i);
    expect(privacy).toHaveTextContent(/public/i);
    expect(privacy).toHaveTextContent(/attributed to you/i);
    expect(privacy).toHaveTextContent(/Delete account/i);
    expect(privacy).toHaveTextContent(/every project you've created/i);

    // Back to Help restores the reference content.
    await user.click(screen.getByRole('button', { name: /back to help/i }));
    expect(screen.getByRole('heading', { name: 'Help' })).toBeInTheDocument();
  });

  it('makes the terms reachable', async () => {
    const user = userEvent.setup();
    render(<HelpTab />);

    await user.click(screen.getByRole('button', { name: 'Terms' }));

    const terms = screen.getByRole('heading', { name: 'Terms' }).closest('section')!;
    expect(terms).toHaveTextContent(/public/i);
    expect(terms).toHaveTextContent(/as-is/i);
  });

});

/** The `<li>` elements of the nth ordered list inside a container. */
function withinOrderedList(container: HTMLElement, index: number): HTMLElement[] {
  const list = container.querySelectorAll('ol')[index];
  if (list === undefined) throw new Error('No ordered list found in the section');
  return Array.from(list.querySelectorAll('li'));
}
