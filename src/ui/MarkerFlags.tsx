import type { LabeledMarker } from '../domain';

export interface MarkerFlagsProps {
  /** Markers with derived labels, in time order. */
  markers: LabeledMarker[];
  /** The known recording duration, seconds — flag positions divide by it. */
  duration: number;
  /** The selected marker — null in Playback mode, where selection is hidden. */
  selectedId: string | null;
  /**
   * A flag was clicked. The parent jumps to the marker in both postures and
   * additionally selects it in Label mode.
   */
  onFlagClick(marker: LabeledMarker): void;
  /**
   * The strip's width in px — the overlay spans it, so each flag's
   * `left: time / duration` percentage lands at the right place across it.
   * The width also drives the edge-overhang correction that keeps a flag at
   * time zero from hanging off the strip's left edge.
   */
  width: number | undefined;
}

/** Half a flag chip, approximately — the clamping fudge for edge markers. */
const FLAG_HALF_CHIP_PX = 16;

/**
 * The marker overlay: one flag per marker, positioned by time as a
 * percentage of the recording. Flags are click-to-jump surfaces, not tab
 * stops — keyboard users reach markers through the letter keys (T07), and
 * keeping them out of the tab order leaves it to the transport controls.
 */
export function MarkerFlags({ markers, duration, selectedId, onFlagClick, width }: MarkerFlagsProps) {
  if (duration <= 0) return null;
  return (
    <div className="player-markers" style={width !== undefined ? { width: `${width}px` } : undefined}>
      {markers.map((marker) => {
        const percent = (marker.time / duration) * 100;
        // A flag centered on x = 0 would hang half a chip off the content's
        // left edge, where the scroll can never reach it (scrollLeft has no
        // negative range). Pull edge flags inward by the overhang instead.
        const overhang =
          width !== undefined ? Math.max(0, FLAG_HALF_CHIP_PX - (percent / 100) * width) : 0;
        return (
          <button
            key={marker.id}
            type="button"
            tabIndex={-1}
            className="player-flag"
            aria-pressed={marker.id === selectedId}
            style={{
              left: `${percent}%`,
              transform: overhang > 0 ? `translateX(calc(-50% + ${overhang}px))` : undefined,
            }}
            onClick={(event) => {
              onFlagClick(marker);
              // The flag is a pointer target, not a focus stop: leaving focus on
              // it would make the next Space re-activate the flag (jump back to
              // it) instead of meaning play/pause.
              event.currentTarget.blur();
            }}
            title={
              marker.aliases.length > 0 ? `${marker.label} — ${marker.aliases.join(', ')}` : marker.label
            }
          >
            {marker.label}
          </button>
        );
      })}
    </div>
  );
}
