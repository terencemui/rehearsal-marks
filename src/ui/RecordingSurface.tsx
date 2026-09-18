import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { MouseEvent, ReactNode, RefObject } from 'react';
import type { AudioController } from '../audio';
import { canonicalYouTubeUrl, formatWholeSeconds } from '../domain';
import type { ServerProject } from '../projects/types';
import './player.css';

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

export interface RecordingSurfaceProps {
  /** The session's controller — the playback store and every seek. */
  controller: AudioController;
  /** The session's record: the page's name, its recording, its length. */
  record: ServerProject;
  /** The element the audio layer loads the embed into. */
  videoRef: RefObject<HTMLDivElement | null>;
  /** Whether the load has resolved — the shortcuts and the timeline wait on it. */
  settled: boolean;
  /** Whether the load reported that the recording cannot play. */
  loadFailed: boolean;
  /** The failure card's retry. */
  onRetryLoad(): void;
  /**
   * The side column's content, beside the recording. It is a function of the
   * measured cap on the marker list (`null` before the first measure): the cap
   * is this surface's own reading of the geometry around content it does not
   * own, so the content that scrolls within it is handed the number rather
   * than measuring for itself.
   */
  side: (markersMaxHeight: number | null) => ReactNode;
}

/**
 * The recording surface both player pages are built on (T55): the title band,
 * the recording itself in its column, the side column beside it, and the
 * full-width timeline below — with the embed's load lifecycle and the marker
 * list's measured band owned here, so the practice surface and the markings
 * page render one recording the same way.
 *
 * The one piece of page chrome the surface carries is the title band naming
 * the project; the navbar and the page rail are the shell's (T45). The rail is
 * the player's — a recording is not prose, so the shell widens the page and
 * the 16:9 video takes the width the window leaves it, rather than the text
 * rail's reading measure.
 *
 * The recording's clock is a single filled bar below the split (T38),
 * spanning the full content width — a click-to-seek progress track with the
 * elapsed time under its left end and the total duration under its right. It
 * carries no marks. The video column keeps only the recording (the audio
 * layer's own ruler band is hidden with CSS).
 *
 * A settled-state marker on the root (`data-settled`) signals that the load
 * has resolved. It means *settled*, not *playable*: it is set on both the
 * success and failure paths, so failure behaviour is keyed off the error card,
 * and shortcuts stay inert until it lands.
 */
export function RecordingSurface({
  controller,
  record,
  videoRef,
  settled,
  loadFailed,
  onRetryLoad,
  side,
}: RecordingSurfaceProps) {
  /** The practice split — the measurement effect observes it for size changes. */
  const splitRef = useRef<HTMLDivElement>(null);
  /**
   * The measured cap on the markers list. In the side-by-side split it keeps
   * the list's bottom within the video's; in the stacked layout (and the
   * failure state) it caps the list to the viewport, so the panel fits on
   * screen and scrolls within it. null is only the pre-measure first paint —
   * the stylesheet's fixed cap holds until the geometry lands.
   */
  const [markersMaxHeight, setMarkersMaxHeight] = useState<number | null>(null);
  // The playback store lives behind the seam; the surface subscribes to it directly.
  const playback = useSyncExternalStore(controller.subscribe, controller.getPlaybackState);

  /**
   * Every project is a YouTube project: the canonical URL derived from the
   * stored video ID is the recording identity the audio layer plays from.
   */
  const youtubeUrl = canonicalYouTubeUrl(record.videoId);
  // The media element's measured duration is the honest one; the record's own
  // is the fallback before the load lands and when it fails.
  const duration = playback.duration > 0 ? playback.duration : record.duration;

  /**
   * The markers list's band: a measured cap so a marker-heavy project scrolls
   * instead of outrunning its container. In the side-by-side split the bound
   * is the video's bottom — the gap between the list's own top and the video's
   * bottom. In the stacked layout the list sits below the video, so the bound
   * is the viewport instead — a panel that fits on screen and scrolls within
   * it rather than growing the page past the fold. Re-run whenever the
   * geometry moves (the video column grows as its embed renders 16:9, the
   * side column grows as a passed marker's alias wraps, the viewport resizes).
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
      // first paint's fallback cap would otherwise stick); the practice
      // readout grows as passed markers' aliases wrap. Observe each column
      // that can move under the other; a surface without a readout observes
      // its side column instead.
      const videoColumn = split.querySelector<HTMLElement>('.player-video-column');
      if (videoColumn !== null) observer.observe(videoColumn);
      const sideColumn = split.querySelector<HTMLElement>('.player-side-column');
      if (sideColumn !== null) observer.observe(sideColumn);
    }
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', onViewportResize);
    };
  }, []);

  /** A track click: seek to the clicked position, clamped to the recording. */
  function handleTrackSeek(event: MouseEvent<HTMLDivElement>): void {
    if (duration <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    controller.seek(Math.min(1, Math.max(0, ratio)) * duration);
  }

  // The playhead as a percentage of the recording, pinned to the end so a
  // trailing position can never overflow the fill.
  const playheadPercent =
    duration > 0 ? (Math.min(playback.currentTime, duration) / duration) * 100 : 0;
  // The elapsed time shown under the bar's left end, clamped to the end.
  const elapsed = Math.min(playback.currentTime, duration);

  return (
    // `data-settled` is the load's settled-state marker — set on the success
    // and failure paths alike, so a render helper waits on it once and the
    // failure behaviour stays keyed off the error card. The page is shell
    // chrome (T45): the navbar and page rail are the shell's, so the surface
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
          <button type="button" onClick={onRetryLoad}>
            Retry
          </button>
        </div>
      )}
      {/* T27/T38: the split view — the recording fills its column (the audio
          layer loads the embed into the .player-ruler container; its own ruler
          band is hidden) with the side column beside it, and the recording's
          clock is its own full-width progress bar below the split. */}
      <div className="player-practice-split" ref={splitRef}>
        <div className="player-video-column">
          <div ref={videoRef} className="player-ruler" />
        </div>
        <div className="player-side-column">{side(markersMaxHeight)}</div>
      </div>
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
    </div>
  );
}
