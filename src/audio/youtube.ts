/**
 * The YouTube playback backend — the AudioController's second target. It owns
 * the IFrame API surface end to end: the API script lifecycle, the embedded
 * player (which stays visible, per the API's terms), playhead polling, the
 * 0–1 → 0–100 volume mapping, and the shared ruler. The IFrame API is
 * referenced nowhere outside this module; its unit tests drive a faked
 * `window.YT`, the same containment the wavesurfer-backed path has.
 */

import { parseYouTubeLink } from '../domain';
import { renderRuler } from '../playback/renderRuler';
import type { LoadResult } from './controller';
import { YouTubePlaybackError } from './errors';
import './youtube.css';

/** The IFrame API's player-state numbers this backend reads. */
const PLAYER_STATE_PLAYING = 1;
const PLAYER_STATE_BUFFERING = 3;

/** How often the playhead is read from the embed — the API clock's granularity. */
const POLL_INTERVAL_MS = 250;

/**
 * How many polls a ready player gets to report its duration. The embed's
 * metadata lands shortly after ready, not at it — this budget (40 × 250ms =
 * ten seconds, the same as the script deadline) lets it arrive while a
 * duration that never does still fails the load honestly.
 */
const METADATA_POLL_LIMIT = 40;

/** How long the API script may take before the load fails honestly. */
const API_SCRIPT_TIMEOUT_MS = 10_000;

/** The IFrame API script; injected once per page. */
const API_SCRIPT_URL = 'https://www.youtube.com/iframe_api';

/** The IFrame API's player surface — the only IFrame API reference in the app. */
interface YouTubePlayer {
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  destroy(): void;
}

/**
 * The event shape the modern widgetapi delivers: every embed event arrives
 * wrapped in `{target, data}` — the raw value the classic builds passed is
 * the `data` field now. Older builds still pass the value bare, so the
 * backend reads either.
 */
interface YouTubeEvent<T> {
  data: T;
}

/**
 * The payload of an embed event, unwrapped: `{data: 1}` becomes `1`, and a
 * bare value passes through — which shape arrives is the widgetapi build's
 * call, not the app's, and both have been observed.
 */
function eventData(payload: unknown): unknown {
  if (payload !== null && typeof payload === 'object' && 'data' in payload) {
    return (payload as YouTubeEvent<unknown>).data;
  }
  return payload;
}

/** The `window.YT` namespace the API script installs. */
interface YouTubeApi {
  Player: new (
    host: HTMLElement,
    options: {
      /** The video id — the embed is built with it, never cued after. */
      videoId: string;
      playerVars?: { origin?: string };
      events: {
        onReady?: () => void;
        onStateChange?: (event: YouTubeEvent<number>) => void;
        onError?: (event: YouTubeEvent<number>) => void;
      };
    },
  ) => YouTubePlayer;
}

declare global {
  interface Window {
    /** The IFrame API surface, set by the injected script. */
    YT?: YouTubeApi;
    /** The API's ready callback; every waiting load chains onto it. */
    onYouTubeIframeAPIReady?: () => void;
  }
}

/** What the backend publishes through the controller's playback store. */
interface YouTubeStateChanges {
  currentTime?: number;
  playing?: boolean;
  duration?: number;
}

export interface YouTubeSourceOptions {
  /** The canonical YouTube URL — the recording identity. */
  url: string;
  /** The store's current volume (0–1), applied once the player is ready. */
  volume: number;
  /** The element the video and ruler render into. */
  container: HTMLElement;
  /**
   * The stored duration — the record's known length. A video that cannot
   * play reports nothing, so its failure state renders the timeline from
   * this instead of a bare zero tick.
   */
  duration: number;
  /** Publishes playback-state changes into the controller's store. */
  onState: (changes: YouTubeStateChanges) => void;
}

/** A live YouTube backend: the controller dispatches onto it and tears it down. */
export interface YouTubeSession {
  /** Settles with the load outcome once the player is ready, errors, or dies. */
  ready: Promise<LoadResult>;
  toggle(): void;
  seek(time: number): void;
  setVolume(volume: number): void;
  getCurrentTime(): number | null;
  destroy(): void;
}

/** Resolves with the API surface, injecting the script the first time. */
function whenApiReady(): Promise<YouTubeApi> {
  if (window.YT !== undefined) return Promise.resolve(window.YT);
  return new Promise((resolve) => {
    if (document.querySelector(`script[src="${API_SCRIPT_URL}"]`) === null) {
      const script = document.createElement('script');
      script.src = API_SCRIPT_URL;
      script.async = true;
      document.head.appendChild(script);
    }
    // Loads may overlap (a reload); each waiting backend keeps its own slot
    // in the callback chain instead of stealing it from the others.
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      // The API assigns window.YT before calling back.
      resolve(window.YT as YouTubeApi);
    };
  });
}

export function loadYouTubeSource({
  url,
  volume,
  container,
  duration: storedDuration,
  onState,
}: YouTubeSourceOptions): YouTubeSession {
  let settled = false;
  let disposed = false;
  /**
   * Set when the load ended in failure: a dead source must not report life,
   * and the API is known to emit state events around error teardown.
   */
  let dead = false;
  let player: YouTubePlayer | null = null;
  let pollId: number | null = null;
  /** The metadata wait's poll, armed when ready reports no duration yet. */
  let durationPollId: number | null = null;
  let settle: (result: LoadResult) => void;
  const ready = new Promise<LoadResult>((resolve) => {
    settle = resolve;
  });
  let apiTimeout: number | null = null;

  /**
   * The duration the failure paths render from: the record's stored length.
   * A dead embed reports no duration of its own, so the timeline and the
   * marks that ride on it keep the last honest number the app has.
   */
  const knownDuration =
    typeof storedDuration === 'number' && Number.isFinite(storedDuration) && storedDuration > 0
      ? storedDuration
      : 0;

  function finish(result: LoadResult): void {
    if (settled) return;
    settled = true;
    if (apiTimeout !== null) window.clearTimeout(apiTimeout);
    if (durationPollId !== null) {
      window.clearInterval(durationPollId);
      durationPollId = null;
    }
    settle(result);
  }

  // The video is the main item; the shared ruler sits below it.
  container.replaceChildren();
  const playerHost = document.createElement('div');
  playerHost.className = 'rm-youtube-player';
  const rulerHost = document.createElement('div');
  rulerHost.className = 'rm-youtube-ruler';
  container.append(playerHost, rulerHost);

  // A load that never settles is a silent failure — the API script not
  // arriving (offline, a blocked origin) surfaces as its own error result.
  apiTimeout = window.setTimeout(() => {
    if (settled) return;
    renderTimeline(knownDuration);
    // The store must agree with the rendered timeline, exactly as onError
    // publishes it — a reader that sees a full ruler and a zero duration
    // would clamp every seek against the wrong length.
    onState({ duration: knownDuration, currentTime: 0, playing: false });
    // The dead script tag is why the API never arrived: drop it so the
    // failure card's Retry re-injects a fresh one instead of waiting on the
    // same corpse for another timeout. A retry that cannot recover is a
    // false promise, and this one — an outage recovered — can.
    document.querySelectorAll(`script[src="${API_SCRIPT_URL}"]`).forEach((tag) => tag.remove());
    dead = true;
    finish({ mode: 'ruler', duration: knownDuration, error: new YouTubePlaybackError(0) });
  }, API_SCRIPT_TIMEOUT_MS);

  /** The shared ruler over the embed, driving seeks straight into it. */
  const renderTimeline = (knownDuration: number) =>
    renderRuler(rulerHost, knownDuration, (time) => {
      seek(time);
      // The API reports the landed position on its own clock — the poll picks
      // it up; the requested (clamped) time is honest until then.
      return time;
    });

  // The video id drives the embed. The API negotiates the player's method
  // surface with the embed, and only once a real video is behind it — a
  // player built empty has no cue or play methods to call, so every load
  // would die on the first one. The canonical URL is the domain's identity;
  // the backend derives the id it embeds. A URL the domain would reject
  // settles here, before any script or embed exists.
  let videoId: string;
  try {
    videoId = parseYouTubeLink(url).videoId;
  } catch {
    renderTimeline(0);
    finish({ mode: 'ruler', duration: 0, error: new YouTubePlaybackError(2) });
    return { ready, toggle, seek, setVolume, getCurrentTime, destroy };
  }

  function seek(time: number): void {
    if (player === null) return;
    // allowSeekAhead=true: exact landings, even beyond the buffered range —
    // a marking tool prefers precision over the API's faster approximation.
    player.seekTo(time, true);
    onState({ currentTime: time });
  }

  function toggle(): void {
    if (player === null) return;
    const state = player.getPlayerState();
    if (state === PLAYER_STATE_PLAYING || state === PLAYER_STATE_BUFFERING) {
      player.pauseVideo();
    } else {
      player.playVideo();
    }
  }

  function setVolume(volume: number): void {
    if (player === null) return;
    // The app's 0–1 slider maps to the API's 0–100 scale (the controller
    // clamps to 0–1 before it gets here).
    player.setVolume(Math.round(volume * 100));
  }

  function getCurrentTime(): number | null {
    if (player === null) return null;
    const time = player.getCurrentTime();
    return typeof time === 'number' && Number.isFinite(time) ? time : null;
  }

  function startPolling(): void {
    if (pollId !== null) return;
    pollId = window.setInterval(() => {
      const time = getCurrentTime();
      if (time !== null) onState({ currentTime: time });
    }, POLL_INTERVAL_MS);
  }

  /** The load's successful settlement, once the duration is known. */
  function settleReady(known: number): void {
    startPolling();
    renderTimeline(known);
    onState({ duration: known, currentTime: 0, playing: false });
    // The store may hold a volume from a previous session; the fresh embed
    // starts at 100 and must be brought to it, like the other backends do.
    setVolume(volume);
    finish({ mode: 'ruler', duration: known });
  }

  function onReady(): void {
    if (disposed || settled || player === null) return;
    const known = player.getDuration();
    if (typeof known === 'number' && Number.isFinite(known) && known > 0) {
      settleReady(known);
      return;
    }
    // The embed's metadata lands shortly after ready, not at it — a cued
    // video reports its duration a beat later. Poll for it, while onError
    // keeps its authority to fail the load first; a duration that never
    // arrives fails honestly instead of hanging the transport.
    let attempts = 0;
    durationPollId = window.setInterval(() => {
      if (player === null || settled) return;
      const duration = player.getDuration();
      if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) {
        settleReady(duration);
        return;
      }
      attempts += 1;
      if (attempts >= METADATA_POLL_LIMIT) {
        // A duration that never arrives is the same failure as onError: the
        // source is dead, and the ruler and the store keep the stored
        // duration so existing marks stay visible.
        dead = true;
        renderTimeline(knownDuration);
        onState({ duration: knownDuration, currentTime: 0, playing: false });
        finish({ mode: 'ruler', duration: knownDuration, error: new YouTubePlaybackError(0) });
      }
    }, POLL_INTERVAL_MS);
  }

  function onStateChange(payload: number | YouTubeEvent<number>): void {
    // A dead source must not report life: a late state event after a failure
    // (the API emits them around error teardown) would flip the store to
    // "playing" over an embed that is not. After a successful ready, state
    // events are the session's own clock and flow through.
    if (disposed || dead) return;
    onState({ playing: eventData(payload) === PLAYER_STATE_PLAYING });
  }

  function onError(payload: number | YouTubeEvent<number>): void {
    if (disposed || settled) return;
    const code = eventData(payload);
    // The embed is dead: no later state event may report it as playing, and
    // the ruler and the store keep the stored duration — the last honest
    // number the app has — so existing marks stay visible.
    dead = true;
    renderTimeline(knownDuration);
    onState({ duration: knownDuration, currentTime: 0, playing: false });
    finish({
      mode: 'ruler',
      duration: knownDuration,
      // A payload the unwrap cannot read is still a failure — its code is
      // just unknown, like the API script that never arrived.
      error: new YouTubePlaybackError(typeof code === 'number' ? code : 0),
    });
  }

  function destroy(): void {
    disposed = true;
    if (apiTimeout !== null) window.clearTimeout(apiTimeout);
    if (durationPollId !== null) {
      window.clearInterval(durationPollId);
      durationPollId = null;
    }
    if (pollId !== null) {
      window.clearInterval(pollId);
      pollId = null;
    }
    if (player !== null) {
      player.destroy();
      player = null;
    }
    // A destroyed load has no outcome to report — `ready` simply never
    // settles, and the disposed guards keep a late API from creating one.
  }

  void whenApiReady().then((api) => {
    if (disposed || settled) return;
    // The API arrived — the timeout's only job. From here the API's own
    // events (onReady, onError) settle the load, however long they take.
    if (apiTimeout !== null) window.clearTimeout(apiTimeout);
    player = new api.Player(playerHost, {
      videoId,
      playerVars: { origin: window.location.origin },
      events: { onReady, onStateChange, onError },
    });
    // Constructed with the video id, not cued after: the API negotiates the
    // player's method surface with the embed, and a player built empty has
    // no cue or play methods to call. Construction cues it — playback still
    // waits for the user's gesture, as browsers and the API require.
  });

  return {
    ready,
    toggle,
    seek,
    setVolume,
    getCurrentTime,
    destroy,
  };
}
