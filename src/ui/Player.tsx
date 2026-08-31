import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { MouseEvent } from 'react';
import type { AudioController } from '../audio';
import {
  canonicalYouTubeUrl,
  deriveLabels,
  formatWholeSeconds,
  nextMarker,
  practiceReadout,
  previousMarker,
} from '../domain';
import type { LabeledMarker, Movement } from '../domain';
import type { Autosave } from '../projects/autosave';
import type { ServerProject } from '../projects/types';
import { MarkersPanel } from './MarkersPanel';
import { PracticeReadout } from './PracticeReadout';
import './player.css';

export interface PlayerProps {
  /**
   * The session's autosave — owned by the route that built the session
   * (T45), which flushes it when the player unmounts, so the list never
   * reads stale data.
   */
  autosave: Autosave;
  /** The AudioController seam instance this session runs on. */
  controller: AudioController;
}

/**
 * The error card's explanation — the video is private, removed, region-
 * blocked, embed-disabled, or the API never arrived. The card names the
 * problem, shows the video's URL with an "Open on YouTube" link, and offers
 * a retry, so a temporary outage or a restored video recovers without
 * recreating the project. The marks stay visible on the stored-duration
 * timeline.
 */
const YOUTUBE_FAILED_EXPLANATION =
  'This YouTube video couldn’t be played — it may be private, removed, region-blocked, ' +
  'or unavailable for embedding. Your marks are still here.';

/**
 * The markers list's ceiling: the stylesheet's fixed cap
 * (`.player-marker-list`'s `max-height`), which the measured cap never
 * exceeds, so a stacked viewport with room to spare can't inflate the panel
 * past the design's tallest list.
 */
const MARKERS_STYLESHEET_CAP = 320;

/**
 * The narrowest the stacked list may be. The viewport cap keeps the panel on
 * screen; just under the stacking breakpoint a full-width video fills the
 * fold and leaves little room, and without this floor the panel would
 * collapse to a two-row sliver.
 */
const STACKED_MARKERS_MIN = 120;

/**
 * The player screen (T39): a playback-only practice surface. Markers are
 * read-only here — the posture toggle, the app's own play/pause and volume
 * transport (the embedded recording supplies its own controls), the Add
 * marker control, the marker inspector, delete-with-undo, and the editing
 * keyboard shortcuts all left, and with them marker selection: a marker row
 * click jumps, never selects. The only surviving keys are navigation: Space to
 * play/pause, ←/→ to seek ∓5s, ↑/↓ to walk the marks (wrapping). `Alt`+`←`
 * reverts to the browser's Back, an accepted consequence. The one mutation the
 * player makes is stamping the measured duration after load; everything audible
 * goes through the `controller`.
 *
 * The player page is shell chrome (T45): the persistent navbar and the shared
 * page rail (a maximum content width with fluid side margins) frame it — the
 * player carries no nav of its own (the in-player Projects control and the
 * `onExit` prop it rode on are retired: navigation is the only exit) — and
 * renders the project name in its own band above the recording. The page is
 * the route's content, so no `<main>` and no page rail of its own: the shell's
 * single `<main>` wraps the navbar and the route.
 *
 * The recording's clock is a single filled bar below the split (T38),
 * spanning the full content width — a click-to-seek progress track with the
 * elapsed time under its left end and the total duration under its right. It
 * carries no marks: the flags left the strip for the markers panel, a
 * scrollable list in the side column where each marker is a row — timestamp,
 * then `label — alias` — and the row holding the playhead is highlighted. A
 * click on the bar seeks; a marker row click jumps to that marker. When the
 * recording has movements (ADR-0005) the rows group under sticky movement
 * headers that jump to the movement's start, and the rehearsal letters
 * restart at A within each movement. The video column keeps only the
 * recording (the audio layer's own ruler band is hidden with CSS), and
 * everything is a percentage of the recording, so nothing scrolls: the
 * fit-to-viewport zoom machinery is gone.
 *
 * A settled-state marker on the player's root (`data-settled`) signals that
 * the load has resolved. It means *settled*, not *playable*: it is set on
 * both the success and failure paths, so failure behaviour is keyed off the
 * error card, and shortcuts stay inert until it lands.
 */
export function Player({
  autosave,
  controller,
}: PlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  /** The practice split — the measurement effect observes it for size changes. */
  const splitRef = useRef<HTMLDivElement>(null);
  /**
   * Whether the recording's load has settled — until then the shortcuts are
   * inert, and the ruler has nothing to draw on. Published to the root as
   * `data-settled` so the render helpers wait on one marker.
   */
  const [settled, setSettled] = useState(false);
  /**
   * Whether the load reported that the source cannot play. The audio layer
   * publishes this on `LoadResult.error`; a player that ignored it would show
   * a live-looking surface over a dead embed.
   */
  const [loadFailed, setLoadFailed] = useState(false);
  /** Bumped by the failure card's Retry — re-runs the load effect. */
  const [loadAttempt, setLoadAttempt] = useState(0);
  /**
   * The measured cap on the markers list. In the side-by-side split it keeps
   * the list's bottom within the video's; in the stacked layout (and the
   * failure state) it caps the list to the viewport, so the panel fits on
   * screen and scrolls within it. null is only the pre-measure first paint —
   * the stylesheet's fixed cap holds until the geometry lands.
   */
  const [markersMaxHeight, setMarkersMaxHeight] = useState<number | null>(null);
  // The record's identity — name and recording — never changes in the player.
  const record = autosave.get();
  /**
   * Every project is a YouTube project: the video is the main item in the
   * split's left column, and the recording's clock is its own strip below the
   * split — never zoomed, which would stretch the embed off-screen. The
   * canonical URL derived from the stored video ID is the recording identity
   * the audio layer plays from.
   */
  const youtubeUrl = canonicalYouTubeUrl(record.videoId);
  // The record as React state. The player's only mutation is stamping the
  // measured duration after load; `current` mirrors the autosave so flags,
  // labels, and the strip render from the same record that persists.
  const [current, setCurrent] = useState<ServerProject>(record);
  // The playback store lives behind the seam; React subscribes to it directly.
  const playback = useSyncExternalStore(controller.subscribe, controller.getPlaybackState);

  // Labels derive from the recording's movements (ADR-0005): they restart at A
  // within each movement, so a movement's letters read the same whether the
  // piece is one movement or four.
  const labeled = useMemo(
    () => deriveLabels(current.markers, current.movements),
    [current.markers, current.movements],
  );
  const duration = playback.duration > 0 ? playback.duration : current.duration;

  /** Applies the player's one mutation: the autosave gets it, React mirrors it. */
  const update = useCallback(
    (fn: (current: ServerProject) => ServerProject): void => {
      setCurrent(autosave.mutate(fn));
    },
    [autosave],
  );

  /**
   * A marker row click: always jump to the marker. Selection ceased to exist
   * with the editing tools, so clicking never selects — there is nothing on
   * this screen to select a marker *for*.
   */
  function handleMarkerSeek(marker: LabeledMarker): void {
    controller.seek(marker.time);
  }

  /**
   * A movement header click (ADR-0005): jump to the movement's start. Like a
   * marker row, the header is a navigation surface — it seeks and never
   * selects.
   */
  function handleMovementSeek(movement: Movement): void {
    controller.seek(movement.start);
  }

  /** A track click: seek to the clicked position, clamped to the recording. */
  function handleTrackSeek(event: MouseEvent<HTMLDivElement>): void {
    if (duration <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    controller.seek(Math.min(1, Math.max(0, ratio)) * duration);
  }

  /** A readout bar click: the readout has already resolved the position. */
  function handleReadoutSeek(time: number): void {
    controller.seek(time);
  }

  // The window-level keydown listener is registered once and reads the latest
  // handler through a ref reassigned every render, so shortcuts always see
  // fresh markers and playhead without re-registering per tick.
  const keyDownRef = useRef<(event: KeyboardEvent) => void>(() => {});
  keyDownRef.current = (event: KeyboardEvent) => {
    // One action per press: holding a key repeats the event at the OS repeat
    // rate, which would storm seeks and marker jumps.
    if (event.repeat) return;
    const target = event.target;
    // Shortcuts are suppressed while focus is in a text input. Space gets one
    // extra exception: a focused button owns it through native activation —
    // handling it too would toggle twice. (The player no longer contains a
    // text field, but the guard is cheap, correct, and future-proof.)
    const inTextInput =
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable);

    if (inTextInput) return;
    // Before the recording settles there is nothing to play, seek, or jump to
    // — the shortcuts are inert until then. The load takes a moment; a Space
    // pressed into it would otherwise be swallowed against a dead embed.
    if (!settled) return;

    if (event.key === ' ') {
      // A focused button owns Space through native activation — handling it
      // too would toggle twice. (The player no longer contains a text field,
      // but the guard is cheap, correct, and future-proof.)
      if (target instanceof HTMLElement && target.tagName === 'BUTTON') {
        return;
      }
      event.preventDefault();
      controller.togglePlay();
      return;
    }

    // Arrows are plain chords only: Shift+arrows stay the browser's (scroll,
    // selection), and Alt+arrows do too — the marker nudge is gone, so Alt+←
    // is the browser's Back again, an accepted consequence of playback-only.
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    const plainArrows = plain && !event.shiftKey;
    if (plainArrows && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      // Plain arrows seek ∓5s from the live playhead — the store's value can
      // trail the audible position by a timeupdate interval.
      event.preventDefault();
      controller.seek(controller.getCurrentTime() + (event.key === 'ArrowLeft' ? -5 : 5));
      return;
    }
    if (plainArrows && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      // ↑/↓ jump between markers anchored at the live playhead, wrapping at
      // the ends. Jumping never selects and never touches playback state. A
      // key with nothing to jump to is left alone, so arrow scrolling still
      // works.
      const anchor = controller.getCurrentTime();
      const target =
        event.key === 'ArrowDown' ? nextMarker(labeled, anchor) : previousMarker(labeled, anchor);
      if (target === null) return;
      event.preventDefault();
      controller.seek(target.time);
      return;
    }
  };

  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyDownRef.current(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    let cancelled = false;
    controller
      .load({
        // A project has only its canonical URL to play from — no blob, no
        // peaks — and the audio layer owns everything after that.
        source: 'youtube',
        url: youtubeUrl,
        container,
        // The stored duration is the failure state's timeline: a dead
        // embed reports nothing, so the ruler and the marks that ride on it
        // render from the last honest length the record has.
        duration: autosave.get().duration,
      })
      .then((result) => {
        if (cancelled) return;
        setSettled(true);
        setLoadFailed(result.error !== undefined);
        // No decode supplies a duration; a bare project's 0 is a placeholder.
        // The media element's metadata is the recording's true duration —
        // kept in memory so the ruler and list render honestly. The server
        // never persists it (T51): the save callback skips a write whose
        // persisted fields are unchanged, so this stamp neither demotes a
        // published project through review nor reorders the list. The
        // epsilon keeps media-element measurement noise from dirtying the
        // record for a change no one made.
        if (result.duration > 0 && Math.abs(result.duration - autosave.get().duration) > 0.001) {
          update((current) => ({ ...current, duration: result.duration }));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSettled(true);
          setLoadFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
    // The URL is fixed for the life of a session; `loadAttempt` is the failure
    // card's retry, the one deliberate re-run of the whole load.
  }, [autosave, controller, loadAttempt, update, youtubeUrl]);

  /** The failure card's retry: back to loading, then a fresh load attempt. */
  function retryLoad(): void {
    setSettled(false);
    setLoadFailed(false);
    setLoadAttempt((attempt) => attempt + 1);
  }

  /**
   * The markers list's band: a measured cap so a marker-heavy project scrolls
   * instead of outrunning its container. In the side-by-side split the bound
   * is the video's bottom — the gap between the list's own top and the video's
   * bottom. In the stacked layout the list sits below the video, so the bound
   * is the viewport instead — a panel that fits on screen and scrolls within
   * it rather than growing the page past the fold. Re-run whenever the
   * geometry moves (the video column grows as its embed renders 16:9, the
   * readout grows as passed markers' aliases wrap, the viewport resizes).
   */
  useLayoutEffect(() => {
    const split = splitRef.current;
    if (split === null) return;
    const measure = (): void => {
      const videoColumn = split.querySelector<HTMLElement>('.player-video-column');
      const list = split.querySelector<HTMLElement>('.player-marker-list');
      if (videoColumn === null || list === null) return;
      const videoBottom = videoColumn.getBoundingClientRect().bottom;
      const listTop = list.getBoundingClientRect().top;
      if (listTop >= videoBottom) {
        // No measurable layout yet (jsdom, a detached element): the stylesheet
        // cap owns the first paint.
        if (listTop <= 0) {
          setMarkersMaxHeight(null);
          return;
        }
        // Stacked layout (or no measurable video): the list sits below the
        // video, so there is no video bottom to stay within. Cap it to the
        // viewport instead — a panel that fits on screen and scrolls within
        // it, rather than one that grows the page past the fold. The floor
        // keeps a fold consumed by a full-width video from collapsing it to a
        // sliver; the stylesheet cap stays the ceiling.
        setMarkersMaxHeight(
          Math.min(
            MARKERS_STYLESHEET_CAP,
            Math.max(STACKED_MARKERS_MIN, window.innerHeight - listTop - 8),
          ),
        );
        return;
      }
      // A breath of air between the last row and the video's bottom edge — but
      // never past the stylesheet's ceiling, so a tall video on a wide desktop
      // viewport can't inflate the panel past the design's tallest list.
      setMarkersMaxHeight(
        Math.min(MARKERS_STYLESHEET_CAP, Math.max(0, videoBottom - listTop - 8)),
      );
    };
    measure();
    // The stacked cap reads the viewport's height, which the observed elements
    // don't announce — a viewport resize must re-run the measure too, or a
    // shorter viewport would leave the panel sticking past the new fold.
    const onViewportResize = (): void => measure();
    window.addEventListener('resize', onViewportResize);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      observer.observe(split);
      // The split's height is driven by whichever column is taller, so a column
      // growing beneath the other doesn't move the split — and the measure
      // wouldn't re-run. The video column grows as its embed renders 16:9 (the
      // first paint's fallback cap would otherwise stick); the readout grows as
      // passed markers' aliases wrap. Observe each column that can move under
      // the other.
      const videoColumn = split.querySelector<HTMLElement>('.player-video-column');
      if (videoColumn !== null) observer.observe(videoColumn);
      const readout = split.querySelector<HTMLElement>('.player-practice-readout');
      if (readout !== null) observer.observe(readout);
    }
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', onViewportResize);
    };
  }, []);

  useEffect(() => {
    // Teardown: write anything still pending, then release. This is the
    // safety net for a directly-rendered player — the test seam renders
    // Player without the routed page, so no page teardown runs here. In the
    // app the project page (T45) owns the exit: React cleans up children
    // first, so this net's flush settles the pending write before the page's
    // own flush (which is then a no-op) and the page reports the result.
    return () => {
      void autosave.flush().catch(() => {});
      autosave.dispose();
      controller.destroy();
    };
  }, [autosave, controller]);

  // The playhead as a percentage of the recording, pinned to the end so a
  // trailing position can never overflow the fill.
  const playheadPercent =
    duration > 0 ? (Math.min(playback.currentTime, duration) / duration) * 100 : 0;
  // The elapsed time shown under the bar's left end, clamped to the end.
  const elapsed = Math.min(playback.currentTime, duration);
  // The active marker — the most recently passed marker (none before the first).
  const activeMarker = practiceReadout(labeled, elapsed, duration).passed;

  // The full-width progress clock (T38): the recording's bar below the split —
  // a filled, click-to-seek track with the elapsed time under its left end and
  // the total duration under its right. It carries no marks; the markers panel
  // in the side column is where the marks show.
  const timelineBar = (
    <div className="player-timeline-bar">
      <div
        className="player-timeline-track"
        role="slider"
        aria-label="Recording timeline"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={Math.round(elapsed)}
        onClick={handleTrackSeek}
      >
        <div className="player-timeline-fill" style={{ width: `${playheadPercent}%` }} />
      </div>
      <div className="player-timeline-times">
        <span>{formatWholeSeconds(elapsed, duration)}</span>
        <span>{formatWholeSeconds(duration, duration)}</span>
      </div>
    </div>
  );

  return (
    // `data-settled` is the load's settled-state marker — set on the success
    // and failure paths alike, so a render helper waits on it once and the
    // failure behaviour stays keyed off the error card. The page is shell
    // chrome (T45): the navbar and page rail are the shell's, so the player
    // renders just the title band and the recording under them.
    <div data-settled={settled || undefined}>
      <h1 className="player-title">{record.name}</h1>
      {loadFailed && (
        <div role="alert" className="player-youtube-error">
          <p>{YOUTUBE_FAILED_EXPLANATION}</p>
          <p>
            <a href={youtubeUrl} target="_blank" rel="noreferrer">
              {youtubeUrl}
            </a>
          </p>
          <button type="button" onClick={retryLoad}>
            Retry
          </button>
        </div>
      )}
      {/* T27/T38: the practice split view — the recording fills its column
          (the audio layer loads the embed into the .player-ruler container;
          its own ruler band is hidden) with the practice readout above the
          markers panel beside it, and the recording's clock is its own
          full-width progress bar below the split. Every project is a YouTube
          project, so the split view is unconditional. */}
      <div className="player-practice-split" ref={splitRef}>
        <div className="player-video-column">
          <div ref={containerRef} className="player-ruler" />
        </div>
        <div className="player-side-column">
          <PracticeReadout
            markers={labeled}
            currentTime={playback.currentTime}
            duration={duration}
            onSeek={handleReadoutSeek}
          />
          <MarkersPanel
            markers={labeled}
            movements={current.movements}
            duration={duration}
            activeId={activeMarker?.id ?? null}
            onSeek={handleMarkerSeek}
            onSeekMovement={handleMovementSeek}
            maxHeight={markersMaxHeight ?? undefined}
          />
        </div>
      </div>
      {timelineBar}
    </div>
  );
}
