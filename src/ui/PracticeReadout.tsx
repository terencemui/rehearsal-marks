import type { MouseEvent } from 'react';
import type { LabeledMarker } from '../domain';
import { practiceReadout } from '../domain';
import { formatWholeSeconds } from '../domain/time';

export interface PracticeReadoutProps {
  /** Markers with derived labels, in time order. */
  markers: LabeledMarker[];
  /** The live playhead, seconds. */
  currentTime: number;
  /** The known recording duration, seconds. */
  duration: number;
  /** The progress bar was clicked — jump to the clicked position. */
  onSeek(time: number): void;
}

/** What the passed slot reads before the first mark. */
const START = 'Start';
/** What the next slot reads after the last mark. */
const END = 'End';

/**
 * The practice readout (T27): the right half of a YouTube project's split
 * view, following the live playhead. It names the most recently passed
 * marker — letter and first alias, the name a student actually calls it —
 * with a progress bar toward the next marker, and the timestamps of both
 * anchors under the bar's two ends. Before the first mark the left slot
 * reads Start at 00:00; after the last mark the right slot reads End at
 * the recording's duration, with the bar spanning the last mark to the end.
 *
 * The head is the T36 metro arrangement: the passed marker in large display
 * type on the left, the next marker smaller and right-aligned on the same
 * line — the "Current marker" and "Next" captions above them retired, the
 * positions alone naming the slots. Times read in whole seconds (T35); full
 * precision stays in the marker.
 *
 * The progress bar is a seek surface like the timeline's (T38): a click jumps
 * to the clicked position within the span it draws — from the passed anchor
 * toward the next, so a click near the right end lands just before the next
 * marker, never past it.
 */
export function PracticeReadout({ markers, currentTime, duration, onSeek }: PracticeReadoutProps) {
  const { passed, passedTime, next, nextTime, progress } = practiceReadout(
    markers,
    currentTime,
    duration,
  );

  // The passed slot: the letter plus the first alias, when it has one.
  const passedLabel =
    passed === null
      ? START
      : passed.aliases.length > 0
        ? `${passed.label} — ${passed.aliases[0]}`
        : passed.label;
  const nextLabel = next?.label ?? END;

  /**
   * A bar click: seek to the clicked position within the bar's own span — the
   * run from the passed anchor toward the next. The bar draws progress through
   * exactly this span, so the click maps to a time inside it, clamped like the
   * timeline's. With no recording there is nothing to jump to.
   */
  function handleBarClick(event: MouseEvent<HTMLDivElement>): void {
    if (duration <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const span = nextTime - passedTime;
    onSeek(passedTime + Math.min(1, Math.max(0, ratio)) * span);
  }

  return (
    <section className="player-practice-readout" aria-label="Practice readout">
      <div className="player-practice-head">
        <span
          className={
            passed === null ? 'player-practice-now practice-placeholder' : 'player-practice-now'
          }
        >
          {passedLabel}
        </span>
        <span
          className={
            next === null ? 'player-practice-next practice-placeholder' : 'player-practice-next'
          }
        >
          {nextLabel}
        </span>
      </div>
      <div
        className="player-practice-bar"
        role="slider"
        aria-label={`Progress to ${nextLabel}`}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={progress}
        onClick={handleBarClick}
      >
        <div
          className="player-practice-bar-fill"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      <div className="player-practice-times">
        <span>{formatWholeSeconds(passedTime, duration)}</span>
        <span>{formatWholeSeconds(nextTime, duration)}</span>
      </div>
    </section>
  );
}
