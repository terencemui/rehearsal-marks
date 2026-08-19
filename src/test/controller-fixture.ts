import { vi } from 'vitest';
import type { AudioController, PeakData, PlaybackState, RenderMode } from '../audio';

/** The mock seam plus a way for tests to publish playback state changes. */
export interface MockController extends AudioController {
  /** Simulates the controller publishing a playback state change. */
  emitPlayback(partial: Partial<PlaybackState>): void;
}

/**
 * Test double for the AudioController seam — the one seam component tests
 * mock. Every method records its calls and succeeds by default; `emitPlayback`
 * lets a test drive the store the way the real controller's media events do.
 * `seek` behaves like the real controller too: it clamps to the known
 * duration and publishes the new playhead — so a test asserting state after
 * a seek is asserting something the mock could falsify, and chained
 * keypresses land where the playhead actually is.
 */
export function mockController(overrides: Partial<AudioController> = {}): MockController {
  let state: PlaybackState = { playing: false, currentTime: 0, duration: 10, volume: 1 };
  const listeners = new Set<(next: PlaybackState) => void>();

  function publish(partial: Partial<PlaybackState>): void {
    state = { ...state, ...partial };
    for (const listener of listeners) listener(state);
  }

  return {
    extractPeaks: vi.fn(async (): Promise<PeakData> => ({ peaks: [[0, 1]], duration: 10 })),
    load: vi.fn(async () => ({ mode: 'waveform' as RenderMode, duration: 10 })),
    destroy: vi.fn(),
    togglePlay: vi.fn(),
    seek: vi.fn((time: number) => {
      let clamped = Math.max(0, time);
      if (state.duration > 0) clamped = Math.min(clamped, state.duration);
      publish({ currentTime: clamped });
    }),
    setVolume: vi.fn(),
    getPlaybackState: () => state,
    getCurrentTime: () => state.currentTime,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emitPlayback: publish,
    ...overrides,
  };
}
