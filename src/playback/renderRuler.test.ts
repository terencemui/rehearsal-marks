import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderRuler } from './renderRuler';

describe('renderRuler', () => {
  let container: HTMLElement;
  const onSeek = vi.fn();

  beforeEach(() => {
    container = document.createElement('div');
    onSeek.mockClear();
  });

  function rulerEl(): HTMLElement {
    return container.querySelector('.rm-ruler') as HTMLElement;
  }

  /** Gives the ruler a fixed 200px box so clicks land at known ratios. */
  function stubBounds() {
    Object.defineProperty(rulerEl(), 'getBoundingClientRect', {
      value: () => ({ left: 0, width: 200, right: 200, top: 0, bottom: 96 }),
    });
  }

  it('draws the slider contract: role, aria attributes, and labeled ticks across the recording', () => {
    renderRuler(container, 50, onSeek);

    const ruler = rulerEl();
    expect(ruler).not.toBeNull();
    expect(ruler.getAttribute('role')).toBe('slider');
    expect(ruler.getAttribute('aria-label')).toBe('Recording timeline');
    expect(ruler.getAttribute('aria-valuemin')).toBe('0');
    expect(ruler.getAttribute('aria-valuemax')).toBe('50');
    expect(ruler.getAttribute('aria-valuenow')).toBe('0');

    // 50s picks a 5s interval: 11 ticks, one every 10% of the width.
    const labels = Array.from(ruler.querySelectorAll('.rm-ruler-tick-label')).map(
      (el) => el.textContent,
    );
    expect(labels).toEqual([
      '0:00', '0:05', '0:10', '0:15', '0:20', '0:25',
      '0:30', '0:35', '0:40', '0:45', '0:50',
    ]);

    const positions = Array.from(ruler.querySelectorAll('.rm-ruler-tick')).map(
      (el) => (el as HTMLElement).style.left,
    );
    expect(positions).toEqual([
      '0%', '10%', '20%', '30%', '40%', '50%',
      '60%', '70%', '80%', '90%', '100%',
    ]);
  });

  it('a click reports the seek at the clicked position and updates the slider value', () => {
    renderRuler(container, 42, onSeek);
    stubBounds();
    onSeek.mockImplementation((time: number) => time);

    rulerEl().dispatchEvent(new MouseEvent('click', { clientX: 50 }));

    expect(onSeek).toHaveBeenCalledWith(10.5);
    expect(rulerEl().getAttribute('aria-valuenow')).toBe('10.5');
  });

  it('a click past the right edge clamps the seek to the recording end', () => {
    renderRuler(container, 42, onSeek);
    stubBounds();
    onSeek.mockImplementation((time: number) => time);

    rulerEl().dispatchEvent(new MouseEvent('click', { clientX: 300 }));

    expect(onSeek).toHaveBeenCalledWith(42);
  });

  it('sets the slider value to the position the backend actually applied', () => {
    renderRuler(container, 42, onSeek);
    stubBounds();
    // The media element may clamp or quantize the assignment — the slider
    // must reflect where the playhead really landed, not the request.
    onSeek.mockReturnValue(10);

    rulerEl().dispatchEvent(new MouseEvent('click', { clientX: 50 }));

    expect(onSeek).toHaveBeenCalledWith(10.5);
    expect(rulerEl().getAttribute('aria-valuenow')).toBe('10');
  });

  it('a click does not seek when the duration is unknown or zero', () => {
    renderRuler(container, 0, onSeek);
    stubBounds();

    rulerEl().dispatchEvent(new MouseEvent('click', { clientX: 50 }));

    expect(onSeek).not.toHaveBeenCalled();
  });

  it('replaces any ruler already in the container', () => {
    renderRuler(container, 50, onSeek);
    renderRuler(container, 60, onSeek);

    expect(container.querySelectorAll('.rm-ruler')).toHaveLength(1);
    expect(rulerEl().getAttribute('aria-valuemax')).toBe('60');
  });
});
