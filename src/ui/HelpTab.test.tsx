import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { HelpTab } from './HelpTab';

/**
 * The Help tab is a static reference: these tests pin the discoverable homes
 * the ticket promises — keyboard reference, formats and limits, storage,
 * eviction, and the contribution workflow — as facts, not as layout.
 */
describe('HelpTab', () => {
  it('documents the keyboard reference', () => {
    render(<HelpTab />);

    const keyboard = screen.getByRole('heading', { name: 'Keyboard reference' }).closest('section')!;
    expect(keyboard).toHaveTextContent('Space');
    expect(keyboard).toHaveTextContent('Add a marker');
    expect(keyboard).toHaveTextContent('A–Z');
    expect(keyboard).toHaveTextContent('Alt');
    expect(keyboard).toHaveTextContent('Delete');
    expect(keyboard).toHaveTextContent('Esc');
  });

  it('states the accepted formats and their limits', () => {
    render(<HelpTab />);

    const formats = screen.getByRole('heading', { name: /formats/i }).closest('section')!;
    expect(formats).toHaveTextContent('MP3');
    expect(formats).toHaveTextContent('M4A');
    expect(formats).toHaveTextContent('WAV');
    expect(formats).toHaveTextContent('FLAC');
    expect(formats).toHaveTextContent('16');
  });

  it('explains storage honestly, including the stays-in-your-browser guarantee', () => {
    render(<HelpTab />);

    const storage = screen.getByRole('heading', { name: 'Storage' }).closest('section')!;
    expect(storage).toHaveTextContent('stay in your browser');
    expect(storage).toHaveTextContent('automatically');
    expect(storage).toHaveTextContent(/export/i);
  });

  it('keeps the privacy promise honest about YouTube streaming', () => {
    render(<HelpTab />);

    const storage = screen.getByRole('heading', { name: 'Storage' }).closest('section')!;
    // Playback streams from Google; the marks stay in the browser.
    expect(storage).toHaveTextContent(/streams from Google/i);
    expect(storage).toHaveTextContent(/Google never sees them/i);
  });

  it('warns about eviction and how to mitigate it', () => {
    render(<HelpTab />);

    const eviction = screen.getByRole('heading', { name: 'Storage eviction' }).closest('section')!;
    expect(eviction).toHaveTextContent('7');
    expect(eviction).toHaveTextContent('home screen');
    expect(eviction).toHaveTextContent('export');
  });

  it('walks through the in-app contribution flow without any git or GitHub', () => {
    render(<HelpTab />);

    const workflow = screen.getByRole('heading', { name: /contribute/i }).closest('section')!;
    const steps = withinOrderedList(workflow, 0);
    expect(steps.length).toBeGreaterThanOrEqual(4);
    const text = steps.map((step) => step.textContent).join('\n');
    expect(text).toMatch(/sign in/i);
    expect(text).toMatch(/pending/i);
    expect(text).toMatch(/published/i);
    // The in-app flow is the musician's path: no pull requests, no GitHub.
    expect(text).not.toMatch(/pull request/i);
    expect(text).not.toMatch(/github/i);
  });

  it('keeps the Library contribution flow on the repo pull-request path', () => {
    render(<HelpTab />);

    const workflow = screen.getByRole('heading', { name: /contribute/i }).closest('section')!;
    const steps = withinOrderedList(workflow, 1);
    const text = steps.map((step) => step.textContent).join('\n');
    expect(text).toMatch(/export/i);
    expect(text).toMatch(/labelsets/i);
    expect(text).toMatch(/pull request/i);
    expect(text).toMatch(/one file/i);
  });

  it('distinguishes local projects from contributed label sets', () => {
    render(<HelpTab />);

    const storage = screen.getByRole('heading', { name: 'Storage' }).closest('section')!;
    // Local projects never leave the browser — the honest line is not
    // "nothing leaves the app" but "your projects stay; contributions are
    // public by definition".
    expect(storage).toHaveTextContent(/never leave your browser/i);
    expect(storage).toHaveTextContent(/stay in your browser/i);
    // The hosted side is named plainly: public, and attributed to its
    // contributor.
    const contribute = screen.getByRole('heading', { name: /contribute/i }).closest('section')!;
    expect(contribute).toHaveTextContent(/public/i);
    expect(contribute).toHaveTextContent(/attributed/i);
  });

  it('says plainly that a published label set is public and attributable', () => {
    render(<HelpTab />);

    const contribute = screen.getByRole('heading', { name: /contribute/i }).closest('section')!;
    expect(contribute).toHaveTextContent(/public by definition/i);
    expect(contribute).toHaveTextContent(/attributed to you/i);
  });

  it('makes the privacy policy reachable, with the honest line intact', async () => {
    const user = userEvent.setup();
    render(<HelpTab />);

    await user.click(screen.getByRole('button', { name: 'Privacy policy' }));

    const privacy = screen.getByRole('heading', { name: 'Privacy policy' }).closest('section')!;
    expect(privacy).toHaveTextContent(/stay in your browser/i);
    expect(privacy).toHaveTextContent(/streams from Google/i);
    expect(privacy).toHaveTextContent(/public/i);
    expect(privacy).toHaveTextContent(/attributed/i);
    expect(privacy).toHaveTextContent(/Delete account/i);

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
