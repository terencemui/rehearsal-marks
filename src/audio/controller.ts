/**
 * The AudioController seam — every bit of audio I/O in the app passes through
 * this interface: peak extraction, playback, and waveform rendering. The
 * production implementation wraps wavesurfer (referenced nowhere outside this
 * module, so it stays swappable); component tests consume mocks instead.
 */

import WaveSurfer from 'wavesurfer.js';
import { extractPeaks, type PeakData } from './peaks';
import { rulerTicks } from './ruler';
import './ruler.css';

/** How the loaded recording is rendered. */
export type RenderMode = 'waveform' | 'ruler';

/** The outcome of `load`: how the view rendered, and the known duration. */
export interface LoadResult {
  mode: RenderMode;
  /** Seconds. The decode pass's duration in waveform mode; the media element's in ruler mode. */
  duration: number;
}

export interface LoadOptions {
  blob: Blob;
  /** The element the waveform (or ruler) renders into. */
  container: HTMLElement;
  /** Decoded peaks; `null` means the decode failed — render a ruler-only timeline. */
  peaks: PeakData | null;
}

export interface AudioController {
  /** One full decode pass → bucketed peaks. Rejects with `DecodeError`. */
  extractPeaks(blob: Blob): Promise<PeakData>;
  /**
   * Streams the recording into `container` and renders the waveform from the
   * pre-decoded peaks, or a ruler-only timeline when peaks are unavailable.
   * Never decodes: the single decode pass is the caller's `extractPeaks`.
   */
  load(options: LoadOptions): Promise<LoadResult>;
  /** Releases the media element and any rendered view. */
  destroy(): void;
}

/** The wavesurfer-backed production controller. */
export function createAudioController(): AudioController {
  let wavesurfer: WaveSurfer | null = null;
  let audio: HTMLAudioElement | null = null;
  let objectUrl: string | null = null;

  /** Releases everything; safe to call repeatedly and before any load. */
  function teardown(): void {
    if (wavesurfer !== null) {
      wavesurfer.destroy();
      wavesurfer = null;
    }
    if (audio !== null) {
      audio.pause();
      audio.removeAttribute('src');
      audio = null;
    }
    if (objectUrl !== null) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  }

  function loadWaveform(blob: Blob, container: HTMLElement, peaks: PeakData): Promise<LoadResult> {
    container.replaceChildren();
    wavesurfer = WaveSurfer.create({
      container,
      height: 96,
      waveColor: '#94a3b8',
      progressColor: '#0f766e',
      cursorColor: '#0f766e',
      barWidth: 1,
      barGap: 0,
      // Peaks are drawn at their decoded amplitude; no amplification.
      normalize: false,
      interact: true,
    });

    return new Promise<LoadResult>((resolve, reject) => {
      wavesurfer!.once('ready', () => {
        resolve({ mode: 'waveform', duration: peaks.duration });
      });
      wavesurfer!.once('error', reject);
      void wavesurfer!.loadBlob(blob, peaks.peaks, peaks.duration);
    });
  }

  function loadRuler(blob: Blob, container: HTMLElement): Promise<LoadResult> {
    // Ruler-only mode: no wavesurfer, no decode. An HTMLAudioElement streams
    // playback and the container gets a DOM timeline with click-to-seek.
    container.replaceChildren();
    const element = new Audio();
    element.preload = 'metadata';
    objectUrl = URL.createObjectURL(blob);
    element.src = objectUrl;
    audio = element;

    return new Promise<LoadResult>((resolve) => {
      element.addEventListener(
        'loadedmetadata',
        () => {
          renderRuler(container, element, element.duration);
          resolve({ mode: 'ruler', duration: element.duration });
        },
        { once: true },
      );
      // Metadata can fail on garbage input; a zero ruler still renders.
      element.addEventListener(
        'error',
        () => {
          renderRuler(container, element, 0);
          resolve({ mode: 'ruler', duration: 0 });
        },
        { once: true },
      );
    });
  }

  return {
    extractPeaks,

    async load({ blob, container, peaks }) {
      teardown();
      if (peaks !== null) {
        try {
          return await loadWaveform(blob, container, peaks);
        } catch {
          // The media path failed too — fall through to the ruler.
          teardown();
        }
      }
      return await loadRuler(blob, container);
    },

    destroy: teardown,
  };
}

/**
 * Draws a ruler-only timeline: labeled tick lines over a clickable surface
 * that seeks the media element. DOM, not canvas — the ruler is the degraded
 * view, kept deliberately simple.
 */
function renderRuler(container: HTMLElement, element: HTMLAudioElement, duration: number): void {
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
    element.currentTime = Math.min(1, Math.max(0, ratio)) * duration;
    ruler.setAttribute('aria-valuenow', String(element.currentTime));
  });

  container.appendChild(ruler);
}
