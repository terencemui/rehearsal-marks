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
  it('documents what each surface answers to, and which keys belong to which', () => {
    render(<HelpTab />);

    const keyboard = screen.getByRole('heading', { name: 'Keyboard reference' }).closest('section')!;
    // The A–Z letter jump is gone (ADR-0005); navigation is Space, the arrows,
    // and clicks. Labels restart at A within each movement.
    expect(keyboard).not.toHaveTextContent('A–Z');
    expect(keyboard).toHaveTextContent(/restarting at A within each movement/i);
    // The delete-and-deselect keys the playback-only player shed (ADR-0003)
    // were never keys; nothing claims them back.
    expect(keyboard).not.toHaveTextContent('Esc');
    expect(keyboard).not.toHaveTextContent('Delete');

    // Two surfaces play a recording and they are described separately, because
    // they answer to different keys: the practice surface is playback-only and
    // may not author (ADR-0003), while the Markings page adds the two keys that
    // place and correct a marker (ADR-0007). What each table holds, row for
    // row, is pinned against the document and the keyboard elsewhere
    // (keyboardReference.test.tsx); the claim made here is the one this page
    // can make on its own — that each surface is given the keys it has, and
    // that the keys which author are not given to the surface that may not.
    const playbackKeys = ['Space', '← / →', '↑ / ↓'];
    const practice = keyColumn(screen.getByRole('table', { name: 'The practice surface' }));
    const markings = keyColumn(screen.getByRole('table', { name: 'The Markings page' }));
    expect(practice).toEqual(expect.arrayContaining(playbackKeys));
    expect(markings).toEqual(expect.arrayContaining([...playbackKeys, 'M', '[ / ]']));
    expect(practice).not.toContain('M');
    expect(practice).not.toContain('[ / ]');

    // Alt+arrows are the browser's again (ADR-0003); the reference says so
    // rather than leaving the reader to find out by pressing them.
    expect(keyboard).toHaveTextContent(/Alt\+arrows are the browser's again/);
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
    // The panel moves itself now, and a list that moves on its own needs the
    // rule stated — including the brake, which is the surprising half.
    expect(markers).toHaveTextContent(/follows the playhead/i);
    expect(markers).toHaveTextContent(/leaves you alone for a few seconds/i);
  });

  it('says where a student marks a recording', () => {
    render(<HelpTab />);

    const markers = screen.getByRole('heading', { name: /markers/i }).closest('section')!;
    // Where a marker is placed has to be findable from where the markers are
    // read: the page it happens on, the link that opens it, and the key that
    // drops the marker at the playhead.
    expect(markers).toHaveTextContent(/Markings page/);
    expect(markers).toHaveTextContent(/Markings →/);
    // Two ways in, because the link beside the markers is only there once the
    // project has a marker or a movement to show — the row's button is the one
    // that works on a project still to be filled.
    expect(markers).toHaveTextContent(/in your projects list/);
    expect(markers).toHaveTextContent(/press M where a landmark goes by/);
    // And what a marker that landed wrong can do about it — placement is only
    // half the pass (ADR-0007).
    expect(markers).toHaveTextContent(/corrected there too/);
  });

  it('describes server-backed projects honestly', () => {
    render(<HelpTab />);

    const projects = screen.getByRole('heading', { name: 'Projects' }).closest('section')!;
    expect(projects).toHaveTextContent(/live on the server/i);
    expect(projects).toHaveTextContent(/not in this browser/i);
    expect(projects).toHaveTextContent('automatically');
    // Autosave replaced the save button; nothing project-shaped is evictable
    // browser storage anymore. The one exception is named here rather than left
    // to be discovered on a published project's page (T62).
    expect(projects).toHaveTextContent(/no save button/i);
    expect(projects).toHaveTextContent(/already out in the world/i);
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

  it('says what saving means for a project already out in the world', () => {
    render(<HelpTab />);

    const review = screen.getByRole('heading', { name: /public projects/i }).closest('section')!;
    // A save on a published project is the owner's decision, and the reason is
    // the consequence: the review trigger takes it off the gallery (T56,
    // ADR-0007). The page names that before the control; Help says it too.
    expect(review).toHaveTextContent(/Save changes/);
    expect(review).toHaveTextContent(/returns a published project to review/);
    expect(review).toHaveTextContent(/off the public gallery/);
    // The other half of the rule, so the reader can tell which project is
    // which: everything else still writes itself.
    expect(review).toHaveTextContent(/saves itself as you work/);
    // And the exception the owner cannot see from their own side.
    expect(review).toHaveTextContent(/trusted user/);
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

/**
 * The first cell of each row of a keyboard table — the key it names, or the
 * click it describes: the column that says which affordances a surface has,
 * which is what tells the two tables apart.
 */
function keyColumn(table: HTMLElement): string[] {
  return Array.from(table.querySelectorAll('tbody tr')).map(
    (row) => row.querySelector('th, td')?.textContent?.trim() ?? '',
  );
}

/** The `<li>` elements of the nth ordered list inside a container. */
function withinOrderedList(container: HTMLElement, index: number): HTMLElement[] {
  const list = container.querySelectorAll('ol')[index];
  if (list === undefined) throw new Error('No ordered list found in the section');
  return Array.from(list.querySelectorAll('li'));
}
