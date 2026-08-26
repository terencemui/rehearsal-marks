import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { AudioController } from '../audio';
import {
  addMarker,
  canonicalYouTubeUrl,
  createMarker,
  deriveLabels,
  errorMessage,
  markerForLetter,
  moveMarker,
  nextMarker,
  previousMarker,
  removeMarker,
  setAliases as setMarkerAliases,
} from '../domain';
import type { LabeledMarker, Marker } from '../domain';
import { defaultPlayerMode } from '../storage';
import type { Autosave, PlayerMode, ProjectRecord } from '../storage';
import { renderRuler } from '../playback/renderRuler';
import { MarkerFlags } from './MarkerFlags';
import { MarkerInspector } from './MarkerInspector';
import { PracticeReadout } from './PracticeReadout';
import { UndoToast } from './UndoToast';
import './player.css';

export interface PlayerProps {
  /**
   * The session's autosave — owned by the shell, which flushes it before
   * returning to the Projects screen, so the list never reads stale data.
   */
  autosave: Autosave;
  /** The AudioController seam instance this session runs on. */
  controller: AudioController;
  /** Back to the Projects screen; the shell flushes before unmounting. */
  onExit: () => void;
}

/** The undo toast's window — the spec's five seconds, no dialog. */
const UNDO_WINDOW_MS = 5000;

/**
 * What a YouTube project's ruler says about its clock. The embed reports its
 * playhead on a coarse clock and lands seeks at segment granularity, so a mark
 * taken *from the player* inherits that slack — while a typed time or a nudge
 * edits the marker's own time and stays exact. Saying so is the difference
 * between a tool that feels imprecise and one that is honest about which of
 * its numbers are approximate.
 */
const YOUTUBE_RULER_NOTE =
  'Playing from YouTube — the embed’s clock is coarse: marks taken from the playhead ' +
  'and click-to-seek land within about a quarter second. Typed times and nudges stay exact.';

/**
 * What an empty Label-mode YouTube project says: no community labels arrived
 * for this video, and the next move is the user's own first mark. An empty
 * read-only project would hide the only thing there is to do with it.
 * "Loaded", not "exist": an unreachable index says nothing about existence,
 * and an empty claim would be a lie either way.
 */
const YOUTUBE_NO_LABELS_NOTE =
  'No community labels loaded for this video — place the first mark yourself.';

/**
 * The error card's explanation — the video is private, removed, region-
 * blocked, embed-disabled, or the API never arrived. The card names the
 * problem, shows the video's URL with an "Open on YouTube" link, and offers
 * a retry, so a temporary outage or a restored video recovers without
 * recreating the project. The marks stay visible on the stored-duration
 * timeline.
 */
const YOUTUBE_FAILED_EXPLANATION =
  'This YouTube video couldn’t be played — it may be private, removed, region-blocked, ' +
  'or unavailable for embedding. Your marks are still here.';

/** A deletion held for undo: the marker, its label, and any restore failure. */
interface UndoState {
  marker: Marker;
  /** The derived label at deletion time — the toast's "Marker C deleted". */
  label: string;
  /** Set when a restore was rejected (a name claimed during the window). */
  error: string | null;
}

/**
 * The player screen: the ruler timeline (the only timeline — every project
 * plays with it), marker flags, and the selected marker's inspector. Markers
 * are the T06 core: add at the playhead (M or the button), select, delete
 * with a five-second undo, nudge, re-time, and alias. T07 adds the
 * keyboard-only practice flow: ↑/↓ and A–Z jump between markers, ←/→ seek
 * ∓5s — all suppressed while typing. Jumping never selects; selection exists
 * only for nudge and delete. Everything audible goes through the `controller`;
 * marker state persists through the shell-owned `autosave` (T09).
 *
 * The outer chrome is the T37 practice-surface frame: a nav bar carrying only
 * the Projects control — no back arrow, no title, no save status — the project
 * name in its own band above the recording, and a shared page rail (a maximum
 * content width with fluid side margins) so content is never jammed against
 * the window edge and the page never scrolls sideways when the window narrows.
 *
 * The recording's clock is a single strip below the split (T38), spanning
 * the full content width — a click-to-seek surface with a flag at every
 * marker and a live playhead. Marker positions and the playhead are
 * percentages of the recording, so the strip is always exactly the content
 * width and never scrolls: the fit-to-viewport zoom machinery is gone. The
 * video column keeps only the recording — the audio layer's own ruler band
 * is hidden with CSS — and the strip draws its own seek surface with the
 * shared ruler-drawing module, its numbered ticks hidden. A click on the
 * strip seeks; a flag click jumps to that marker.
 *
 * T18 modes: every project has a Playback | Label posture, seeded from the
 * record's persisted `playerMode` (the default on first open) and written
 * back on every switch. Playback mode is navigation-only — the read-only
 * posture of a practice session — so every editing tool (M, the Add marker
 * button, nudges, typed times, aliases, delete with undo, Esc deselect,
 * flag-click selection) is gated behind Label mode; the keyboard scheme,
 * flag jumps, and the volume slider work in both. A selection made in Label
 * mode survives a posture switch but stays hidden — and Delete cannot reach
 * it — while practicing.
 */
export function Player({
  autosave,
  controller,
  onExit,
}: PlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  /** The strip's seek surface — the shared ruler-drawing module draws into it. */
  const surfaceRef = useRef<HTMLDivElement>(null);
  /** The timeline strip itself, whose width drives the flag edge correction. */
  const stripRef = useRef<HTMLDivElement>(null);
  /** Whether the recording's load has settled — until then the transport and
   * shortcuts are inert, and the ruler has nothing to draw on. */
  const [loaded, setLoaded] = useState(false);
  /**
   * Whether the load reported that the source cannot play. The audio layer
   * publishes this on `LoadResult.error`; a player that ignored it would show
   * a live-looking transport over a dead embed.
   */
  const [loadFailed, setLoadFailed] = useState(false);
  /** Bumped by the failure card's Retry — re-runs the load effect. */
  const [loadAttempt, setLoadAttempt] = useState(0);
  // The record's identity — name and recording — never changes in the player.
  const record = autosave.get();
  /**
   * Every project is a YouTube project: the video is the main item in the
   * split's left column, and the recording's clock is its own strip below the
   * split — never zoomed, which would stretch the embed off-screen. The
   * canonical URL derived from the stored video ID is the recording identity
   * the audio layer plays from.
   */
  const youtubeUrl = canonicalYouTubeUrl(record.videoId);
  // The record as React state. Every mutation goes through `update`, which
  // applies it to the autosave and mirrors the result back here, so flags,
  // labels, and the inspector render from the same record that persists.
  const [current, setCurrent] = useState<ProjectRecord>(record);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // T18. The player's posture, seeded from the record's last-used mode and
  // persisted on every switch. A record saved before the field existed has
  // none — its first open applies the default, exactly as creation stamps
  // it. `editing` is the one gate every editing tool reads; navigation never
  // does.
  const [playerMode, setPlayerMode] = useState<PlayerMode>(
    record.playerMode ?? defaultPlayerMode(record.markers.length),
  );
  const editing = playerMode === 'label';
  const [undo, setUndo] = useState<UndoState | null>(null);
  const undoTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The playback store lives behind the seam; React subscribes to it directly.
  const playback = useSyncExternalStore(controller.subscribe, controller.getPlaybackState);

  const labeled = useMemo(() => deriveLabels(current.markers), [current.markers]);
  const duration = playback.duration > 0 ? playback.duration : current.duration;
  const selected = labeled.find((marker) => marker.id === selectedId) ?? null;

  // The strip's measured width, kept solely to drive the flag component's
  // edge-overhang correction — a marker at time zero must not hang off the
  // strip's left edge. jsdom reports no layout (0), so the measurement only
  // lands in a real browser; the guard keeps the flags unshifted in tests.
  const [stripWidth, setStripWidth] = useState<number | undefined>(undefined);

  // One measurement, taken before the first painted frame and kept honest on
  // resize — the only geometry the strip needs.
  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (strip === null) return;
    const measure = () => {
      const width = strip.getBoundingClientRect().width;
      if (width > 0) setStripWidth(width);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    return () => observer.disconnect();
  }, []);

  // The strip's own seek surface — the shared ruler-drawing module draws it
  // once a duration is known. The strip itself stays in the layout whether or
  // not the source can play, so markers remain visible in the failure state.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (surface === null || duration <= 0) return;
    renderRuler(surface, duration, (time) => {
      controller.seek(time);
      // The ruler reports the requested position; the controller clamps it.
      return time;
    });
  }, [controller, duration]);

  /** Applies a mutation: the autosave gets it, React mirrors it back. */
  const update = useCallback(
    (fn: (current: ProjectRecord) => ProjectRecord): void => {
      setCurrent(autosave.mutate(fn));
    },
    [autosave],
  );

  /** Applies a markers-only mutation to the record. */
  function updateMarkers(fn: (markers: Marker[]) => Marker[]): void {
    update((r) => ({ ...r, markers: fn(r.markers) }));
  }

  /**
   * Switches posture and persists it — the record's last-used mode is the
   * next session's initial posture. A no-op switch writes nothing: like the
   * duration epsilon, a rewrite that changed nothing would dirty the record.
   */
  function changeMode(next: PlayerMode): void {
    if (next === playerMode) return;
    setPlayerMode(next);
    update((r) => ({ ...r, playerMode: next }));
  }

  /** Clamps a candidate marker time into the recording, when one is known. */
  function clampToDuration(time: number): number {
    const bounded = Math.max(0, time);
    return duration > 0 ? Math.min(duration, bounded) : bounded;
  }

  function addAt(time: number): void {
    const marker = createMarker(clampToDuration(time));
    updateMarkers((markers) => addMarker(markers, marker));
  }

  /** Adds a marker at the playhead — M or the visible button. */
  function addAtPlayhead(): void {
    addAt(playback.currentTime);
  }

  /**
   * A flag click: always jump to the marker — navigation exists in both
   * postures — but select it for nudge/delete only in Label mode. Playback
   * mode's clicks never touch the (hidden) selection.
   */
  function handleFlagClick(marker: LabeledMarker): void {
    controller.seek(marker.time);
    if (editing) setSelectedId(marker.id);
  }

  function deleteSelected(): void {
    const marker = current.markers.find((m) => m.id === selectedId);
    if (marker === undefined || selected === null) return;
    updateMarkers((markers) => removeMarker(markers, marker.id));
    setSelectedId(null);
    setUndo({ marker, label: selected.label, error: null });
    if (undoTimeout.current !== undefined) clearTimeout(undoTimeout.current);
    undoTimeout.current = setTimeout(() => setUndo(null), UNDO_WINDOW_MS);
  }

  function undoDelete(): void {
    if (undo === null) return;
    try {
      updateMarkers((markers) => addMarker(markers, undo.marker));
    } catch (error) {
      // The restore can only be rejected if a name the deleted marker owned
      // was claimed during the window — surface that instead of failing.
      setUndo({ ...undo, error: errorMessage(error) });
      return;
    }
    if (undoTimeout.current !== undefined) clearTimeout(undoTimeout.current);
    setUndo(null);
  }

  function nudge(delta: number): void {
    if (selected === null) return;
    const time = clampToDuration(selected.time + delta);
    updateMarkers((markers) => moveMarker(markers, selected.id, time));
  }

  function setTime(time: number): void {
    if (selected === null) return;
    updateMarkers((markers) => moveMarker(markers, selected.id, clampToDuration(time)));
  }

  function applyAliases(aliases: string[]): void {
    if (selected === null) return;
    updateMarkers((markers) => setMarkerAliases(markers, selected.id, aliases));
  }

  // The window-level keydown listener is registered once and reads the latest
  // handler through a ref reassigned every render, so shortcuts always see
  // fresh markers, selection, and playhead without re-registering per tick.
  const keyDownRef = useRef<(event: KeyboardEvent) => void>(() => {});
  keyDownRef.current = (event: KeyboardEvent) => {
    // One action per press: holding a key repeats the event at the OS repeat
    // rate, which would storm seeks and marker jumps.
    if (event.repeat) return;
    const target = event.target;
    // Shortcuts are suppressed while focus is in a text input. Space gets one
    // extra exception: a focused button owns it through native activation —
    // handling it too would toggle twice. M and the rest still work with a
    // button focused, so marking right after clicking Play behaves.
    const inTextInput =
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable);

    if (event.key === ' ') {
      if (inTextInput || (target instanceof HTMLElement && target.tagName === 'BUTTON')) {
        return;
      }
      event.preventDefault();
      controller.togglePlay();
      return;
    }
    if (inTextInput) return;
    // Before the recording loads there is nothing to seek, jump to, or mark —
    // the transport is disabled and the shortcuts are too.
    if (!loaded) return;

    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    if (plain && (event.key === 'm' || event.key === 'M')) {
      // The primary marking path: a marker at the playhead, mid-playback,
      // without pausing. Label mode only — in Playback mode there is nothing
      // to reserve M for, so it falls through to the letter jump below — and
      // never against a source that cannot play: a mark from a dead clock is
      // noise. In that state M falls through like any letter.
      if (editing && !loadFailed) {
        event.preventDefault();
        addAtPlayhead();
        return;
      }
    }
    // Arrows are plain chords only: Shift+arrows stay the browser's (scroll,
    // selection), Alt+arrows are the marker nudge below.
    const plainArrows = plain && !event.shiftKey;
    if (plainArrows && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      // Plain arrows seek ∓5s from the live playhead — the store's value can
      // trail the audible position by a timeupdate interval.
      event.preventDefault();
      controller.seek(controller.getCurrentTime() + (event.key === 'ArrowLeft' ? -5 : 5));
      return;
    }
    if (plainArrows && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      // ↑/↓ jump between markers anchored at the live playhead, wrapping at
      // the ends. Jumping never selects — selection exists only for nudge and
      // delete — and never touches playback state. A key with nothing to jump
      // to is left alone, so arrow scrolling still works.
      const anchor = controller.getCurrentTime();
      const target =
        event.key === 'ArrowDown' ? nextMarker(labeled, anchor) : previousMarker(labeled, anchor);
      if (target === null) return;
      event.preventDefault();
      controller.seek(target.time);
      return;
    }
    if (plain && /^[a-z]$/i.test(event.key)) {
      // A–Z jumps straight to that marker — "take it from C" is one keypress.
      // M reaches here only in Playback mode: Label mode's block above
      // reserves it for adding. Letters without a marker pass through
      // untouched.
      const target = markerForLetter(labeled, event.key);
      if (target !== null) {
        event.preventDefault();
        controller.seek(target.time);
      }
      return;
    }
    if (plain && (event.key === 'Delete' || event.key === 'Backspace')) {
      // Playback mode never deletes — the marks are read-only there. An
      // unselected Backspace is left alone in either posture.
      if (!editing || selectedId === null) return;
      event.preventDefault();
      deleteSelected();
      return;
    }
    if (plain && event.key === 'Escape') {
      if (editing) setSelectedId(null);
      return;
    }
    if (event.altKey && !event.ctrlKey && !event.metaKey) {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        // Alt+← is the browser's Back — the player owns these arrows in both
        // postures, so the browser default is always blocked; the nudge is
        // Label mode's and needs a selection.
        event.preventDefault();
        if (editing && selectedId !== null) {
          nudge(event.key === 'ArrowLeft' ? -0.1 : 0.1);
        }
      }
    }
  };

  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyDownRef.current(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    let cancelled = false;
    controller
      .load({
        // A project has only its canonical URL to play from — no blob, no
        // peaks — and the audio layer owns everything after that.
        source: 'youtube',
        url: youtubeUrl,
        container,
        // The stored duration is the failure state's timeline: a dead
        // embed reports nothing, so the ruler and the marks that ride on it
        // render from the last honest length the record has.
        duration: autosave.get().duration,
      })
      .then((result) => {
        if (cancelled) return;
        setLoaded(true);
        setLoadFailed(result.error !== undefined);
        // No decode supplies a duration; the record's 0 is a placeholder.
        // The media element's metadata is the recording's true duration —
        // persisting it keeps the project list (T09) and exports honest, so
        // the one write outside the create path earns its place. The epsilon
        // keeps media-element measurement noise from dirtying the record — a
        // no-op rewrite would re-stamp updatedAt and reorder the list for a
        // change no one made.
        if (result.duration > 0 && Math.abs(result.duration - autosave.get().duration) > 0.001) {
          update((current) => ({ ...current, duration: result.duration }));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoaded(true);
          setLoadFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
    // The URL is fixed for the life of a session; `loadAttempt` is the failure
    // card's retry, the one deliberate re-run of the whole load.
  }, [autosave, controller, loadAttempt, update, youtubeUrl]);

  /** The failure card's retry: back to loading, then a fresh load attempt. */
  function retryLoad(): void {
    setLoaded(false);
    setLoadFailed(false);
    setLoadAttempt((attempt) => attempt + 1);
  }

  useEffect(() => {
    // Page teardown: write anything still pending, then release. The shell
    // flushes before returning to the Projects screen, so this is normally a
    // no-op; it is the safety net for a session torn down any other way.
    return () => {
      void autosave.flush().catch(() => {});
      autosave.dispose();
      controller.destroy();
      if (undoTimeout.current !== undefined) clearTimeout(undoTimeout.current);
    };
  }, [autosave, controller]);

  // The playhead as a percentage of the recording, pinned to the end so a
  // trailing position can never overflow the strip.
  const playheadPercent =
    duration > 0 ? (Math.min(playback.currentTime, duration) / duration) * 100 : 0;

  // The full-width timeline strip (T38): the recording's clock below the
  // split. It carries its own seek surface (the shared ruler, ticks hidden),
  // the marker flags, and the live playhead. The strip never scrolls — marker
  // positions and the playhead are percentages of the recording — so the only
  // geometry it needs is the measured width that keeps a flag at time zero on
  // screen.
  const timelineStrip = (
    <div ref={stripRef} className="player-timeline-strip">
      <div ref={surfaceRef} className="player-timeline-surface" />
      <MarkerFlags
        markers={labeled}
        duration={duration}
        selectedId={editing ? selectedId : null}
        onFlagClick={handleFlagClick}
        width={stripWidth}
      />
      {/* pointer-events: none — clicks pass through to the seek surface. */}
      <div
        className="player-playhead"
        style={{ left: `${playheadPercent}%` }}
        aria-hidden="true"
      />
    </div>
  );

  return (
    <main>
      {/* T37 frame: the nav carries only the Projects control, the title sits
          in its own band, and the rail wraps the split below. */}
      <nav className="player-nav">
        <div className="player-rail">
          <button type="button" onClick={onExit}>
            Projects
          </button>
        </div>
      </nav>
      <div className="player-rail player-page">
        <h1 className="player-title">{record.name}</h1>
        {loadFailed && (
          <div role="alert" className="player-youtube-error">
            <p>{YOUTUBE_FAILED_EXPLANATION}</p>
            <p>
              <a href={youtubeUrl} target="_blank" rel="noreferrer">
                {youtubeUrl}
              </a>
            </p>
            <button type="button" onClick={retryLoad}>
              Retry
            </button>
          </div>
        )}
        {/* T27/T38: the practice split view — the recording fills its column
            (the audio layer loads the embed into the .player-ruler container;
            its own ruler band is hidden) with the practice readout beside it,
            and the recording's clock is its own full-width strip below the
            split. Every project is a YouTube project, so the split view is
            unconditional. */}
        <div className="player-practice-split">
          <div className="player-video-column">
            <div ref={containerRef} className="player-ruler" />
          </div>
          <PracticeReadout
            markers={labeled}
            currentTime={playback.currentTime}
            duration={duration}
          />
        </div>
        {timelineStrip}
        <div className="player-transport">
          <button
            type="button"
            aria-pressed={playback.playing}
            // A source that reported it cannot play has an inert transport;
            // leaving Play enabled would promise something no click delivers.
            disabled={!loaded || loadFailed}
            onClick={() => controller.togglePlay()}
          >
            {playback.playing ? 'Pause' : 'Play'}
          </button>
          <div className="player-modes" role="group" aria-label="Player mode">
            <button type="button" aria-pressed={!editing} onClick={() => changeMode('playback')}>
              Playback
            </button>
            <button type="button" aria-pressed={editing} onClick={() => changeMode('label')}>
              Label
            </button>
          </div>
          {editing && (
            <button
              type="button"
              // A dead source has no honest playhead to mark from — the button
              // stays visible (the mode is still Label) but promises nothing.
              disabled={!loaded || loadFailed}
              title="Shortcut: M"
              onClick={() => addAtPlayhead()}
            >
              Add marker
            </button>
          )}
          <label className="player-volume">
            <span>Volume</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={playback.volume}
              onChange={(event) => controller.setVolume(Number(event.target.value))}
            />
          </label>
        </div>
        {editing && selected !== null && (
          <MarkerInspector
            marker={selected}
            duration={duration}
            onNudge={nudge}
            onSetTime={setTime}
            onSetAliases={applyAliases}
            onDelete={deleteSelected}
            onDeselect={() => setSelectedId(null)}
          />
        )}
        {/* The toast answers the Label-mode delete that opened its window; it
        deliberately survives a posture switch. Dismissing it there would
        silently finalize the delete — practice flow switches modes constantly,
        and an undo that evaporates on the switch is a trap, not read-only. */}
        {undo !== null && (
          <UndoToast label={undo.label} error={undo.error} onUndo={undoDelete} />
        )}
        {/* The failure card carries the explanation when the video cannot play;
        a precision note about working playback would be a lie beside it. */}
        {loaded && !loadFailed && (
          <p className="ruler-note">
            {editing && current.markers.length === 0
              ? // One note, both truths: the missing labels and the coarse
                // clock the first mark will inherit — stacked hint paragraphs
                // would read as one warning doubled.
                `${YOUTUBE_NO_LABELS_NOTE} ${YOUTUBE_RULER_NOTE}`
              : YOUTUBE_RULER_NOTE}
          </p>
        )}
      </div>
    </main>
  );
}
