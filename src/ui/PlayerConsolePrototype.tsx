import { useState } from 'react';
import type { MouseEvent } from 'react';
import { Link } from 'react-router';
import { formatWholeSeconds } from '../domain';
import type { PlayerProps } from './Player';
import {
  YOUTUBE_FAILED_EXPLANATION,
  aliasText,
  boxText,
  movementSegments,
} from './prototypePlayerShared';
import { useLabeledPlayback } from './useLabeledPlayback';
import { usePlayerKeys } from './playerKeys';
import { useRecordingSession } from './useRecordingSession';
import './prototypeConsole.css';

/**
 * PROTOTYPE — Direction B, "The Console", on the player.
 *
 * The app as an instrument you play. The recording takes the screen and the
 * controls sit under it like a device on a music stand: a slim name plate, the
 * video, a **scrub rail** with the two clocks, and the **deck** — the marks —
 * across the bottom, where a hand would rest.
 *
 * **The deck lifts.** One control raises it off its dock until it covers the
 * recording, so a player working a passage can read the marks without the
 * video's light behind them, and drop it again to watch. This is the piece
 * that costs something: `docs/prototypes.md` records that a side panel beat a
 * bottom section for exactly this content, and ADR-0003 records that the
 * player is playback-only. Both are being consciously put back on the table
 * here, not quietly reversed.
 *
 * **The box is the signature.** It is the only thing on the surface allowed to
 * be bright: dark and outlined at rest, and on the mark the playhead has last
 * passed it fills with the focus blue and knocks its letter out, with an LED
 * at the row's edge. The light comes from the marks and the recording; nothing
 * else on the surface is coloured.
 */
export function PlayerConsolePrototype({
  autosave,
  controller,
  readOnly = false,
  markingsHref,
}: PlayerProps) {
  const session = useRecordingSession({ autosave, controller, readOnly });
  const { record } = session;
  const { playback, labeled, naming, duration, passedMarker } = useLabeledPlayback({
    controller,
    record,
  });
  usePlayerKeys({ controller, markers: labeled, settled: session.settled });
  /** Whether the deck is raised off its dock, covering the recording. */
  const [lifted, setLifted] = useState(false);

  const segments = movementSegments(labeled, record.movements, duration);
  const passedId = passedMarker?.id ?? null;
  const elapsed = Math.min(playback.currentTime, duration);
  const played = duration > 0 ? (elapsed / duration) * 100 : 0;

  /** A rail click seeks to the clicked fraction of the recording. */
  function handleRailSeek(event: MouseEvent<HTMLDivElement>): void {
    if (duration <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    controller.seek(Math.min(1, Math.max(0, ratio)) * duration);
  }

  return (
    <div
      className={`console-root console-player${lifted ? ' is-lifted' : ''}`}
      data-settled={session.settled || undefined}
    >
      <header className="console-plate">
        <h1 className="console-project">{record.name}</h1>
        <p className="console-recording">{record.recordingTitle}</p>
        {markingsHref !== undefined && (
          <Link to={markingsHref} className="console-door">
            Markings
          </Link>
        )}
      </header>

      <div className="console-stage">
        <div ref={session.containerRef} className="console-video-mount" />
        {session.loadFailed && (
          <div role="alert" className="console-failure">
            <p>{YOUTUBE_FAILED_EXPLANATION}</p>
            <button type="button" className="console-retry" onClick={session.retryLoad}>
              Retry
            </button>
          </div>
        )}
      </div>

      <div className="console-transport">
        <div
          className="console-rail"
          role="slider"
          aria-label="Recording timeline"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={Math.round(elapsed)}
          onClick={handleRailSeek}
        >
          <div className="console-rail-fill" style={{ width: `${played}%` }} />
          <div className="console-rail-head" style={{ left: `${played}%` }} />
        </div>
        <div className="console-rail-times">
          <span className="console-clock">{formatWholeSeconds(elapsed, duration)}</span>
          <span className="console-clock console-clock-total">
            {formatWholeSeconds(duration, duration)}
          </span>
        </div>
      </div>

      <div className="console-deck">
        <button
          type="button"
          className="console-grip"
          aria-expanded={lifted}
          onClick={() => setLifted((value) => !value)}
        >
          <span className="console-grip-bar" aria-hidden="true" />
          <span className="console-grip-text">{lifted ? 'Drop the deck' : 'Lift the deck'}</span>
        </button>

        <div className="console-deck-body">
          {segments.map((segment) => (
            <section className="console-band" key={segment.movement?.id ?? 'lead'}>
              <h2 className="console-band-name">{segment.name}</h2>
              <ol className="console-slots">
                {segment.markers.map((marker) => {
                  const current = marker.id === passedId;
                  return (
                    <li className="console-slot" key={marker.id}>
                      <button
                        type="button"
                        className={`console-slot-hit${current ? ' is-current' : ''}`}
                        aria-current={current ? 'true' : undefined}
                        onClick={() => controller.seek(marker.time)}
                      >
                        <span className="console-lamp" aria-hidden="true" />
                        <span className="console-slot-box">{boxText(marker, naming)}</span>
                        <span className="console-slot-alias">{aliasText(marker, naming)}</span>
                        <span className="console-slot-time">
                          {formatWholeSeconds(marker.time, duration)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
