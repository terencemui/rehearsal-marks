import type { MouseEvent } from 'react';
import type { LabeledMarker, Naming } from '../domain';
import { markerIdentity, markerName, practiceReadout } from '../domain';
import { formatWholeSeconds } from '../domain/time';

export interface PracticeReadoutProps {
  /** Markers with derived labels, in time order. */
  markers: LabeledMarker[];
  /**
   * How the project names its marks (T72). The readout must name the mark —
   * there is a slot and a reader waiting — so where the display reading is
   * blank (an unnamed mark under `measures`), the label stands in.
   */
  naming: Naming;
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
 * The name it reads is the project's own (T72): `label — alias` where the
 * derived label names the marks, the alias alone where the project is kept by
 * measure — and the label stands in for a mark the owner has not yet named, so
 * the slot is never blank.
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
export function PracticeReadout({
  markers,
  naming,
  currentTime,
  duration,
  onSeek,
}: PracticeReadoutProps) {
  const { passed, passedTime, next, nextTime, progress } = practiceReadout(
    markers,
    currentTime,
    duration,
  );

  // The passed slot: the project's own name for the mark (T72) — `label — alias`
  // where the derived label names the marks, the alias alone under `measures` —
  // with the label standing in where that name would be blank, so an unnamed
  // `measures` mark still says which mark the playhead has reached.
  const passedLabel =
    passed === null ? START : markerName(passed, naming) || markerIdentity(passed, naming);
  // The next slot stays bare: it is the mark being headed for, not the one the
  // playhead is on, and the alias belongs to the mark you have reached.
  const nextLabel = next === null ? END : markerIdentity(next, naming);

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
