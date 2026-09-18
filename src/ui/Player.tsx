import type { AudioController } from '../audio';
import type { LabeledMarker, Movement } from '../domain';
import type { Autosave } from '../projects/autosave';
import { MarkersPanel } from './MarkersPanel';
import { PracticeReadout } from './PracticeReadout';
import { RecordingSurface } from './RecordingSurface';
import { useLabeledPlayback } from './useLabeledPlayback';
import { usePlayerKeys } from './playerKeys';
import { useRecordingSession } from './useRecordingSession';
import './player.css';

export interface PlayerProps {
  /**
   * The session's autosave — owned by the route that built the session
   * (T45), which flushes it when the player unmounts, so the list never
   * reads stale data.
   */
  autosave: Autosave;
  /** The AudioController seam instance this session runs on. */
  controller: AudioController;
  /**
   * A read-only session (T50): the public project view opens a stranger's
   * published project, which must never be written — not even the duration
   * stamp, the one write an editing session makes. The player then skips
   * every mutation and never flushes on unmount; playback, seeking, and the
   * markers are all read-only either way.
   */
  readOnly?: boolean;
  /**
   * The markings page's address, offered as the markers panel's quiet way in
   * (T55). The panel is where the marks live, so the door sits where the
   * intent forms; a read-only session passes nothing and the panel carries no
   * door. The practice surface gains no editing affordance of its own either
   * way — the link navigates, and nothing on this screen writes.
   */
  markingsHref?: string;
}

/**
 * The player screen (T39): a playback-only practice surface. Markers are
 * read-only here — the posture toggle, the app's own play/pause and volume
 * transport (the embedded recording supplies its own controls), the Add
 * marker control, the marker inspector, delete-with-undo, and the editing
 * keyboard shortcuts all left, and with them marker selection: a marker row
 * click jumps, never selects. The only surviving keys are navigation: Space to
 * play/pause, ←/→ to seek ∓5s, ↑/↓ to walk the marks (wrapping). `Alt`+`←`
 * reverts to the browser's Back, an accepted consequence. The one mutation the
 * player makes is stamping the measured duration after load; everything audible
 * goes through the `controller`.
 *
 * The page is shell chrome (T45): the persistent navbar and the shared page
 * rail frame it, and the player carries no nav of its own (the in-player
 * Projects control and the `onExit` prop it rode on are retired: navigation is
 * the only exit). It renders the project name in its own band above the
 * recording, and the recording itself is the shared `RecordingSurface` (T55) —
 * the same surface the markings page hosts.
 *
 * The recording's clock is a single filled bar below the split (T38). It
 * carries no marks: the flags left the strip for the markers panel, a
 * scrollable list in the side column where each marker is a row — timestamp,
 * then `label — alias` — and the row holding the playhead is highlighted. A
 * click on the bar seeks; a marker row click jumps to that marker. When the
 * recording has movements (ADR-0005) the rows group under sticky movement
 * headers that jump to the movement's start, and the rehearsal letters
 * restart at A within each movement. The panel follows the playhead — the
 * active row is kept at the top of the list, whether the playhead moved
 * because of something here or because of the embedded player's own controls —
 * with a grace period after the reader scrolls the list by hand.
 */
export function Player({ autosave, controller, readOnly = false, markingsHref }: PlayerProps) {
  const session = useRecordingSession({ autosave, controller, readOnly });
  const { record } = session;
  // The playback view of the recording — the shared derivation (T55), so the
  // practice surface and the markings page read the same record the same way.
  const { playback, labeled, duration, activeMarker } = useLabeledPlayback({
    controller,
    record,
  });

  // Space, the arrows, and the mark walk — the playback keys shared with the
  // markings page, inert until the load settles.
  usePlayerKeys({ controller, markers: labeled, settled: session.settled });

  /**
   * A marker row click: always jump to the marker. Selection ceased to exist
   * with the editing tools, so clicking never selects — there is nothing on
   * this screen to select a marker *for*.
   */
  function handleMarkerSeek(marker: LabeledMarker): void {
    controller.seek(marker.time);
  }

  /**
   * A movement header click (ADR-0005): jump to the movement's start. Like a
   * marker row, the header is a navigation surface — it seeks and never
   * selects.
   */
  function handleMovementSeek(movement: Movement): void {
    controller.seek(movement.start);
  }

  /** A readout bar click: the readout has already resolved the position. */
  function handleReadoutSeek(time: number): void {
    controller.seek(time);
  }

  return (
    <RecordingSurface
      controller={controller}
      record={record}
      videoRef={session.containerRef}
      settled={session.settled}
      loadFailed={session.loadFailed}
      onRetryLoad={session.retryLoad}
      side={(markersMaxHeight) => (
        <>
          <PracticeReadout
            markers={labeled}
            currentTime={playback.currentTime}
            duration={duration}
            onSeek={handleReadoutSeek}
          />
          <MarkersPanel
            markers={labeled}
            movements={record.movements}
            duration={duration}
            activeId={activeMarker?.id ?? null}
            onSeek={handleMarkerSeek}
            onSeekMovement={handleMovementSeek}
            maxHeight={markersMaxHeight ?? undefined}
            markingsHref={markingsHref}
          />
        </>
      )}
    />
  );
}
