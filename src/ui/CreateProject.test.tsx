import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CreateProject } from './CreateProject';

function setup(props: Partial<React.ComponentProps<typeof CreateProject>> = {}) {
  const onLink = vi.fn();
  const view = render(<CreateProject onLink={onLink} linkError={null} {...props} />);
  return { onLink, ...view };
}

describe('CreateProject', () => {
  it('offers the YouTube link input on the create surface', () => {
    setup();

    const surface = screen.getByRole('region', { name: 'Create project' });
    expect(surface).toContainElement(screen.getByLabelText(/paste a YouTube link/i));
    expect(surface).toContainElement(screen.getByRole('button', { name: /create from link/i }));
    // The upload picker is gone: the link is the only input on the surface.
    expect(screen.queryByRole('button', { name: 'Create project' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /import/i })).not.toBeInTheDocument();
  });

  it('hands the pasted link to the YouTube pipeline verbatim', async () => {
    const user = userEvent.setup();
    const { onLink } = setup();
    const url = 'https://youtu.be/dQw4w9WgXcQ?t=42';

    await user.type(screen.getByLabelText(/paste a YouTube link/i), url);
    await user.click(screen.getByRole('button', { name: /create from link/i }));

    // Normalization is the domain's job — the field must not pre-chew it.
    expect(onLink).toHaveBeenCalledWith(url);
  });

  it('submits on Enter, so pasting and hitting return works', async () => {
    const user = userEvent.setup();
    const { onLink } = setup();

    await user.type(
      screen.getByLabelText(/paste a YouTube link/i),
      'https://youtu.be/dQw4w9WgXcQ{Enter}',
    );

    expect(onLink).toHaveBeenCalledWith('https://youtu.be/dQw4w9WgXcQ');
  });

  it('keeps the pasted text after a rejection, so the user can fix it', async () => {
    const user = userEvent.setup();
    const { rerender, onLink } = setup();
    const field = screen.getByLabelText(/paste a YouTube link/i);

    await user.type(field, 'https://www.youtube.com/playlist?list=PLx');
    await user.click(screen.getByRole('button', { name: /create from link/i }));

    rerender(<CreateProject onLink={onLink} linkError="That link points at a playlist, not a single video." />);

    expect(field).toHaveValue('https://www.youtube.com/playlist?list=PLx');
    expect(screen.getByRole('alert')).toHaveTextContent(/playlist/);
    expect(field).toHaveAttribute('aria-invalid', 'true');
  });

  it('will not submit an empty or blank field', async () => {
    const user = userEvent.setup();
    const { onLink } = setup();
    const submit = screen.getByRole('button', { name: /create from link/i });

    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText(/paste a YouTube link/i), '   ');

    expect(submit).toBeDisabled();
    expect(onLink).not.toHaveBeenCalled();
  });

  it('shows rejection guidance beside the field as an alert', () => {
    setup({ linkError: 'That link points at a playlist, not a single video.' });

    expect(screen.getByRole('alert')).toHaveTextContent(/playlist/);
    expect(screen.getByLabelText(/paste a YouTube link/i)).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  it('disables the link input and button while any pipeline runs', () => {
    setup({ busy: true });

    expect(screen.getByLabelText(/paste a YouTube link/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: /create from link/i })).toBeDisabled();
  });

  it('reports progress while the link create runs', () => {
    const { rerender } = setup({ busy: true, creatingFromLink: true });

    expect(screen.getByRole('button', { name: 'Creating…' })).toBeInTheDocument();

    rerender(<CreateProject onLink={vi.fn()} linkError={null} busy creatingFromLink={false} />);

    expect(screen.getByRole('button', { name: /create from link/i })).toBeInTheDocument();
  });

  it('retires stale guidance once the rejected text is edited', async () => {
    const user = userEvent.setup();
    const onLinkEdit = vi.fn();
    setup({ linkError: 'That link points at a playlist.', onLinkEdit });

    await user.type(screen.getByLabelText(/paste a YouTube link/i), 'h');

    // The guidance describes what was submitted; the moment that text changes
    // it is describing something no longer on screen.
    expect(onLinkEdit).toHaveBeenCalled();
  });

  it('does not fire the edit callback when there is no guidance to retire', async () => {
    const user = userEvent.setup();
    const onLinkEdit = vi.fn();
    setup({ onLinkEdit });

    await user.type(screen.getByLabelText(/paste a YouTube link/i), 'https://');

    expect(onLinkEdit).not.toHaveBeenCalled();
  });
});
