import type { MouseEvent } from 'react';
import type { LabeledMarker, Movement, Naming } from '../domain';
import { markerReading } from '../domain';
import { formatWholeSeconds } from '../domain/time';

/** The lead stretch's identity — the run before the first movement, which no movement names. */
const LEAD_STRETCH_ID = 'lead';

/**
 * One stretch of the recording the strip's name row divides into: a movement's
 * extent, or the lead before the first movement.
 */
interface Stretch {
  /** The movement's id, or `LEAD_STRETCH_ID`. */
  id: string;
  /** What the stretch is named — nothing at all for the lead. */
  name: string;
  /** Seconds the stretch begins at. */
  start: number;
  /** Seconds it runs to — the next movement's start, or the recording's end. */
  end: number;
}

export interface StaveProps {
  /**
   * The marks, already labelled — the same read the markers panel groups, so
   * the strip and the panel draw the same marks in the same order (T80).
   */
  markers: readonly LabeledMarker[];
  /**
   * How the project names its marks (CONTEXT.md) — what a box holds. The
   * reading is the domain's own (`markerReading`), which is the whole of what
   * keeps the strip and the panel from naming one mark two ways.
   */
  naming: Naming;
  /**
   * The mark the playhead has last passed, or null before the first one — the
   * recording's start is not a mark. It is the reading the panel tints its
   * passed row by and the readout fills its passed slot from, so the strip,
   * the panel and the readout agree on where the playhead is.
   */
  passedId: string | null;
  /**
   * The recording's movements (ADR-0005); the stave rules a heavier bar line at
   * each one's start. Empty means a recording with no boundaries, which draws
   * the five hairlines and nothing to divide them.
   */
  movements: readonly Movement[];
  /** The recording's length, in seconds. Every position on the stave is a share of it. */
  duration: number;
  /** The live playhead, in seconds. */
  currentTime: number;
  /** A click anywhere on the stave seeks to that point of the recording. */
  onSeek(time: number): void;
}

/**
 * The practice surface's bottom strip, drawn as the stave (T79) — the timeline
 * the recording's clock has been since T38, in the shape the judged direction
 * gives it: five hairlines ruled across the recording's whole length, a heavier
 * bar line where each movement begins, the project's marks in boxes at the
 * positions they occupy (T80), a pencil rule for the playhead, each movement's
 * name under the stretch it names, and a final barline at the end.
 *
 * It stands in the shared surface's *timeline slot* (`RecordingSurface`), which
 * is the one thing that makes "the player only" true of it: the markings page
 * passes no timeline and keeps the shipped bar, so the authoring surface is not
 * half-restyled under the student (ADR-0007, spec #172).
 *
 * **It carries the marks** (T80), and that is the reversal ADR-0003 recorded:
 * the strip was ruled to carry no marks, and the band above the hairlines —
 * drawn by T79 for the playhead to reach into — is where they go. One box per
 * mark at the position it occupies, holding the name the project reads its
 * marks by, filled once the playhead has gone over it and hollow while it is
 * still ahead. The playhead's height is measured from that band's top edge
 * (see `player.css`), so the pencil crosses the box it is passing and passes
 * it unambiguously.
 *
 * The panel is not replaced by any of this and is not meant to be: it keeps
 * the complete, named, movement-grouped list, and it is where a mark is
 * clicked to be jumped to. The strip's job is the piece's *shape* — which is
 * why its boxes may overlap on a crowded recording rather than being thinned
 * or moved aside, and why they drop altogether on a window too narrow to draw
 * them legibly. Nothing is lost when they do: the list still carries every one.
 *
 * The strip also closes itself with a **final barline** (T80) — a hairline, a
 * breath, then a heavy stroke flush with the right edge — because a stave that
 * simply stops reads as a drawing that was cut off rather than as a recording
 * that has ended.
 *
 * The clock stays: the elapsed time reads under the left end and the total
 * duration under the right, exactly as it did on the bar — the strip is what
 * changed, not what the strip is for.
 *
 * A screen reader loses nothing to the swap, and the slider is *where the bar's
 * was*: on the stave's own band, with the clock and the movement names beside it
 * rather than inside it. That is not fastidiousness — a slider's children are
 * presentational, so the strip's duration and its names would be flattened out
 * of the accessibility tree by a slider wrapped around the whole stack, which
 * is exactly the loss the swap is meant not to cost. On the bar the slider was
 * the track and the clock its sibling; this is the same arrangement, so the
 * role, the accessible name and the min/max/now values are read by the same
 * reader in the same place, and the clock is still read as the text it is.
 *
 * The strip is a pointer surface and not a tab stop, exactly as the bar was:
 * a click anywhere on it maps to that fraction of the recording, and no key is
 * added, removed or rebound by this fold.
 */
export function Stave({
  markers,
  naming,
  passedId,
  // Records saved before movements existed (ADR-0005) read the field back as
  // undefined — default it to the empty, ungrouped set the contract describes,
  // as the markers panel does. A recording with no boundaries is the ordinary
  // case for a solo piece: five hairlines and nothing to divide them.
  movements = [],
  duration,
  currentTime,
  onSeek,
}: StaveProps) {
  const elapsed = Math.min(currentTime, duration);
  const played = percentAt(elapsed, duration);
  const stretches = movementStretches(movements, duration);

  /**
   * A click anywhere on the stave seeks to that point of the recording — the
   * same click-to-seek the bar carried, clamped the same way. With no known
   * length there is no position to map a click to.
   */
  function handleSeek(event: MouseEvent<HTMLDivElement>): void {
    if (duration <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    onSeek(Math.min(1, Math.max(0, ratio)) * duration);
  }

  /**
   * A stretch's share of the name row's width — the span it draws, as a share
   * of the recording. The stretches tile the recording from zero, so the shares
   * do the alignment on their own: the boundary between one stretch and the
   * next lands exactly where that movement's bar line is ruled, and the name
   * inside it starts there. Nothing grows or shrinks them, so the row is the
   * recording's own width and no further — a stretch that has collapsed to
   * nothing is a share of nothing, and taking a share of the row for it instead
   * would push every name after it off the strip.
   *
   * Before the recording's length is known there is nothing to divide by —
   * every position on the stave is zero anyway, and every share zero with it —
   * so the names divide the row evenly rather than all collapsing to nothing.
   */
  function share(stretch: Stretch): string {
    if (duration <= 0) return `${100 / stretches.length}%`;
    return `${percentAt(stretch.end, duration) - percentAt(stretch.start, duration)}%`;
  }

  return (
    // The whole strip is the click surface, so a click on a movement's name or
    // on the clock seeks as surely as one on the hairlines does. The slider is
    // the stave's own band rather than this wrapper: see the class comment.
    <div className="player-stave" onClick={handleSeek}>
      {/* The marks, in boxes, at the positions they occupy in the recording —
          centred on their times, so a box names the moment it sits on. */}
      <div className="player-stave-marks">
        {markers.map((marker) => {
          // What the box holds, from the reading the panel's rows and the
          // readout's passed slot are drawn from: the derived label where the
          // project letters or numbers its marks, the owner's own measure
          // where it counts them in bars.
          const reading = markerReading(marker, naming);
          // A mark the owner left unnamed under `measures` has no name to
          // draw, and draws no box — an empty box would be the app saying a
          // mark is called nothing. The panel shows the same blank.
          if (reading.mark === '') return null;
          return (
            <span
              key={marker.id}
              // The one the playhead has gone over is filled; every box still
              // ahead of it is hollow, so "where I am" reads without reading.
              className={`player-stave-box${marker.id === passedId ? ' passed' : ''}`}
              style={{ left: `${percentAt(marker.time, duration)}%` }}
            >
              {reading.mark}
            </span>
          );
        })}
      </div>

      {/* The five hairlines, the movement bar lines and the playhead — and the
          slider the strip exposes, in the same slot the bar's track occupied:
          the clock and the names below stay outside it and stay readable. */}
      <div
        className="player-stave-rules"
        role="slider"
        aria-label="Recording timeline"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={Math.round(elapsed)}
      >
        {[0, 1, 2, 3, 4].map((line) => (
          <span key={line} className="player-stave-line" style={{ top: `${line * 25}%` }} />
        ))}
        {movements.map((movement) => (
          <span
            key={movement.id}
            className="player-stave-bar"
            style={{ left: `${percentAt(movement.start, duration)}%` }}
          />
        ))}
        {/* The final barline: the mark a score closes a piece with, at the
            recording's end rather than at a time — a hairline stroke, a gap,
            then a heavy one, all three drawn by the one rule and its
            `::before` (see `player.css`). Drawn after the hairlines, so its
            heavy stroke covers their ends and the stave reads as closed, and
            before the playhead, which goes over the closed stave. */}
        <span className="player-stave-final-bar" />
        <span className="player-stave-playhead" style={{ left: `${played}%` }} />
      </div>

      {/* Each name takes its movement's share of the width, so it can never
          overlap the name beside it. A share and never a growth: a growing
          item's own size is added to the share it grows into, which would put
          every boundary after the first a padding to the right of the line it
          names. */}
      <div className="player-stave-movements">
        {stretches.map((stretch) => (
          <span
            key={stretch.id}
            className="player-stave-movement"
            style={{ flexBasis: share(stretch) }}
          >
            <span className="player-stave-movement-name">{stretch.name}</span>
          </span>
        ))}
      </div>

      <div className="player-stave-clock">
        <span>{formatWholeSeconds(elapsed, duration)}</span>
        <span>{formatWholeSeconds(duration, duration)}</span>
      </div>
    </div>
  );
}

/**
 * A time's position along the recording, as a percentage of its whole length —
 * and never a position outside the strip. The strip *is* the recording, so
 * there is nothing past either end of it to point at: a boundary authored
 * against a longer read of the recording than the one this render knows (the
 * load failed, and the stored length is the shorter fallback) is drawn at the
 * end rather than off the drawing, and a playhead before zero at the start.
 *
 * The clamp belongs here rather than at each position, because it is the one
 * fact every position shares — and it is what keeps the shares summing to the
 * recording's width, which is the names' alignment.
 */
function percentAt(time: number, duration: number): number {
  if (duration <= 0) return 0;
  return Math.min(100, Math.max(0, (time / duration) * 100));
}

/**
 * The stretches the name row divides into: one per movement, each running to
 * the next movement's start or to the recording's end, plus the stretch before
 * the first movement when the recording begins ahead of it.
 *
 * The lead is included rather than dropped, and that is the whole of what keeps
 * the names on their own bar lines. The list's own grouping drops a lead that
 * holds no marks — a heading over an empty run of a recording is noise *in a
 * list* — but read onto the strip it is a bug: shares of what is left begin at
 * zero, so the first name would start at the strip's left edge, a movement's
 * start to the left of the line it names. The lead is nameless here and draws
 * no heading; it is a share of the width and nothing else.
 *
 * No sort: the set is a recording's boundaries and the domain keeps it in start
 * order (ADR-0005, `addMovement`), which is the same order the panel groups the
 * marks in.
 */
function movementStretches(movements: readonly Movement[], duration: number): Stretch[] {
  const named = movements.map((movement, index) => ({
    id: movement.id,
    name: movement.name,
    start: movement.start,
    end: movements[index + 1]?.start ?? duration,
  }));
  const first = movements[0];
  return first !== undefined && first.start > 0
    ? [{ id: LEAD_STRETCH_ID, name: '', start: 0, end: first.start }, ...named]
    : named;
}
