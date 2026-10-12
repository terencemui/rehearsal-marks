import type { MouseEvent } from 'react';
import { formatWholeSeconds } from '../domain';
import type { LabeledMarker, Movement, Naming } from '../domain';
import { boxText, movementSegments } from './prototypePlayerShared';

export interface PartStaveProps {
  /** The marks, already labelled — the same read the markers panel groups. */
  markers: readonly LabeledMarker[];
  /** The recording's movements; the stave rules a heavier line at each start. */
  movements: readonly Movement[];
  /** How the project names its marks — decides what a box holds. */
  naming: Naming;
  /** The recording's length in seconds. */
  duration: number;
  /** The playhead, in seconds. */
  currentTime: number;
  /** The mark the playhead has last passed, or null before the first one. */
  passedId: string | null;
  /** A click on the stave seeks to that point of the recording. */
  onSeek: (time: number) => void;
}

/**
 * PROTOTYPE — the Part's staff, lifted whole out of `PlayerPartPrototype` so
 * the hybrid can carry it too.
 *
 * This is the one piece of the Part that is *structure*, not style: a stave
 * needs elements at the marks' positions, and no stylesheet can invent them
 * from a flat progress bar. Lifting it is what lets `?variant=hybrid` show
 * today's layout wearing the Part's bottom element without forking the whole
 * player.
 *
 * It reuses `prototypePart.css`'s `.part-staff*` rules unchanged — they are
 * unscoped class rules, and the hybrid direction defines the same tokens on
 * `html`, so the stave paints identically in both directions. That is the
 * point: a piece of a direction transplanted into a rival layout should look
 * like itself, or the comparison is not being made.
 *
 * **It draws the marks on the strip.** Tonight's verdict on the visual
 * direction rejected exactly this, so the hybrid carrying it is a deliberate
 * reversal being *tried*, not a decision. ADR-0003 still stands until it is
 * judged otherwise; nothing here should be read as overturning it.
 *
 * Throwaway; dies with the branch.
 */
export function PartStave({
  markers,
  movements,
  naming,
  duration,
  currentTime,
  passedId,
  onSeek,
}: PartStaveProps) {
  const segments = movementSegments(markers, movements, duration);
  const elapsed = Math.min(currentTime, duration);
  const played = duration > 0 ? (elapsed / duration) * 100 : 0;
  /** A time's position along the recording, as a percentage of its width. */
  const at = (time: number): number => (duration > 0 ? (time / duration) * 100 : 0);

  /** The stretches the row divides into, one per movement, in time order. */
  const named = segments.map((segment) => ({
    id: segment.movement?.id ?? 'lead',
    name: segment.movement === null ? '' : segment.name,
    start: segment.start,
    end: segment.end,
  }));

  /**
   * The row's stretches tile the recording from zero, and that is the whole
   * of the alignment: a stretch starting at its movement's start puts the
   * name's left edge on the position the stave rules that movement's bar line
   * at, which is where the movement's first mark sits in its box.
   *
   * `movementSegments` drops the stretch before the first movement when
   * nothing is marked in it — a heading over an empty run of a recording is
   * noise — and that is a rule about the *list*. Read onto the row it is a
   * bug: shares of what is left begin at zero, so the first name starts at
   * the stave's left edge, a movement's start to the left of the line it
   * names. The lead goes back in here, nameless and unmarked.
   */
  const stretches =
    named[0] !== undefined && named[0].start > 0
      ? [{ id: 'lead', name: '', start: 0, end: named[0].start }, ...named]
      : named;

  /**
   * A stretch's share of the row's width. Before the recording's length is
   * known there is nothing to divide by — every position on the stave is zero
   * anyway — so the names divide the row evenly rather than all collapsing to
   * nothing.
   */
  const share = (stretch: { start: number; end: number }): string => {
    const span = at(stretch.end) - at(stretch.start);
    return `${span > 0 ? span : 100 / stretches.length}%`;
  };

  /** A click anywhere on the stave seeks to that point of the recording. */
  function handleSeek(event: MouseEvent<HTMLDivElement>): void {
    if (duration <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    onSeek(Math.min(1, Math.max(0, ratio)) * duration);
  }

  return (
    <div
      className="part-staff"
      role="slider"
      aria-label="Recording timeline"
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={Math.round(elapsed)}
      onClick={handleSeek}
    >
      {/* The marks, in boxes, at the positions they occupy in the recording. */}
      <div className="part-staff-marks">
        {markers.map((marker) => {
          const text = boxText(marker, naming);
          if (text === '') return null;
          return (
            <span
              key={marker.id}
              className={`part-staff-box${marker.id === passedId ? ' is-passed' : ''}`}
              style={{ left: `${at(marker.time)}%` }}
            >
              {text}
            </span>
          );
        })}
      </div>

      {/* The five hairlines, the movement bar lines, and the playhead. */}
      <div className="part-staff-rules">
        {[0, 1, 2, 3, 4].map((line) => (
          <span key={line} className="part-staff-line" style={{ top: `${line * 25}%` }} />
        ))}
        {movements.map((movement) => (
          <span
            key={movement.id}
            className="part-staff-bar"
            style={{ left: `${at(movement.start)}%` }}
          />
        ))}
        {/* The final barline: a hairline stroke and a heavy one, the mark a
            score closes a piece with, at the recording's end rather than at a
            time — a stave that simply stops reads as a drawing that was cut
            off, not as a recording that has ended. Both strokes are drawn by
            the one rule; see `prototypePart.css`. */}
        <span className="part-staff-bar is-final" />
        <span className="part-staff-playhead" style={{ left: `${played}%` }} />
      </div>

      {/* Each name takes its movement's share of the width, so it can never
          overlap the name beside it. A share, not a growth: a growing item's
          own size is added to the share it grows into, so every boundary
          after the first lands its padding to the right of the line it names.
          Given as a basis the item is exactly its share wide — and the name
          inside it is what keeps clear of the name beside, so that the share
          is the only thing the item's size is made of. */}
      <div className="part-staff-movements">
        {stretches.map((stretch) => (
          <span
            key={stretch.id}
            className="part-staff-movement"
            style={{ flexBasis: share(stretch) }}
          >
            <span className="part-staff-movement-name">{stretch.name}</span>
          </span>
        ))}
      </div>

      <div className="part-staff-clock">
        <span>{formatWholeSeconds(elapsed, duration)}</span>
        <span>{formatWholeSeconds(duration, duration)}</span>
      </div>
    </div>
  );
}
