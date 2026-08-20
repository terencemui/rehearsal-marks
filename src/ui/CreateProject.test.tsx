import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CreateProject } from './CreateProject';

function setup(props: Partial<React.ComponentProps<typeof CreateProject>> = {}) {
  const onFile = vi.fn();
  const onLink = vi.fn();
  const view = render(
    <CreateProject
      onFile={onFile}
      onLink={onLink}
      fileError={null}
      linkError={null}
      {...props}
    />,
  );
  return { onFile, onLink, ...view };
}

describe('CreateProject', () => {
  it('offers both inputs on one surface', () => {
    setup();

    const surface = screen.getByRole('region', { name: 'Create project' });
    expect(surface).toContainElement(screen.getByRole('button', { name: 'Create project' }));
    expect(surface).toContainElement(screen.getByLabelText(/paste a YouTube link/i));
  });

  it('hands the picked file to the upload pipeline', async () => {
    const user = userEvent.setup();
    const { onFile, container } = setup();
    const file = new File([new Uint8Array([1])], 'brahms.mp3', { type: 'audio/mpeg' });

    await user.upload(container.querySelector('input[type="file"]')!, file);

    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile.mock.calls[0][0].name).toBe('brahms.mp3');
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

    rerender(
      <CreateProject
        onFile={vi.fn()}
        onLink={onLink}
        fileError={null}
        linkError="That link points at a playlist, not a single video."
      />,
    );

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

  it('keeps each input’s guidance beside its own control', () => {
    setup({ fileError: 'WAV files aren’t supported yet', linkError: null });

    // A file rejection must not surface as a link rejection, or vice versa:
    // they are separate attempts and one must never blank the other.
    expect(screen.getByRole('alert')).toHaveTextContent(/WAV/);
    expect(screen.getByLabelText(/paste a YouTube link/i)).toHaveAttribute(
      'aria-invalid',
      'false',
    );
  });

  it('disables both inputs while any pipeline runs', () => {
    setup({ busy: true });

    expect(screen.getByRole('button', { name: 'Create project' })).toBeDisabled();
    expect(screen.getByLabelText(/paste a YouTube link/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: /create from link/i })).toBeDisabled();
  });

  it('reports progress only on the input whose pipeline is actually running', () => {
    // A disabled control must not narrate someone else's work: during a link
    // create the file button is merely locked, not importing.
    const { rerender } = setup({ busy: true, creatingFromLink: true });

    expect(screen.getByRole('button', { name: 'Creating…' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create project' })).toBeDisabled();

    rerender(
      <CreateProject
        onFile={vi.fn()}
        onLink={vi.fn()}
        fileError={null}
        linkError={null}
        busy
        uploading
      />,
    );

    expect(screen.getByRole('button', { name: 'Importing…' })).toBeDisabled();
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
