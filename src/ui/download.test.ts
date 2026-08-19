import { describe, expect, it, vi } from 'vitest';
import { triggerDownload } from './download';

describe('triggerDownload', () => {
  it('clicks a one-shot anchor for the blob URL and revokes it after the fetch has had time to start', () => {
    const createObjectURL = vi.fn(() => 'blob:fake');
    const revokeObjectURL = vi.fn();
    // jsdom implements click() on HTMLElement.prototype — swap it there, and
    // restore the original instead of mockRestore (which would also clear
    // the call history the assertions below read).
    const click = vi.fn();
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const originalClick = HTMLElement.prototype.click;
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
    HTMLElement.prototype.click = click as unknown as typeof HTMLElement.prototype.click;
    vi.useFakeTimers();
    try {
      triggerDownload(new Blob(['x']), 'name.zip');
      // The revoke is deferred so the browser's async fetch can start first.
      expect(revokeObjectURL).not.toHaveBeenCalled();
      vi.runAllTimers();
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      HTMLElement.prototype.click = originalClick;
      vi.useRealTimers();
    }

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake');
  });
});
