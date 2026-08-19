import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { AudioController, PeakData, RenderMode } from '../audio';
import {
  addMarker,
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
import type { Autosave, ProjectRecord, SaveStatus } from '../storage';
import { MarkerFlags } from './MarkerFlags';
import { MarkerInspector } from './MarkerInspector';
import { STATUS_TEXT } from './status';
import { UndoToast } from './UndoToast';
import './player.css';

export interface PlayerProps {
  /**
   * The session's autosave — owned by the shell, which flushes it before
   * returning to the Projects screen, so the list never reads stale data.
   */
  autosave: Autosave;
  /** Decoded peaks, or `null` when decoding failed (ruler-only mode). */
  peaks: PeakData | null;
  /** The AudioController seam instance this session runs on. */
  controller: AudioController;
  /** Back to the Projects screen; the shell flushes before unmounting. */
  onExit: () => void;
}

/** The undo toast's window — the spec's five seconds, no dialog. */
const UNDO_WINDOW_MS = 5000;
/** A touch held this long is a long-press: add a marker at that position. */
const LONG_PRESS_MS = 500;
/** Movement beyond this cancels a long-press (a drag or a scroll). */
const LONG_PRESS_SLOP_PX = 10;

/** A deletion held for undo: the marker, its label, and any restore failure. */
interface UndoState {
  marker: Marker;
  /** The derived label at deletion time — the toast's "Marker C deleted". */
  label: string;
  /** Set when a restore was rejected (a name claimed during the window). */
  error: string | null;
}

/**
 * The player screen: waveform (or ruler-only timeline), marker flags, and the
 * selected marker's inspector. Markers are the T06 core: add at the playhead
 * (M or the button), add at a position (double-click / long-press), select,
 * delete with a five-second undo, nudge, re-time, and alias. T07 adds the
 * keyboard-only practice flow: ↑/↓ and A–Z jump between markers, ←/→ seek
 * ∓5s — all suppressed while typing. Jumping never selects; selection exists
 * only for nudge and delete. Everything audible goes through the `controller`;
 * marker state persists through the shell-owned `autosave` (T09), which also
 * feeds the status line.
 */
export function Player({ autosave, peaks, controller, onExit }: PlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<RenderMode | null>(null);
  const [status, setStatus] = useState<SaveStatus>(() => autosave.status());
  // The record's identity — name and audio — never changes in the player.
  const record = autosave.get();
  // The record as React state. Every mutation goes through `update`, which
  // applies it to the autosave and mirrors the result back here, so flags,
  // labels, and the inspector render from the same record that persists.
  const [current, setCurrent] = useState<ProjectRecord>(record);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const undoTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const longPress = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(
    null,
  );
  // After a long-press added a marker, the tap's trailing click must not
  // reach the seek surface — the capture-phase guard below consumes it.
  const suppressNextClick = useRef(false);
  // The playback store lives behind the seam; React subscribes to it directly.
  const playback = useSyncExternalStore(controller.subscribe, controller.getPlaybackState);

  const labeled = useMemo(() => deriveLabels(current.markers), [current.markers]);
  const duration = playback.duration > 0 ? playback.duration : current.audioMeta.duration;
  const selected = labeled.find((marker) => marker.id === selectedId) ?? null;

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

  /** Clamps a candidate marker time into the recording, when one is known. */
  function clampToDuration(time: number): number {
    const bounded = Math.max(0, time);
    return duration > 0 ? Math.min(duration, bounded) : bounded;
  }

  function addAt(time: number): void {
    const marker = createMarker(clampToDuration(time));
    updateMarkers((markers) => addMarker(markers, marker));
  }

  /** The position under a pointer x-coordinate, in recording seconds. */
  function timeAtClientX(clientX: number): number {
    const container = containerRef.current;
    if (container === null) return 0;
    const bounds = container.getBoundingClientRect();
    if (bounds.width === 0) return 0;
    return clampToDuration(((clientX - bounds.left) / bounds.width) * duration);
  }

  /** Clicking a flag: jump to the marker and select it for nudge/delete. */
  function select(marker: LabeledMarker): void {
    setSelectedId(marker.id);
    controller.seek(marker.time);
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
    if (mode === null) return;

    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    if (plain && (event.key === 'm' || event.key === 'M')) {
      // The primary marking path: a marker at the playhead, mid-playback,
      // without pausing.
      event.preventDefault();
      addAt(playback.currentTime);
      return;
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
      // M never reaches here: the block above reserves it for adding. Letters
      // without a marker pass through untouched.
      const target = markerForLetter(labeled, event.key);
      if (target !== null) {
        event.preventDefault();
        controller.seek(target.time);
      }
      return;
    }
    if (plain && (event.key === 'Delete' || event.key === 'Backspace')) {
      if (selectedId === null) return; // leave an unselected Backspace alone
      event.preventDefault();
      deleteSelected();
      return;
    }
    if (plain && event.key === 'Escape') {
      setSelectedId(null);
      return;
    }
    if (event.altKey && !event.ctrlKey && !event.metaKey) {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        // Alt+← is the browser's Back — the player owns these arrows, so the
        // browser default is always blocked; the nudge just needs a selection.
        event.preventDefault();
        if (selectedId !== null) {
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
      .load({ blob: record.audio, container, peaks })
      .then((result) => {
        if (cancelled) return;
        setMode(result.mode);
        // Ruler mode has no decode duration; the record's 0 is a placeholder.
        // The media element's metadata is the recording's true duration —
        // persisting it keeps the project list (T09) and exports honest, so
        // the one write outside the upload path earns its place. The
        // epsilon keeps media-element measurement noise from dirtying the
        // record — a no-op rewrite would re-stamp updatedAt and reorder the
        // list for a change no one made.
        if (
          result.duration > 0 &&
          Math.abs(result.duration - autosave.get().audioMeta.duration) > 0.001
        ) {
          update((current) => ({
            ...current,
            audioMeta: { ...current.audioMeta, duration: result.duration },
          }));
        }
      })
      .catch(() => {
        if (!cancelled) setMode('ruler');
      });
    return () => {
      cancelled = true;
    };
  }, [autosave, controller, peaks, record.audio, update]);

  useEffect(() => {
    const unsubscribe = autosave.subscribe(setStatus);
    return () => {
      unsubscribe();
      // Page teardown: write anything still pending, then release.
      void autosave.flush().catch(() => {});
      autosave.dispose();
      controller.destroy();
      if (undoTimeout.current !== undefined) clearTimeout(undoTimeout.current);
      if (longPress.current !== null) clearTimeout(longPress.current.timer);
    };
  }, [autosave, controller]);

  // The playhead as a percentage of the known duration; pins to the edges so
  // a trailing position can never overflow the view.
  const playheadPercent =
    playback.duration > 0
      ? Math.min(100, (playback.currentTime / playback.duration) * 100)
      : 0;

  function onDoubleClick(event: React.MouseEvent): void {
    // Flags stop their own double-clicks from reaching here (a flag
    // double-click is just two flag clicks) — this runs only on the surface.
    addAt(timeAtClientX(event.clientX));
  }

  function onTouchStart(event: React.TouchEvent): void {
    if (event.touches.length !== 1) return;
    // Flags stop their own touches from reaching here; the surface is clear.
    // Any stale suppression from an earlier gesture ends here.
    suppressNextClick.current = false;
    const { clientX: x, clientY: y } = event.touches[0];
    const timer = setTimeout(() => {
      addAt(timeAtClientX(x));
      suppressNextClick.current = true;
      // The synthesized click normally follows within a beat; if the browser
      // never delivers one, don't let the flag eat a later genuine click.
      setTimeout(() => {
        suppressNextClick.current = false;
      }, 1000);
    }, LONG_PRESS_MS);
    longPress.current = { timer, x, y };
  }

  function onTouchMove(event: React.TouchEvent): void {
    const press = longPress.current;
    if (press === null) return;
    const touch = event.touches[0];
    // Dragging or scrolling is not a long-press.
    if (
      touch === undefined ||
      Math.abs(touch.clientX - press.x) > LONG_PRESS_SLOP_PX ||
      Math.abs(touch.clientY - press.y) > LONG_PRESS_SLOP_PX
    ) {
      clearTimeout(press.timer);
      longPress.current = null;
    }
  }

  function cancelLongPress(): void {
    const press = longPress.current;
    if (press === null) return;
    clearTimeout(press.timer);
    longPress.current = null;
  }

  /** Capture-phase guard: a long-press's trailing click must not seek. */
  function onClickCapture(event: React.MouseEvent): void {
    if (!suppressNextClick.current) return;
    suppressNextClick.current = false;
    event.stopPropagation();
    event.preventDefault();
  }

  return (
    <main>
      <header>
        <button type="button" onClick={onExit}>
          Projects
        </button>
        <h1>{record.name}</h1>
        <p role="status" data-save-status={status}>
          {STATUS_TEXT[status]}
        </p>
      </header>
      <div
        className="player-waveform-shell"
        onClickCapture={onClickCapture}
        onDoubleClick={onDoubleClick}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={cancelLongPress}
        onTouchCancel={cancelLongPress}
      >
        <div ref={containerRef} className="player-waveform" />
        <MarkerFlags
          markers={labeled}
          duration={duration}
          selectedId={selectedId}
          onSelect={select}
        />
        {/* pointer-events: none — clicks pass through to the seek surface. */}
        <div
          className="player-playhead"
          style={{ left: `${playheadPercent}%` }}
          aria-hidden="true"
        />
      </div>
      <div className="player-transport">
        <button
          type="button"
          aria-pressed={playback.playing}
          disabled={mode === null}
          onClick={() => controller.togglePlay()}
        >
          {playback.playing ? 'Pause' : 'Play'}
        </button>
        <button
          type="button"
          disabled={mode === null}
          title="Shortcut: M"
          onClick={() => addAt(playback.currentTime)}
        >
          Add marker
        </button>
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
      {selected !== null && (
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
      {undo !== null && (
        <UndoToast label={undo.label} error={undo.error} onUndo={undoDelete} />
      )}
      {mode === 'ruler' && (
        <p className="ruler-note">Waveform unavailable — the timeline still works.</p>
      )}
    </main>
  );
}
