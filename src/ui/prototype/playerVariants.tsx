/**
 * PROTOTYPE — throwaway. Three structurally different takes on the redesigned
 * Player screen, switchable via `?variant=A|B|C` and the floating bar. Each
 * encodes the same redesign decisions:
 *  - a top nav bar with Projects as a nav item (no back arrow) and a
 *    secondary "Suggest edits" button; the project title gets its own band
 *    below the nav, spanning the content width above the video;
 *  - the video at a standard 16:9 ratio, with the whole-video timeline (the
 *    ruler) beneath it — no Play/Pause, no volume slider;
 *  - side margins at option C's size, and nothing makes the page scroll
 *    horizontally on narrow windows;
 *  - the ruler's numbered time ticks are gone;
 *  - readout times show whole seconds only (the marker stores full precision —
 *    this is display-only, the backend is untouched).
 *
 * The three variants differ in how the practice readout (passed/next markers
 * and progress) is arranged beside the video.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { practiceReadout } from '../../domain';
import type { LabeledMarker } from '../../domain';
import type { ProjectRecord } from '../../storage';
import { renderRuler } from '../../playback/renderRuler';
import { MarkerFlags } from '../MarkerFlags';
import type { VariantKey } from './useVariant';
import './playerPrototype.css';

/** Display-only whole-seconds clock — the marker keeps its exact float. */
function formatNoMs(seconds: number, duration: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  return duration >= 3600 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** The passed-slot label: letter plus first alias, the name players call it. */
function passedLabel(marker: LabeledMarker | null): string {
  if (marker === null) return 'Start';
  return marker.aliases.length > 0 ? `${marker.label} — ${marker.aliases[0]}` : marker.label;
}

/** The nav bar: Projects as a nav item on the left, "Suggest edits" on the
 * right. No back arrow, no title — the title has its own band. */
interface NavBarProps {
  onExit(): void;
  onSuggestEdits(): void;
}

function NavBar({ onExit, onSuggestEdits }: NavBarProps) {
  return (
    <nav className="proto-nav">
      <button type="button" className="proto-nav-projects" onClick={onExit}>
        Projects
      </button>
      <button type="button" className="proto-suggest" onClick={onSuggestEdits}>
        Suggest edits
      </button>
    </nav>
  );
}

/** The project title in its own full-width band above the video. */
function PageTitle({ name }: { name: string }) {
  return <h1 className="proto-title">{name}</h1>;
}

/** The video column: just the embed at 16:9 — the timeline is its own strip. */
function Stage({ timelineShell }: { timelineShell: ReactNode }) {
  return <section className="proto-stage">{timelineShell}</section>;
}

/**
 * The full-width timeline strip — the video's clock, lifted out of the video
 * column and drawn at full content width below the split. The playback
 * backend renders its own (hidden) ruler in the embed's shell; this strip
 * re-draws the seek surface and overlays the markers and playhead, so the
 * timeline reads as a separate whole-video strip, not part of the video.
 */
interface FullWidthTimelineProps {
  labeled: LabeledMarker[];
  duration: number;
  currentTime: number;
  onSeekTo(time: number): void;
}

function FullWidthTimeline({ labeled, duration, currentTime, onSeekTo }: FullWidthTimelineProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  // The ruler's click handler is rebuilt only when the duration changes; the
  // latest seek handler is read through a ref so its identity never redraws
  // the ruler mid-playback.
  const seekRef = useRef(onSeekTo);
  useLayoutEffect(() => {
    seekRef.current = onSeekTo;
  });

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    renderRuler(host, duration, (time) => {
      seekRef.current(time);
      return time;
    });
  }, [duration]);

  const playheadPct = duration > 0 ? `${(currentTime / duration) * 100}%` : '0%';

  return (
    <section className="proto-timeline" aria-label="Recording timeline">
      <div ref={hostRef} />
      <MarkerFlags
        markers={labeled}
        duration={duration}
        selectedId={null}
        onFlagClick={(marker) => onSeekTo(marker.time)}
        width={undefined}
      />
      <div className="player-playhead" style={{ left: playheadPct }} aria-hidden="true" />
    </section>
  );
}

interface VariantProps {
  record: ProjectRecord;
  labeled: LabeledMarker[];
  duration: number;
  currentTime: number;
  timelineShell: ReactNode;
  onExit(): void;
  onSuggestEdits(): void;
  onSeekTo(time: number): void;
}

/** A — "Split rail": nav bar, video left with the readout in a right rail. */
function VariantA(props: VariantProps) {
  const { passed, passedTime, next, nextTime, progress } = practiceReadout(
    props.labeled,
    props.currentTime,
    props.duration,
  );
  return (
    <>
      <NavBar onExit={props.onExit} onSuggestEdits={props.onSuggestEdits} />
      <PageTitle name={props.record.name} />
      <div className="proto-root proto-root-a">
        <Stage timelineShell={props.timelineShell} />
        <section className="proto-rail" aria-label="Practice readout">
          <div className="proto-readout-head">
            <span className={passed === null ? 'proto-readout-marker is-placeholder' : 'proto-readout-marker'}>
              {passedLabel(passed)}
            </span>
            <span className={next === null ? 'proto-readout-marker is-placeholder' : 'proto-readout-marker'}>
              {next?.label ?? 'End'}
            </span>
          </div>
          <div
            className="proto-readout-bar"
            role="progressbar"
            aria-label={`Progress to ${next?.label ?? 'End'}`}
            aria-valuemin={0}
            aria-valuemax={1}
            aria-valuenow={progress}
          >
            <div className="proto-readout-fill" style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="proto-readout-times">
            <span>{formatNoMs(passedTime, props.duration)}</span>
            <span>{formatNoMs(nextTime, props.duration)}</span>
          </div>
        </section>
        <FullWidthTimeline
          labeled={props.labeled}
          duration={props.duration}
          currentTime={props.currentTime}
          onSeekTo={props.onSeekTo}
        />
      </div>
    </>
  );
}

/** B — "Floating deck": the video in a floating stage, Now/Next as two cards. */
function VariantB(props: VariantProps) {
  const { passed, passedTime, next, nextTime, progress } = practiceReadout(
    props.labeled,
    props.currentTime,
    props.duration,
  );
  return (
    <>
      <NavBar onExit={props.onExit} onSuggestEdits={props.onSuggestEdits} />
      <PageTitle name={props.record.name} />
      <div className="proto-root proto-root-b">
        <Stage timelineShell={props.timelineShell} />
        <section className="proto-deck-cards" aria-label="Practice readout">
          <div className="proto-card">
            <p className="proto-card-label">Now</p>
            <span className={passed === null ? 'proto-readout-marker is-placeholder' : 'proto-readout-marker'}>
              {passedLabel(passed)}
            </span>
          </div>
          <div className="proto-card">
            <p className="proto-card-label">Next</p>
            <span className={next === null ? 'proto-readout-marker is-placeholder' : 'proto-readout-marker'}>
              {next?.label ?? 'End'}
            </span>
            <div
              className="proto-readout-bar"
              role="progressbar"
              aria-label={`Progress to ${next?.label ?? 'End'}`}
              aria-valuemin={0}
              aria-valuemax={1}
              aria-valuenow={progress}
            >
              <div className="proto-readout-fill" style={{ width: `${progress * 100}%` }} />
            </div>
            <div className="proto-readout-times">
              <span>{formatNoMs(passedTime, props.duration)}</span>
              <span>{formatNoMs(nextTime, props.duration)}</span>
            </div>
          </div>
        </section>
        <FullWidthTimeline
          labeled={props.labeled}
          duration={props.duration}
          currentTime={props.currentTime}
          onSeekTo={props.onSeekTo}
        />
      </div>
    </>
  );
}

/** C — "Metro console": a dense right ticker with huge display type. */
function VariantC(props: VariantProps) {
  const { passed, passedTime, next, nextTime, progress } = practiceReadout(
    props.labeled,
    props.currentTime,
    props.duration,
  );
  return (
    <>
      <NavBar onExit={props.onExit} onSuggestEdits={props.onSuggestEdits} />
      <PageTitle name={props.record.name} />
      <div className="proto-root proto-root-c">
        <Stage timelineShell={props.timelineShell} />
        <section className="proto-ticker" aria-label="Practice readout">
          <div className="proto-ticker-head">
            <p className="proto-ticker-label">Current marker</p>
            <span className={passed === null ? 'proto-ticker-now is-placeholder' : 'proto-ticker-now'}>
              {passedLabel(passed)}
            </span>
            <p className="proto-ticker-label">Next</p>
            <span className={next === null ? 'proto-ticker-next is-placeholder' : 'proto-ticker-next'}>
              {next?.label ?? 'End'}
            </span>
          </div>
          <div
            className="proto-readout-bar"
            role="progressbar"
            aria-label={`Progress to ${next?.label ?? 'End'}`}
            aria-valuemin={0}
            aria-valuemax={1}
            aria-valuenow={progress}
          >
            <div className="proto-readout-fill" style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="proto-readout-times">
            <span>{formatNoMs(passedTime, props.duration)}</span>
            <span>{formatNoMs(nextTime, props.duration)}</span>
          </div>
        </section>
        <FullWidthTimeline
          labeled={props.labeled}
          duration={props.duration}
          currentTime={props.currentTime}
          onSeekTo={props.onSeekTo}
        />
      </div>
    </>
  );
}

export interface PrototypePlayerProps {
  variant: VariantKey;
  record: ProjectRecord;
  labeled: LabeledMarker[];
  duration: number;
  currentTime: number;
  loadFailed: boolean;
  youtubeUrl: string;
  timelineShell: ReactNode;
  onRetry(): void;
  onExit(): void;
  onSeekTo(time: number): void;
}

/** Switches the three layouts and hosts the states that are real no matter
 * which one wins: the failure card and the Suggest-edits stub note. */
export function PrototypePlayer(props: PrototypePlayerProps) {
  const [showStubNote, setShowStubNote] = useState(false);
  const stubTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function onSuggestEdits(): void {
    setShowStubNote(true);
    if (stubTimer.current !== undefined) clearTimeout(stubTimer.current);
    stubTimer.current = setTimeout(() => setShowStubNote(false), 2600);
  }

  const shared: VariantProps = {
    record: props.record,
    labeled: props.labeled,
    duration: props.duration,
    currentTime: props.currentTime,
    timelineShell: props.timelineShell,
    onExit: props.onExit,
    onSuggestEdits,
    onSeekTo: props.onSeekTo,
  };

  return (
    <main>
      {props.loadFailed && (
        <div role="alert" className="proto-youtube-error">
          <p>
            This YouTube video couldn't be played — it may be private, removed,
            region-blocked, or unavailable for embedding. Your marks are still here.
          </p>
          <a href={props.youtubeUrl} target="_blank" rel="noreferrer">
            {props.youtubeUrl}
          </a>
          <button type="button" onClick={props.onRetry}>
            Retry
          </button>
        </div>
      )}
      {props.variant === 'A' && <VariantA {...shared} />}
      {props.variant === 'B' && <VariantB {...shared} />}
      {props.variant === 'C' && <VariantC {...shared} />}
      {showStubNote && (
        <p className="proto-stub-note" role="status">
          Label editing moves to its own page — not built yet.
        </p>
      )}
    </main>
  );
}
