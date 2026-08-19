import { render, screen } from '@testing-library/react';
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

  it('explains storage honestly, including the never-leaves-your-browser guarantee', () => {
    render(<HelpTab />);

    const storage = screen.getByRole('heading', { name: 'Storage' }).closest('section')!;
    expect(storage).toHaveTextContent('never leave your browser');
    expect(storage).toHaveTextContent('automatically');
    expect(storage).toHaveTextContent(/export/i);
  });

  it('warns about eviction and how to mitigate it', () => {
    render(<HelpTab />);

    const eviction = screen.getByRole('heading', { name: 'Storage eviction' }).closest('section')!;
    expect(eviction).toHaveTextContent('7');
    expect(eviction).toHaveTextContent('home screen');
    expect(eviction).toHaveTextContent('export');
  });

  it('walks through the label-set contribution workflow as ordered steps', () => {
    render(<HelpTab />);

    const workflow = screen.getByRole('heading', { name: /contribute/i }).closest('section')!;
    const steps = withinOrderedList(workflow);
    expect(steps.length).toBeGreaterThanOrEqual(4);
    expect(steps.map((step) => step.textContent).join('\n')).toMatch(/export/i);
    expect(steps.map((step) => step.textContent).join('\n')).toMatch(/labelsets/i);
    expect(steps.map((step) => step.textContent).join('\n')).toMatch(/pull request/i);
    expect(steps.map((step) => step.textContent).join('\n')).toMatch(/one/i);
  });
});

/** The `<li>` elements of the first ordered list inside a container. */
function withinOrderedList(container: HTMLElement): HTMLElement[] {
  const list = container.querySelector('ol');
  if (list === null) throw new Error('No ordered list found in the section');
  return Array.from(list.querySelectorAll('li'));
}
