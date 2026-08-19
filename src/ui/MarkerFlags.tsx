import type { LabeledMarker } from '../domain';

export interface MarkerFlagsProps {
  /** Markers with derived labels, in time order. */
  markers: LabeledMarker[];
  /** The known recording duration, seconds — flag positions divide by it. */
  duration: number;
  selectedId: string | null;
  /** Clicking a flag jumps to the marker and selects it. */
  onSelect(marker: LabeledMarker): void;
}

/**
 * The marker overlay: one flag per marker, positioned by time as a
 * percentage of the recording. Flags are click-to-jump surfaces, not tab
 * stops — keyboard users reach markers through the letter keys (T07), and
 * keeping them out of the tab order leaves it to the transport controls.
 */
export function MarkerFlags({ markers, duration, selectedId, onSelect }: MarkerFlagsProps) {
  if (duration <= 0) return null;
  return (
    <div className="player-markers">
      {markers.map((marker) => (
        <button
          key={marker.id}
          type="button"
          tabIndex={-1}
          className="player-flag"
          aria-pressed={marker.id === selectedId}
          style={{ left: `${(marker.time / duration) * 100}%` }}
          onClick={() => onSelect(marker)}
          // A flag owns its double-clicks and long-presses: two clicks on a
          // flag are two selections, never a new marker on the surface below.
          onDoubleClick={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
          title={
            marker.aliases.length > 0 ? `${marker.label} — ${marker.aliases.join(', ')}` : marker.label
          }
        >
          {marker.label}
        </button>
      ))}
    </div>
  );
}
