import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { UploadPicker } from './UploadPicker';

describe('UploadPicker', () => {
  it('hands the picked file to the upload pipeline', async () => {
    const user = userEvent.setup();
    const onFile = vi.fn();
    const { container } = render(<UploadPicker onFile={onFile} error={null} />);
    const file = new File([new Uint8Array([1])], 'brahms.mp3', { type: 'audio/mpeg' });

    await user.upload(container.querySelector('input[type="file"]')!, file);

    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile.mock.calls[0][0].name).toBe('brahms.mp3');
  });

  it('shows rejection guidance and disables while busy', () => {
    const { rerender } = render(
      <UploadPicker onFile={() => undefined} error="WAV files aren’t supported yet" busy />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/WAV files aren.t supported/);
    expect(screen.getByRole('button')).toBeDisabled();

    rerender(<UploadPicker onFile={() => undefined} error={null} busy={false} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button')).toBeEnabled();
  });
});
