import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { AudioController } from '../audio';
import { canonicalYouTubeUrl, deriveLabels, markerForLetter, nextMarker, previousMarker } from '../domain';
import type { LabeledMarker } from '../domain';
import type { Autosave, ProjectRecord } from '../storage';
import { renderRuler } from '../playback/renderRuler';
import { MarkerFlags } from './MarkerFlags';
import { PracticeReadout } from './PracticeReadout';
import './player.css';
// The shared page rail (T44) is shell chrome, defined in the shell stylesheet
// — the player renders it, so the player imports it directly rather than
// depending on the shell happening to load it.
import './app.css';

export interface PlayerProps {
  /**
   * The session's autosave — owned by the shell, which flushes it before
   * returning to the Projects screen, so the list never reads stale data.
   */
  autosave: Autosave;
  /** The AudioController seam instance this session runs on. */
  controller: AudioController;
  /** Back to the Projects screen; the shell flushes before unmounting. */
  onExit: () => void;
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
 * The player screen (T39): a playback-only practice surface. Markers are
 * read-only here — the posture toggle, the app's own play/pause and volume
 * transport (the embedded recording supplies its own controls), the Add
 * marker control, the marker inspector, delete-with-undo, and the editing
 * keyboard shortcuts all left, and with them marker selection: a flag click
 * jumps, never selects. The only surviving keys are navigation: Space to
 * play/pause, ←/→ to seek ∓5s, ↑/↓ to walk the marks (wrapping), and A–Z to
 * jump straight to that mark — M is no longer a special case, just another
 * letter. `Alt`+`←` reverts to the browser's Back, an accepted consequence.
 * The one mutation the player makes is stamping the measured duration after
 * load; everything audible goes through the `controller`.
 *
 * The outer chrome is the T37 practice-surface frame: a nav bar carrying only
 * the Projects control — no back arrow, no title, no save status — the project
 * name in its own band above the recording, and the shared page rail (a
 * maximum content width with fluid side margins; the workspace pages now use
 * the same rail, T44) so content is never jammed against the window edge and
 * the page never scrolls sideways when the window narrows.
 *
 * The recording's clock is a single strip below the split (T38), spanning
 * the full content width — a click-to-seek surface with a flag at every
 * marker and a live playhead. Marker positions and the playhead are
 * percentages of the recording, so the strip is always exactly the content
 * width and never scrolls: the fit-to-viewport zoom machinery is gone. The
 * video column keeps only the recording — the audio layer's own ruler band
 * is hidden with CSS — and the strip draws its own seek surface with the
 * shared ruler-drawing module, its numbered ticks hidden. A click on the
 * strip seeks; a flag click jumps to that marker.
 *
 * A settled-state marker on the player's root (`data-settled`) signals that
 * the load has resolved. It means *settled*, not *playable*: it is set on
 * both the success and failure paths, so failure behaviour is keyed off the
 * error card, and shortcuts stay inert until it lands.
 */
export function Player({
  autosave,
  controller,
  onExit,
}: PlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  /** The strip's seek surface — the shared ruler-drawing module draws into it. */
  const surfaceRef = useRef<HTMLDivElement>(null);
  /** The timeline strip itself, whose width drives the flag edge correction. */
  const stripRef = useRef<HTMLDivElement>(null);
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
  const [current, setCurrent] = useState<ProjectRecord>(record);
  // The playback store lives behind the seam; React subscribes to it directly.
  const playback = useSyncExternalStore(controller.subscribe, controller.getPlaybackState);

  const labeled = useMemo(() => deriveLabels(current.markers), [current.markers]);
  const duration = playback.duration > 0 ? playback.duration : current.duration;

  // The strip's measured width, kept solely to drive the flag component's
  // edge-overhang correction — a marker at time zero must not hang off the
  // strip's left edge. jsdom reports no layout (0), so the measurement only
  // lands in a real browser; the guard keeps the flags unshifted in tests.
  const [stripWidth, setStripWidth] = useState<number | undefined>(undefined);

  // One measurement, taken before the first painted frame and kept honest on
  // resize — the only geometry the strip needs.
  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (strip === null) return;
    const measure = () => {
      const width = strip.getBoundingClientRect().width;
      if (width > 0) setStripWidth(width);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    return () => observer.disconnect();
  }, []);

  // The strip's own seek surface — the shared ruler-drawing module draws it
  // once a duration is known. The strip itself stays in the layout whether or
  // not the source can play, so markers remain visible in the failure state.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (surface === null || duration <= 0) return;
    renderRuler(surface, duration, (time) => {
      controller.seek(time);
      // The ruler reports the requested position; the controller clamps it.
      return time;
    });
  }, [controller, duration]);

  /** Applies the player's one mutation: the autosave gets it, React mirrors it. */
  const update = useCallback(
    (fn: (current: ProjectRecord) => ProjectRecord): void => {
      setCurrent(autosave.mutate(fn));
    },
    [autosave],
  );

  /**
   * A flag click: always jump to the marker. Selection ceased to exist with
   * the editing tools, so clicking never selects — there is nothing on this
   * screen to select a marker *for*.
   */
  function handleFlagClick(marker: LabeledMarker): void {
    controller.seek(marker.time);
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
    if (plain && /^[a-z]$/i.test(event.key)) {
      // A–Z jumps straight to that marker — "take it from C" is one keypress.
      // M is no special case: it is just the letter for the marker labelled M.
      const target = markerForLetter(labeled, event.key);
      if (target !== null) {
        event.preventDefault();
        controller.seek(target.time);
      }
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
        // No decode supplies a duration; the record's 0 is a placeholder.
        // The media element's metadata is the recording's true duration —
        // persisting it keeps the project list (T09) and exports honest, so
        // the one write outside the create path earns its place. The epsilon
        // keeps media-element measurement noise from dirtying the record — a
        // no-op rewrite would re-stamp updatedAt and reorder the list for a
        // change no one made.
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

  useEffect(() => {
    // Page teardown: write anything still pending, then release. The shell
    // flushes before returning to the Projects screen, so this is normally a
    // no-op; it is the safety net for a session torn down any other way.
    return () => {
      void autosave.flush().catch(() => {});
      autosave.dispose();
      controller.destroy();
    };
  }, [autosave, controller]);

  // The playhead as a percentage of the recording, pinned to the end so a
  // trailing position can never overflow the strip.
  const playheadPercent =
    duration > 0 ? (Math.min(playback.currentTime, duration) / duration) * 100 : 0;

  // The full-width timeline strip (T38): the recording's clock below the
  // split. It carries its own seek surface (the shared ruler, ticks hidden),
  // the marker flags, and the live playhead. The strip never scrolls — marker
  // positions and the playhead are percentages of the recording — so the only
  // geometry it needs is the measured width that keeps a flag at time zero on
  // screen.
  const timelineStrip = (
    <div ref={stripRef} className="player-timeline-strip">
      <div ref={surfaceRef} className="player-timeline-surface" />
      <MarkerFlags
        markers={labeled}
        duration={duration}
        onFlagClick={handleFlagClick}
        width={stripWidth}
      />
      {/* pointer-events: none — clicks pass through to the seek surface. */}
      <div
        className="player-playhead"
        style={{ left: `${playheadPercent}%` }}
        aria-hidden="true"
      />
    </div>
  );

  return (
    // `data-settled` is the load's settled-state marker — set on the success
    // and failure paths alike, so a render helper waits on it once and the
    // failure behaviour stays keyed off the error card.
    <main data-settled={settled || undefined}>
      {/* T37 frame: the nav carries only the Projects control, the title sits
          in its own band, and the rail wraps the split below. */}
      <nav className="player-nav">
        <div className="page-rail">
          <button type="button" onClick={onExit}>
            Projects
          </button>
        </div>
      </nav>
      <div className="page-rail player-page">
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
            its own ruler band is hidden) with the practice readout beside it,
            and the recording's clock is its own full-width strip below the
            split. Every project is a YouTube project, so the split view is
            unconditional. */}
        <div className="player-practice-split">
          <div className="player-video-column">
            <div ref={containerRef} className="player-ruler" />
          </div>
          <PracticeReadout
            markers={labeled}
            currentTime={playback.currentTime}
            duration={duration}
          />
        </div>
        {timelineStrip}
      </div>
    </main>
  );
}
