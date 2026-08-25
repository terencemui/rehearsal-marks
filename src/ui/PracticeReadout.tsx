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
 * The head is the T36 metro arrangement: the two captions share the first
 * row, the values the second — the passed marker in large display type on
 * the left, the next marker smaller and right-aligned on the same line.
 * Times read in whole seconds (T35); full precision stays in the marker.
 */
export function PracticeReadout({ markers, currentTime, duration }: PracticeReadoutProps) {
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

  return (
    <section className="player-practice-readout" aria-label="Practice readout">
      <div className="player-practice-head">
        <p className="player-practice-label">Current marker</p>
        <span
          className={
            passed === null ? 'player-practice-now practice-placeholder' : 'player-practice-now'
          }
        >
          {passedLabel}
        </span>
        <p className="player-practice-label">Next</p>
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
        role="progressbar"
        aria-label={`Progress to ${nextLabel}`}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={progress}
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
