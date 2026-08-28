import type { LabeledMarker } from '../domain';
import { formatWholeSeconds } from '../domain/time';

export interface MarkersPanelProps {
  /** Markers with derived labels, in time order. */
  markers: LabeledMarker[];
  /** The known recording duration, seconds — row times divide by it. */
  duration: number;
  /**
   * The active marker's id — the most recently passed marker, or null before
   * the first mark (the recording's Start has no marker of its own).
   */
  activeId: string | null;
  /** A row was clicked. The player jumps to the marker — never selects. */
  onSeek(marker: LabeledMarker): void;
  /**
   * A measured cap on the list, so its bottom stays within the video's. When
   * omitted the stylesheet's fixed cap owns the scroll — the stacked layout,
   * where there is no video bottom to stay within.
   */
  maxHeight?: number;
}

/**
 * The markers panel (player side column): one row per marker — timestamp,
 * then `label — alias` (the bare label when there's no alias) — a click-to-jump
 * surface that replaces the timeline flags (T38). The row holding the playhead
 * is highlighted; the panel scrolls when the list outgrows its band — the
 * player measures that band against the video's bottom, so a marker-heavy
 * project never towers past the recording. Rows are click-to-jump surfaces, not
 * tab stops — keyboard users reach markers through the letter keys (T07), and
 * the panel is pure navigation: clicking seeks, never selects.
 */
export function MarkersPanel({ markers, duration, activeId, onSeek, maxHeight }: MarkersPanelProps) {
  if (markers.length === 0) return null;
  return (
    <section className="player-markers" aria-label="Markers">
      <h2 className="player-markers-heading">Markers</h2>
      <ol
        className="player-marker-list"
        style={maxHeight !== undefined ? { maxHeight } : undefined}
      >
        {markers.map((marker) => (
          <li key={marker.id} className={marker.id === activeId ? 'active' : undefined}>
            <button
              type="button"
              tabIndex={-1}
              className="player-marker-row"
              onClick={(event) => {
                onSeek(marker);
                // The row is a pointer target, not a focus stop: leaving focus
                // on it would make the next Space re-activate the row (jump
                // back to it) instead of meaning play/pause.
                event.currentTarget.blur();
              }}
              title={
                marker.aliases.length > 0
                  ? `${marker.label} — ${marker.aliases.join(', ')}`
                  : marker.label
              }
            >
              <span className="player-marker-time">
                {formatWholeSeconds(marker.time, duration)}
              </span>
              <span className="player-marker-title">
                {marker.aliases.length > 0 ? `${marker.label} — ${marker.aliases[0]}` : marker.label}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
