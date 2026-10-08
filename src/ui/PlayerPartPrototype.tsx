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
import './prototypePart.css';

/**
 * PROTOTYPE — Direction A, "The Part", on the player.
 *
 * The app as a document you read. Everything stacks in one column and reads
 * downward, the way a performer reads a part: the title band, the recording,
 * then the **staff** where the piece's shape is drawn, then the marks
 * themselves as a ruled list.
 *
 * **The staff is the signature.** Not a progress bar: five hairlines ruled
 * across the recording's whole length, a heavier bar line where each movement
 * begins, a pencil rule for the playhead — and the project's rehearsal marks
 * sitting above it in boxes at the positions they occupy. A glance at the
 * staff says where the marks cluster and which movement you are in; that is
 * information the app's flat progress bar cannot carry.
 *
 * **The box is the other signature**, and the one thing here allowed to be
 * loud: a rehearsal mark in a printed score is a letter in a ruled box. It
 * inverts — pencil blue ground, paper letter — on the mark the playhead has
 * last passed, so the part marks where you are the way a pencil would.
 */
export function PlayerPartPrototype({
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

  const segments = movementSegments(labeled, record.movements, duration);
  const passedId = passedMarker?.id ?? null;
  const elapsed = Math.min(playback.currentTime, duration);
  const played = duration > 0 ? (elapsed / duration) * 100 : 0;
  /** A time's position along the recording, as a percentage of its width. */
  const at = (time: number): number => (duration > 0 ? (time / duration) * 100 : 0);

  /** A click anywhere on the staff seeks to that point of the recording. */
  function handleStaffSeek(event: MouseEvent<HTMLDivElement>): void {
    if (duration <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    controller.seek(Math.min(1, Math.max(0, ratio)) * duration);
  }

  return (
    <div className="part-root part-player" data-settled={session.settled || undefined}>
      <header className="part-band">
        <h1 className="part-project">{record.name}</h1>
        <p className="part-recording">{record.recordingTitle}</p>
        {markingsHref !== undefined && (
          <Link to={markingsHref} className="part-door">
            Markings
          </Link>
        )}
      </header>

      {session.loadFailed && (
        <div role="alert" className="part-failure">
          <p>{YOUTUBE_FAILED_EXPLANATION}</p>
          <button type="button" className="part-retry" onClick={session.retryLoad}>
            Retry
          </button>
        </div>
      )}

      <div className="part-plate">
        <div ref={session.containerRef} className="part-video-mount" />
      </div>

      <div
        className="part-staff"
        role="slider"
        aria-label="Recording timeline"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={Math.round(elapsed)}
        onClick={handleStaffSeek}
      >
        <div className="part-staff-marks">
          {labeled.map((marker) => {
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

        <div className="part-staff-rules">
          {[0, 1, 2, 3, 4].map((line) => (
            <span key={line} className="part-staff-line" style={{ top: `${line * 25}%` }} />
          ))}
          {record.movements.map((movement) => (
            <span
              key={movement.id}
              className="part-staff-bar"
              style={{ left: `${at(movement.start)}%` }}
            />
          ))}
          <span className="part-staff-playhead" style={{ left: `${played}%` }} />
        </div>

        <div className="part-staff-movements">
          {segments.map((segment) => (
            <span
              key={segment.movement?.id ?? 'lead'}
              className="part-staff-movement"
              style={{ flexGrow: Math.max(segment.end - segment.start, 0.001) }}
            >
              {segment.movement === null ? '' : segment.name}
            </span>
          ))}
        </div>

        <div className="part-staff-clock">
          <span>{formatWholeSeconds(elapsed, duration)}</span>
          <span>{formatWholeSeconds(duration, duration)}</span>
        </div>
      </div>

      <div className="part-part">
        {segments.map((segment) => (
          <section className="part-movement" key={segment.movement?.id ?? 'lead'}>
            <h2 className="part-movement-head">
              <span className="part-movement-name">{segment.name}</span>
              <span className="part-movement-start">
                {formatWholeSeconds(segment.start, duration)}
              </span>
            </h2>
            <ol className="part-marks">
              {segment.markers.map((marker) => {
                const text = boxText(marker, naming);
                const alias = aliasText(marker, naming);
                const passed = marker.id === passedId;
                return (
                  <li className={`part-row${passed ? ' is-passed' : ''}`} key={marker.id}>
                    <button
                      type="button"
                      className="part-row-hit"
                      aria-current={passed ? 'true' : undefined}
                      onClick={() => controller.seek(marker.time)}
                    >
                      <span className="part-box">{text}</span>
                      <span className="part-alias">{alias}</span>
                      <span className="part-time">
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
  );
}
