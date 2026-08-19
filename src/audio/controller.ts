/**
 * The AudioController seam — every bit of audio I/O in the app passes through
 * this interface: peak extraction, playback, and waveform rendering. The
 * production implementation wraps wavesurfer (referenced nowhere outside this
 * module, so it stays swappable); component tests consume mocks instead.
 *
 * Playback always streams through an HTMLAudioElement — wavesurfer's default
 * MediaElement backend — and never decodes a second buffer; the only decode
 * in the app is the one `extractPeaks` pass, whose AudioBuffer is discarded.
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
  /** The cached recording bytes; `null` when streaming from `url`. */
  blob: Blob | null;
  /** The remote recording URL; `null` when playing a local blob. */
  url: string | null;
  /** The element the waveform (or ruler) renders into. */
  container: HTMLElement;
  /** Decoded peaks; `null` means the decode failed — render a ruler-only timeline. */
  peaks: PeakData | null;
}

/**
 * A snapshot of playback: the playhead, the play/pause flag, and the volume.
 * The object identity is stable between changes — the `useSyncExternalStore`
 * contract — so consumers can subscribe and read it directly.
 */
export interface PlaybackState {
  /** Whether the recording is currently audible. */
  playing: boolean;
  /** Playhead position, seconds. */
  currentTime: number;
  /** Known recording duration, seconds; 0 before `load` resolves. */
  duration: number;
  /** Playback volume, 0–1. */
  volume: number;
}

export interface AudioController {
  /** One full decode pass → bucketed peaks. Rejects with `DecodeError`. */
  extractPeaks(blob: Blob): Promise<PeakData>;
  /**
   * Streams the recording into `container` and renders the waveform from the
   * pre-decoded peaks, or a ruler-only timeline when peaks are unavailable.
   * Exactly one of `blob` and `url` is set: a blob plays locally (waveform
   * when peaks exist), a url streams from the network. Never decodes: the
   * single decode pass is the caller's `extractPeaks`.
   */
  load(options: LoadOptions): Promise<LoadResult>;
  /** Toggles between playing and paused. A no-op before `load` resolves. */
  togglePlay(): void;
  /** Moves the playhead to `time` seconds, clamped to the recording. */
  seek(time: number): void;
  /**
   * The live playhead, seconds — fresher than the store, which only updates
   * on media events (timeupdate fires a few times per second). Keyboard
   * navigation anchors here so a jump computes from the audible position,
   * not a value up to one timeupdate interval behind it.
   */
  getCurrentTime(): number;
  /** Sets playback volume, clamped to 0–1. */
  setVolume(volume: number): void;
  /** The current playback state (stable reference — the store contract). */
  getPlaybackState(): PlaybackState;
  /** Subscribes to playback state changes; returns the unsubscribe function. */
  subscribe(listener: (state: PlaybackState) => void): () => void;
  /** Releases the media element and any rendered view. */
  destroy(): void;
}

const INITIAL_PLAYBACK_STATE: PlaybackState = {
  playing: false,
  currentTime: 0,
  duration: 0,
  volume: 1,
};

/**
 * The backend-agnostic playback surface. Each load path hands the controller
 * a target for its backend; the public playback methods dispatch onto it
 * without knowing which backend is active — one switch at load time instead
 * of one per method.
 */
interface PlaybackTarget {
  toggle(): void;
  seek(time: number): void;
  setVolume(volume: number): void;
}

/** The wavesurfer-backed production controller. */
export function createAudioController(): AudioController {
  let wavesurfer: WaveSurfer | null = null;
  let audio: HTMLAudioElement | null = null;
  let objectUrl: string | null = null;
  let target: PlaybackTarget | null = null;
  const listeners = new Set<(state: PlaybackState) => void>();
  let state: PlaybackState = { ...INITIAL_PLAYBACK_STATE };

  /**
   * Publishes changed playback state to subscribers. The snapshot object is
   * replaced, never mutated — listeners and `getPlaybackState` share the same
   * reference, and unchanged emits are dropped so duplicate media events
   * (pause after finish, say) don't re-render consumers.
   */
  function emit(partial: Partial<PlaybackState>): void {
    const next: PlaybackState = { ...state, ...partial };
    if (
      next.playing === state.playing &&
      next.currentTime === state.currentTime &&
      next.duration === state.duration &&
      next.volume === state.volume
    ) {
      return;
    }
    state = next;
    for (const listener of listeners) listener(state);
  }

  /** Resets the playhead after a load: the new duration, position 0, paused. */
  function resetPlayback(duration: number): void {
    emit({ duration, currentTime: 0, playing: false });
  }

  /** Releases everything; safe to call repeatedly and before any load. */
  function teardown(): void {
    if (wavesurfer !== null) {
      wavesurfer.destroy();
      wavesurfer = null;
    }
    if (audio !== null) {
      // Fires a `pause` event, which publishes playing=false — honest state.
      audio.pause();
      audio.removeAttribute('src');
      audio = null;
    }
    if (objectUrl !== null) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
    target = null;
  }

  function loadWaveform(blob: Blob, container: HTMLElement, peaks: PeakData): Promise<LoadResult> {
    container.replaceChildren();
    // No `audioContext` and no `backend: 'WebAudio'` on purpose: the default
    // MediaElement backend streams an HTMLAudioElement and keeps no decoded
    // buffer. WebAudio would decode again and retain the buffer — forbidden.
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
    const ws = wavesurfer;

    // Forward media events into the playback store. Wavesurfer's emissions
    // normally carry the time, but some paths (the WebAudio backend's seek)
    // fire bare events — drop anything that isn't a finite number so the
    // store's `currentTime: number` contract never leaks `undefined`.
    const forwardTime = (currentTime: unknown) => {
      if (typeof currentTime === 'number' && Number.isFinite(currentTime)) {
        emit({ currentTime });
      }
    };
    ws.on('play', () => emit({ playing: true }));
    ws.on('pause', () => emit({ playing: false }));
    ws.on('finish', () => emit({ playing: false }));
    ws.on('timeupdate', forwardTime);
    ws.on('seeking', forwardTime);

    target = {
      toggle: () => void ws.playPause().catch(() => {}),
      seek: (time) => ws.setTime(time),
      setVolume: (volume) => ws.setVolume(volume),
    };

    return new Promise<LoadResult>((resolve, reject) => {
      ws.once('ready', () => {
        ws.setVolume(state.volume);
        resetPlayback(peaks.duration);
        resolve({ mode: 'waveform', duration: peaks.duration });
      });
      ws.once('error', reject);
      void ws.loadBlob(blob, peaks.peaks, peaks.duration);
    });
  }

  function loadRuler(blob: Blob | null, url: string | null, container: HTMLElement): Promise<LoadResult> {
    // Ruler-only mode: no wavesurfer, no decode. An HTMLAudioElement streams
    // playback — from the URL directly when one is given (the library's
    // first load: playback starts before the download finishes), or from a
    // local blob — and the container gets a DOM timeline with click-to-seek.
    container.replaceChildren();
    const element = new Audio();
    element.preload = 'metadata';
    element.volume = state.volume;
    if (url !== null) {
      element.src = url;
    } else {
      objectUrl = URL.createObjectURL(blob as Blob);
      element.src = objectUrl;
    }
    audio = element;

    element.addEventListener('play', () => emit({ playing: true }));
    element.addEventListener('pause', () => emit({ playing: false }));
    element.addEventListener('ended', () => emit({ playing: false }));
    element.addEventListener('timeupdate', () => emit({ currentTime: element.currentTime }));
    element.addEventListener('volumechange', () => emit({ volume: element.volume }));

    target = {
      toggle: () => {
        if (element.paused) {
          void element.play().catch(() => {});
        } else {
          element.pause();
        }
      },
      seek: (time) => {
        element.currentTime = time;
      },
      setVolume: (volume) => {
        element.volume = volume;
      },
    };

    return new Promise<LoadResult>((resolve) => {
      element.addEventListener(
        'loadedmetadata',
        () => {
          renderRuler(container, element, element.duration, (time) => emit({ currentTime: time }));
          resetPlayback(element.duration);
          resolve({ mode: 'ruler', duration: element.duration });
        },
        { once: true },
      );
      // Metadata can fail on garbage input; a zero ruler still renders.
      element.addEventListener(
        'error',
        () => {
          renderRuler(container, element, 0, (time) => emit({ currentTime: time }));
          resetPlayback(0);
          resolve({ mode: 'ruler', duration: 0 });
        },
        { once: true },
      );
    });
  }

  return {
    extractPeaks,

    async load({ blob, url, container, peaks }) {
      teardown();
      // The waveform needs decoded peaks, and peaks exist only after the one
      // decode pass over the full blob — so a URL stream (the library's
      // first load) is always a ruler until its blob lands and a later
      // session opens it from cache.
      if (blob !== null && peaks !== null) {
        try {
          return await loadWaveform(blob, container, peaks);
        } catch {
          // The media path failed too — fall through to the ruler.
          teardown();
        }
      }
      return await loadRuler(blob, url, container);
    },

    togglePlay() {
      target?.toggle();
    },

    seek(time: number) {
      let clamped = Math.max(0, time);
      if (state.duration > 0) clamped = Math.min(clamped, state.duration);
      target?.seek(clamped);
      // Publish immediately — media events may trail the seek by a frame.
      emit({ currentTime: clamped });
    },

    getCurrentTime() {
      if (wavesurfer !== null) {
        const time = wavesurfer.getCurrentTime();
        if (typeof time === 'number' && Number.isFinite(time)) return time;
      }
      if (audio !== null && Number.isFinite(audio.currentTime)) {
        return audio.currentTime;
      }
      return state.currentTime;
    },

    setVolume(volume: number) {
      const clamped = Math.min(1, Math.max(0, volume));
      target?.setVolume(clamped);
      emit({ volume: clamped });
    },

    getPlaybackState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    destroy: teardown,
  };
}

/**
 * Draws a ruler-only timeline: labeled tick lines over a clickable surface
 * that seeks the media element. DOM, not canvas — the ruler is the degraded
 * view, kept deliberately simple. `onSeek` reports each click-driven seek so
 * the playback store can move the playhead immediately.
 */
function renderRuler(
  container: HTMLElement,
  element: HTMLAudioElement,
  duration: number,
  onSeek: (time: number) => void,
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
    element.currentTime = Math.min(1, Math.max(0, ratio)) * duration;
    ruler.setAttribute('aria-valuenow', String(element.currentTime));
    onSeek(element.currentTime);
  });

  container.appendChild(ruler);
}
