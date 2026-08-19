/**
 * Shared ruler rendering — the degraded timeline any playback backend draws
 * when no waveform is available. DOM, not canvas, and backend-agnostic: the
 * caller supplies the duration and a seek callback, and nothing here touches
 * a media element. `onSeek` receives each click-driven seek and returns the
 * position actually applied, so the backend moves its own playhead and the
 * slider value tracks what really happened.
 */

import { rulerTicks } from './ruler';
import './ruler.css';

/**
 * Draws a ruler-only timeline into `container`: labeled tick lines over a
 * clickable surface. A click seeks to the clicked position through `onSeek`,
 * which returns the position the backend actually applied — a media element
 * may clamp the assignment — so the slider value stays honest. A missing or
 * unknown duration renders a single zero tick and ignores clicks. Replaces
 * whatever the container already holds.
 */
export function renderRuler(
  container: HTMLElement,
  duration: number,
  onSeek: (time: number) => number,
): void {
  container.replaceChildren();
  const ruler = document.createElement('div');
  ruler.className = 'rm-ruler';
  ruler.setAttribute('role', 'slider');
  ruler.setAttribute('aria-label', 'Recording timeline');
  ruler.setAttribute('aria-valuemin', '0');
  ruler.setAttribute('aria-valuemax', String(duration));
  ruler.setAttribute('aria-valuenow', '0');

  for (const tick of rulerTicks(duration)) {
    const mark = document.createElement('span');
    mark.className = 'rm-ruler-tick';
    mark.style.left = duration > 0 ? `${(tick.time / duration) * 100}%` : '0%';
    const label = document.createElement('span');
    label.className = 'rm-ruler-tick-label';
    label.textContent = tick.label;
    mark.appendChild(label);
    ruler.appendChild(mark);
  }

  ruler.addEventListener('click', (event) => {
    if (!Number.isFinite(duration) || duration <= 0) return;
    const bounds = ruler.getBoundingClientRect();
    const ratio = (event.clientX - bounds.left) / bounds.width;
    const time = Math.min(1, Math.max(0, ratio)) * duration;
    ruler.setAttribute('aria-valuenow', String(onSeek(time)));
  });

  container.appendChild(ruler);
}
