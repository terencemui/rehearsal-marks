import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudioController } from './controller';
import type { AudioController } from './controller';
import { YouTubePlaybackError } from './errors';

/**
 * The YouTube backend's tests drive a faked `window.YT` global — the IFrame
 * API surface, faked the way the wavesurfer-backed controller's tests fake
 * wavesurfer: no real iframe loading, no network. The seam stays the
 * controller's public interface: every test loads through `load` and reads
 * the same playback state the player subscribes to.
 */

/** The canonical URL form every YouTube project stores. */
const CANONICAL_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

/** The IFrame API's player-state numbers this backend reads (and the fake emits). */
const PLAYING = 1;
const PAUSED = 2;

interface FakePlayerOptions {
  videoId?: string;
  playerVars?: { origin?: string };
  events: {
    onReady?: () => void;
    /** Either the bare value classic builds pass or the modern `{data}` wrap. */
    onStateChange?: (payload: number | { data: number }) => void;
    onError?: (payload: number | { data: number }) => void;
  };
}

/**
 * A stand-in for the IFrame API's player: records the calls the backend makes
 * on it and lets tests fire the API's events. The constructor appends a real
 * (inert) iframe to the host, mirroring what `YT.Player` does in the browser.
 */
class FakeYouTubePlayer {
  private readonly options: FakePlayerOptions;
  readonly iframe: HTMLIFrameElement;
  /**
   * The video id the backend constructed with. The real API negotiates its
   * method surface with the embed only once a real video is behind the
   * player, so the id must exist at construction — the fake records it so a
   * regression to the cue-after pattern cannot pass silently.
   */
  readonly videoId: string | undefined;
  currentTime = 0;
  duration = 0;
  playerState = -1;

  constructor(host: HTMLElement, options: FakePlayerOptions) {
    this.options = options;
    this.videoId = options.videoId;
    this.iframe = document.createElement('iframe');
    host.appendChild(this.iframe);
    players.push(this);
  }

  getCurrentTime = vi.fn(() => this.currentTime);
  getDuration = vi.fn(() => this.duration);
  getPlayerState = vi.fn(() => this.playerState);
  playVideo = vi.fn(() => {
    this.playerState = PLAYING;
    this.dispatch('onStateChange', PLAYING);
  });
  pauseVideo = vi.fn(() => {
    this.playerState = PAUSED;
    this.dispatch('onStateChange', PAUSED);
  });
  seekTo = vi.fn((time: number) => {
    this.currentTime = time;
  });
  setVolume = vi.fn();
  destroy = vi.fn(() => {
    this.iframe.remove();
  });

  /** Fires one of the API's events, exactly as the browser would. */
  dispatch(
    event: 'onReady' | 'onStateChange' | 'onError',
    arg?: number | { data: number },
  ): void {
    const handler = this.options.events[event] as
      | ((arg?: number | { data: number }) => void)
      | undefined;
    handler?.(arg);
  }
}

const players: FakeYouTubePlayer[] = [];
/** Controllers created by the load helper — destroyed after each test so a
 * running poll interval never outlives its test. */
const created: AudioController[] = [];

beforeEach(() => {
  players.length = 0;
  created.length = 0;
  vi.stubGlobal('YT', { Player: FakeYouTubePlayer });
});

afterEach(() => {
  for (const controller of created) controller.destroy();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Flushes the microtask queue, so the promise chains behind `load` settle. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/** Loads a YouTube source through the public seam; returns the created fake. */
async function loadYouTube(container: HTMLElement, url: string = CANONICAL_URL, duration = 0) {
  const controller = createAudioController();
  created.push(controller);
  const pending = controller.load({ source: 'youtube', url, container, duration });
  await flush();
  const player = players.at(-1)!;
  return { controller, pending, player };
}

/** Brings the player to its ready state at a known duration and settles load. */
async function loadReady(container: HTMLElement, duration = 42) {
  const loaded = await loadYouTube(container);
  loaded.player.duration = duration;
  loaded.player.dispatch('onReady');
  const result = await loaded.pending;
  return { ...loaded, result };
}

describe('AudioController YouTube playback', () => {
  it('loads the URL into an embedded player and renders the shared ruler', async () => {
    const container = document.createElement('div');
    const { result, player } = await loadReady(container);

    expect(result).toEqual({ mode: 'ruler', duration: 42 });
    // The video stays visible inside the container, per the API's terms.
    expect(container.querySelector('.rm-youtube-player iframe')).not.toBeNull();
    // The embed is constructed with the video id from the canonical URL. The
    // API negotiates the player's method surface with the embed only once a
    // real video is behind it, so cueing after construction is not an option
    // the modern API offers.
    expect(player.videoId).toBe('dQw4w9WgXcQ');
    // The shared ruler sits below the video.
    expect(container.querySelector('.rm-youtube-ruler .rm-ruler')).not.toBeNull();
  });

  it('publishes the metadata duration through the playback state', async () => {
    const container = document.createElement('div');
    const { controller } = await loadReady(container);

    expect(controller.getPlaybackState()).toMatchObject({
      duration: 42,
      playing: false,
      currentTime: 0,
    });
  });

  it('togglePlay plays and pauses the embed, tracking state', async () => {
    const container = document.createElement('div');
    const { controller, player } = await loadReady(container);

    controller.togglePlay();
    expect(player.playVideo).toHaveBeenCalledTimes(1);
    expect(controller.getPlaybackState().playing).toBe(true);

    controller.togglePlay();
    expect(player.pauseVideo).toHaveBeenCalledTimes(1);
    expect(controller.getPlaybackState().playing).toBe(false);
  });

  it('treats buffering as active — toggle pauses instead of re-playing', async () => {
    const container = document.createElement('div');
    const { controller, player } = await loadReady(container);

    player.playerState = 3; // buffering
    controller.togglePlay();
    expect(player.pauseVideo).toHaveBeenCalledTimes(1);
    expect(player.playVideo).not.toHaveBeenCalled();
  });

  it('publishes playing from the API state changes, including the end', async () => {
    const container = document.createElement('div');
    const { controller, player } = await loadReady(container);

    player.dispatch('onStateChange', PLAYING);
    expect(controller.getPlaybackState().playing).toBe(true);

    player.dispatch('onStateChange', PAUSED);
    expect(controller.getPlaybackState().playing).toBe(false);

    player.dispatch('onStateChange', 0); // ended
    expect(controller.getPlaybackState().playing).toBe(false);
  });

  it('reads the wrapped state events the modern API delivers', async () => {
    const container = document.createElement('div');
    const { controller, player } = await loadReady(container);

    // The current widgetapi wraps every event as {target, data} — the raw
    // number the classic builds passed is the `data` field now.
    player.dispatch('onStateChange', { data: PLAYING });
    expect(controller.getPlaybackState().playing).toBe(true);

    player.dispatch('onStateChange', { data: PAUSED });
    expect(controller.getPlaybackState().playing).toBe(false);
  });

  it('reads the wrapped error codes the modern API delivers', async () => {
    const container = document.createElement('div');
    const { pending, player } = await loadYouTube(container);

    player.dispatch('onError', { data: 101 });
    const result = await pending;

    expect(result).toMatchObject({ mode: 'ruler', duration: 0 });
    expect(result.error).toBeInstanceOf(YouTubePlaybackError);
    expect(result.error?.code).toBe(101);
  });

  it('seek clamps to the recording and calls seekTo with exact landings', async () => {
    const container = document.createElement('div');
    const { controller, player } = await loadReady(container);

    controller.seek(10);
    expect(player.seekTo).toHaveBeenCalledWith(10, true);
    expect(controller.getPlaybackState().currentTime).toBe(10);

    controller.seek(10_000);
    expect(player.seekTo).toHaveBeenLastCalledWith(42, true);

    controller.seek(-5);
    expect(player.seekTo).toHaveBeenLastCalledWith(0, true);
  });

  it('a ruler click seeks the embed and the playhead', async () => {
    const container = document.createElement('div');
    const { controller, player } = await loadReady(container);
    const ruler = container.querySelector('.rm-ruler') as HTMLElement;
    Object.defineProperty(ruler, 'getBoundingClientRect', {
      value: () => ({ left: 0, width: 200, right: 200, top: 0, bottom: 96 }),
    });

    ruler.dispatchEvent(new MouseEvent('click', { clientX: 100 }));

    expect(player.seekTo).toHaveBeenCalledWith(21, true);
    expect(controller.getPlaybackState().currentTime).toBe(21);
  });

  it('setVolume maps the 0–1 slider to the API 0–100 scale', async () => {
    const container = document.createElement('div');
    const { controller, player } = await loadReady(container);

    controller.setVolume(0.4);
    expect(player.setVolume).toHaveBeenCalledWith(40);
    expect(controller.getPlaybackState().volume).toBe(0.4);

    controller.setVolume(9);
    expect(player.setVolume).toHaveBeenLastCalledWith(100);
  });

  it('applies the stored volume to the fresh embed once it is ready', async () => {
    const container = document.createElement('div');
    const controller = createAudioController();
    created.push(controller);
    controller.setVolume(0.4); // carried over from the user's last session

    const pending = controller.load({ source: 'youtube', url: CANONICAL_URL, container, duration: 0 });
    await flush();
    const player = players.at(-1)!;
    // The embed starts at the API's default; nothing has played to apply it to.
    expect(player.setVolume).not.toHaveBeenCalled();

    player.duration = 42;
    player.dispatch('onReady');
    await pending;

    expect(player.setVolume).toHaveBeenCalledWith(40);
  });

  it('polls the playhead from the embed and publishes time updates', async () => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    const { controller, player } = await loadReady(container);

    player.currentTime = 7.5;
    await vi.advanceTimersByTimeAsync(250);

    expect(controller.getPlaybackState().currentTime).toBe(7.5);
  });

  it('stops polling and destroys the iframe on teardown — safely repeated', async () => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    const { controller, player } = await loadReady(container);

    controller.destroy();
    expect(player.destroy).toHaveBeenCalledTimes(1);
    expect(container.querySelector('iframe')).toBeNull();

    // The poll is dead: a moving embed clock no longer reaches the store.
    const callsAfterDestroy = player.getCurrentTime.mock.calls.length;
    player.currentTime = 99;
    await vi.advanceTimersByTimeAsync(500);
    expect(player.getCurrentTime.mock.calls.length).toBe(callsAfterDestroy);

    // Repeated teardown is a no-op, not a crash.
    expect(() => controller.destroy()).not.toThrow();
  });

  it('reads the live playhead from the embed for keyboard navigation', async () => {
    const container = document.createElement('div');
    const { controller, player } = await loadReady(container);

    player.currentTime = 33.3;
    expect(controller.getCurrentTime()).toBe(33.3);
  });

  it('surfaces an embed error through the load result, with a zero ruler', async () => {
    const container = document.createElement('div');
    const { pending, player } = await loadYouTube(container);

    player.dispatch('onError', 101);
    const result = await pending;

    expect(result).toMatchObject({ mode: 'ruler', duration: 0 });
    expect(result.error).toBeInstanceOf(YouTubePlaybackError);
    expect(result.error?.code).toBe(101);
    // The ruler still renders (a single zero tick) — the timeline survives.
    expect(container.querySelector('.rm-ruler')).not.toBeNull();
  });

  it('renders the ruler from the stored duration when the embed errors — marks stay visible', async () => {
    const container = document.createElement('div');
    // The record's duration: seeded by the community label set or persisted
    // from an earlier load. The dead embed reports nothing, so this is the
    // only honest timeline left.
    const { controller, pending, player } = await loadYouTube(container, CANONICAL_URL, 604.2);

    player.dispatch('onError', 101);
    const result = await pending;

    expect(result).toMatchObject({ mode: 'ruler', duration: 604.2 });
    expect(result.error?.code).toBe(101);
    expect(controller.getPlaybackState().duration).toBe(604.2);
    // A real timeline, not the zero tick: multiple labeled ticks render.
    const ticks = container.querySelectorAll('.rm-ruler-tick');
    expect(ticks.length).toBeGreaterThan(1);
  });

  it('waits for the error when ready reports no playable duration', async () => {
    const container = document.createElement('div');
    const { pending, player } = await loadYouTube(container);
    let outcome: unknown = 'pending';
    void pending.then((result) => {
      outcome = result;
    });

    player.dispatch('onReady'); // duration 0 — metadata still in flight
    await flush();
    expect(outcome).toBe('pending');

    player.dispatch('onError', 100);
    await flush();
    expect(outcome).toMatchObject({ mode: 'ruler', duration: 0 });
    expect((outcome as { error: YouTubePlaybackError }).error.code).toBe(100);
  });

  it('settles once the metadata duration lands after ready had none', async () => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    const { controller, pending, player } = await loadYouTube(container);
    let outcome: unknown = 'pending';
    void pending.then((result) => {
      outcome = result;
    });

    player.dispatch('onReady'); // duration 0 — metadata still in flight
    await flush();
    expect(outcome).toBe('pending');

    player.duration = 42;
    await vi.advanceTimersByTimeAsync(250);

    expect(outcome).toMatchObject({ mode: 'ruler', duration: 42 });
    expect(controller.getPlaybackState().duration).toBe(42);
  });

  it('fails honestly when the metadata duration never arrives after ready', async () => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    const { pending, player } = await loadYouTube(container);

    player.dispatch('onReady'); // duration 0, and it never improves
    await vi.advanceTimersByTimeAsync(10_100);

    const result = await pending;
    expect(result).toMatchObject({ mode: 'ruler', duration: 0 });
    expect(result.error).toBeInstanceOf(YouTubePlaybackError);
    expect(result.error?.code).toBe(0);
  });

  it('rejects a URL the domain would reject, before any embed exists', async () => {
    const container = document.createElement('div');
    const { pending } = await loadYouTube(container, 'not a youtube link');

    const result = await pending;
    expect(result).toMatchObject({ mode: 'ruler', duration: 0 });
    expect(result.error).toBeInstanceOf(YouTubePlaybackError);
    expect(result.error?.code).toBe(2);
    expect(players).toHaveLength(0); // no embed was ever constructed
    expect(container.querySelector('.rm-ruler')).not.toBeNull();
  });

  it('ignores an error that arrives after a successful ready', async () => {
    const container = document.createElement('div');
    const { pending, player, result } = await loadReady(container);

    player.dispatch('onError', 150);
    expect(await pending).toEqual(result);
  });

  it('injects the iframe_api script when the API is absent and loads once it arrives', async () => {
    // This test owns the script lifecycle — no preloaded YT global.
    vi.unstubAllGlobals();
    const container = document.createElement('div');
    const { pending } = await loadYouTube(container);

    expect(
      document.head.querySelector('script[src="https://www.youtube.com/iframe_api"]'),
    ).not.toBeNull();
    expect(players).toHaveLength(0); // nothing to embed until the API lands

    vi.stubGlobal('YT', { Player: FakeYouTubePlayer });
    window.onYouTubeIframeAPIReady?.();
    await flush();
    const player = players.at(-1)!;
    player.duration = 42;
    player.dispatch('onReady');

    expect(await pending).toEqual({ mode: 'ruler', duration: 42 });
  });

  it('surfaces a load failure when the API never arrives', async () => {
    vi.useFakeTimers();
    // No preloaded YT global: the backend waits on the script that never loads.
    vi.unstubAllGlobals();
    const container = document.createElement('div');
    const { pending } = await loadYouTube(container);

    await vi.advanceTimersByTimeAsync(10_000);
    const result = await pending;

    expect(result).toMatchObject({ mode: 'ruler', duration: 0 });
    expect(result.error).toBeInstanceOf(YouTubePlaybackError);
    expect(result.error?.code).toBe(0);
    expect(container.querySelector('.rm-ruler')).not.toBeNull();
  });

  it('a retry after the API timeout re-injects a fresh script instead of waiting on the dead one', async () => {
    vi.useFakeTimers();
    // No preloaded YT global: the backend waits on the script that never loads.
    vi.unstubAllGlobals();
    const container = document.createElement('div');

    // First attempt: the API never arrives; the deadline fires.
    const first = createAudioController();
    created.push(first);
    const firstLoad = first.load({
      source: 'youtube',
      url: CANONICAL_URL,
      container,
      duration: 604.2,
    });
    const injected = document.head.querySelector(
      'script[src="https://www.youtube.com/iframe_api"]',
    );
    expect(injected).not.toBeNull();
    await vi.advanceTimersByTimeAsync(10_000);
    const firstResult = await firstLoad;
    expect(firstResult.error?.code).toBe(0);
    // The timeout publishes the stored duration too — the store and the
    // rendered timeline agree on the recording's length.
    expect(firstResult.duration).toBe(604.2);
    expect(first.getPlaybackState().duration).toBe(604.2);
    // The dead script tag is gone — the corpse was the reason the API never
    // arrived, and Retry must not wait on it for another full deadline.
    expect(
      document.head.querySelector('script[src="https://www.youtube.com/iframe_api"]'),
    ).toBeNull();

    // Retry: a fresh script is injected for the next attempt.
    const second = createAudioController();
    created.push(second);
    const secondLoad = second.load({
      source: 'youtube',
      url: CANONICAL_URL,
      container,
      duration: 604.2,
    });
    await flush();
    const reinjected = document.head.querySelector(
      'script[src="https://www.youtube.com/iframe_api"]',
    );
    expect(reinjected).not.toBeNull();
    expect(reinjected).not.toBe(injected);

    vi.stubGlobal('YT', { Player: FakeYouTubePlayer });
    window.onYouTubeIframeAPIReady?.();
    await flush();
    const player = players.at(-1)!;
    player.duration = 604.2;
    player.dispatch('onReady');

    expect(await secondLoad).toEqual({ mode: 'ruler', duration: 604.2 });
  });

  it('stops the API deadline once the API arrives, however slow the player is', async () => {
    vi.useFakeTimers();
    // No preloaded YT global: the backend waits on the script, which arrives
    // just before the deadline; the player itself then reports ready late.
    vi.unstubAllGlobals();
    const container = document.createElement('div');
    const { pending } = await loadYouTube(container);

    await vi.advanceTimersByTimeAsync(9_000);
    vi.stubGlobal('YT', { Player: FakeYouTubePlayer });
    window.onYouTubeIframeAPIReady?.();
    await flush();
    const player = players.at(-1)!;

    await vi.advanceTimersByTimeAsync(5_000);
    player.duration = 42;
    player.dispatch('onReady');

    expect(await pending).toEqual({ mode: 'ruler', duration: 42 });
  });
});
