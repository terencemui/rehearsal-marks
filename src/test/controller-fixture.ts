import { vi } from 'vitest';
import type { AudioController, LoadOptions, PlaybackState } from '../audio';

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
 *
 * A load the caller supplies still publishes the duration it resolves with,
 * because the real one does: the media element's metadata is what the store's
 * duration becomes, and a mock that kept its default 10 while reporting 372
 * would clamp every seek past ten seconds — a seek that lands somewhere else
 * than the test asked for is the one way this double lies quietly.
 */
export function mockController(overrides: Partial<AudioController> = {}): MockController {
  let state: PlaybackState = { playing: false, currentTime: 0, duration: 10, volume: 1 };
  const listeners = new Set<(next: PlaybackState) => void>();

  function publish(partial: Partial<PlaybackState>): void {
    state = { ...state, ...partial };
    for (const listener of listeners) listener(state);
  }

  const mock: MockController = {
    load: vi.fn(async () => ({ duration: 10 })),
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

  // Wrapped after the overrides, so a load the caller supplied is wrapped too.
  const callerLoad = mock.load;
  mock.load = vi.fn(async (options: LoadOptions) => {
    const result = await callerLoad(options);
    if (result.duration > 0) publish({ duration: result.duration });
    return result;
  });

  return mock;
}
