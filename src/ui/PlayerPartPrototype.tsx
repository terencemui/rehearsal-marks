import { Link } from 'react-router';
import { formatWholeSeconds } from '../domain';
import type { PlayerProps } from './Player';
import { PartStave } from './PartStave';
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

      {/* The staff is `PartStave`, not a copy of it: the hybrid carries the
          same component, and two drawings of one stave drift apart the moment
          either is touched — the closing bar line, the names on their
          movements' lines and the boxes are all facts about the stave, and
          they have to be one fact. */}
      <PartStave
        markers={labeled}
        movements={record.movements}
        naming={naming}
        duration={duration}
        currentTime={playback.currentTime}
        passedId={passedId}
        onSeek={(time) => controller.seek(time)}
      />

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
