import { useEffect, useState } from 'react';
import { errorMessage, formatTime, parseTime } from '../domain';
import type { LabeledMarker } from '../domain';

export interface MarkerInspectorProps {
  /** The selected marker, with its derived label. */
  marker: LabeledMarker;
  /** The known recording duration — display format and clamping use it. */
  duration: number;
  /** Moves the marker by a delta; the parent clamps to the recording. */
  onNudge(delta: number): void;
  /** Commits a parsed time; throws DomainError on rejection. */
  onSetTime(time: number): void;
  /** Commits aliases; throws DomainError on rejection. */
  onSetAliases(aliases: string[]): void;
  onDelete(): void;
  onDeselect(): void;
}

/**
 * The selected marker's panel: nudge buttons, a lenient time field, an alias
 * field, and delete. Fields hold user text and commit on Enter or blur; the
 * domain's own errors (invalid format, alias collisions, length) come back as
 * inline messages. Blanking the alias field clears aliases — an empty marker
 * alias is not an error.
 */
export function MarkerInspector({
  marker,
  duration,
  onNudge,
  onSetTime,
  onSetAliases,
  onDelete,
  onDeselect,
}: MarkerInspectorProps) {
  const [timeText, setTimeText] = useState(() => formatTime(marker.time, duration));
  const [aliasText, setAliasText] = useState(() => marker.aliases.join(', '));
  const [timeError, setTimeError] = useState<string | null>(null);
  const [aliasError, setAliasError] = useState<string | null>(null);

  // The fields mirror committed values; edits live only in local state until
  // a commit. Every external change (nudge, re-select) resyncs the fields and
  // clears stale errors, since they show canonical values again.
  useEffect(() => {
    setTimeText(formatTime(marker.time, duration));
    setAliasText(marker.aliases.join(', '));
    setTimeError(null);
    setAliasError(null);
  }, [marker.id, marker.time, marker.aliases, duration]);

  function commitTime(): void {
    let time: number;
    try {
      time = parseTime(timeText);
    } catch (error) {
      setTimeError(errorMessage(error));
      return;
    }
    if (time === marker.time) {
      // No change — just canonicalize the display ("5 10" → "05:10.000").
      setTimeText(formatTime(marker.time, duration));
      setTimeError(null);
      return;
    }
    try {
      onSetTime(time);
    } catch (error) {
      setTimeError(errorMessage(error));
      return;
    }
    setTimeError(null);
  }

  function commitAliases(): void {
    const parsed = aliasText
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '');
    const sameAsCommitted = parsed.join('\u0000') === marker.aliases.join('\u0000');
    if (parsed.length === 0 && marker.aliases.length === 0) {
      setAliasText('');
      setAliasError(null);
      return;
    }
    if (sameAsCommitted) {
      setAliasText(marker.aliases.join(', '));
      setAliasError(null);
      return;
    }
    try {
      onSetAliases(parsed);
    } catch (error) {
      setAliasError(errorMessage(error));
      return;
    }
    setAliasError(null);
  }

  return (
    <section className="player-inspector" aria-label={`Marker ${marker.label}`}>
      <header className="player-inspector-header">
        <strong>{marker.label}</strong>
        <span>{formatTime(marker.time, duration)}</span>
        <button type="button" aria-label="Close" onClick={onDeselect}>
          ×
        </button>
      </header>
      <div className="player-inspector-nudges">
        <button type="button" onClick={() => onNudge(-1)}>
          -1s
        </button>
        <button type="button" onClick={() => onNudge(-0.1)}>
          -0.1s
        </button>
        <button type="button" onClick={() => onNudge(0.1)}>
          +0.1s
        </button>
        <button type="button" onClick={() => onNudge(1)}>
          +1s
        </button>
      </div>
      <form
        className="player-inspector-field"
        onSubmit={(event) => {
          event.preventDefault();
          commitTime();
        }}
      >
        <label>
          Time
          <input
            value={timeText}
            onChange={(event) => setTimeText(event.target.value)}
            onBlur={commitTime}
            aria-invalid={timeError !== null}
          />
        </label>
        {timeError !== null && <p className="player-inspector-error">{timeError}</p>}
      </form>
      <form
        className="player-inspector-field"
        onSubmit={(event) => {
          event.preventDefault();
          commitAliases();
        }}
      >
        <label>
          Aliases
          <input
            value={aliasText}
            onChange={(event) => setAliasText(event.target.value)}
            onBlur={commitAliases}
            placeholder="Recap, Development"
            aria-invalid={aliasError !== null}
          />
        </label>
        {aliasError !== null && <p className="player-inspector-error">{aliasError}</p>}
      </form>
      <button type="button" className="player-inspector-delete" onClick={onDelete}>
        Delete marker
      </button>
    </section>
  );
}
