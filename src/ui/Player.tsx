import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
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
import {
  ZOOM_STEP,
  clampScrollLeft,
  contentWidth,
  minPxPerSec,
  scrollLeftForTime,
  timeAtClientX as timeAtOffset,
  wheelNotches,
  zoomAround,
  type ZoomView,
} from './zoom';
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
/** A pinch with fingers closer than this has no trustworthy anchor yet. */
const PINCH_MIN_START_PX = 20;

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
 *
 * T08 zoom: the shell is a horizontally scrollable window over the content
 * (`pxPerSec × duration` px wide). The zoom level lives here as `pxPerSec`,
 * and the content width is applied to the controller's container — wavesurfer
 * renders to whatever width it is given, and the ruler's percentage ticks
 * stretch with it — so the audio seam never learns about zoom. Ctrl/cmd+scroll
 * and two-finger pinch adjust the level around the cursor; jumps scroll the
 * target into view.
 */
export function Player({ autosave, peaks, controller, onExit }: PlayerProps) {
  const shellRef = useRef<HTMLDivElement>(null);
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

  // T08 zoom. `pxPerSec` is null until the duration is known, then settles at
  // the floor (or fit-to-view for short recordings) — the precision view the
  // issue calls for. Scroll stays in the DOM (`shell.scrollLeft`); the view
  // re-renders only when the level changes, and the flags overlay scrolls
  // natively with the content.
  const [pxPerSec, setPxPerSec] = useState<number | null>(null);
  // The zoom state as the window-level gesture listeners see it: fresh values
  // through a ref, the same pattern as the keydown handler below.
  const viewRef = useRef<{ pxPerSec: number; duration: number } | null>(null);
  viewRef.current =
    pxPerSec !== null && duration > 0 ? { pxPerSec, duration } : null;
  const pinchRef = useRef<{
    startView: ZoomView;
    startDistance: number;
    cursorOffset: number;
  } | null>(null);
  // A zoom's scroll, held until the new width has committed (see the layout
  // effect below) — the CSSOM clamps scrollLeft against the current content
  // width at assignment time, so writing it early would drop the anchor.
  const pendingScrollRef = useRef<number | null>(null);
  // A one-finger horizontal pan: the browser keeps vertical page scroll
  // (`touch-action: pan-y`), this content scroll is ours.
  const panRef = useRef<{
    startX: number;
    startY: number;
    startScrollLeft: number;
    pxPerSec: number;
    duration: number;
    active: boolean;
  } | null>(null);

  // A layout effect, not a passive one: the initial level must be set before
  // the first painted frame, or that frame shows the flags overlay collapsed
  // to nothing and the playhead at the wrong position.
  useLayoutEffect(() => {
    if (pxPerSec !== null) return;
    const shell = shellRef.current;
    if (shell === null || duration <= 0) return;
    setPxPerSec(minPxPerSec(shell.getBoundingClientRect().width, duration));
  }, [duration, pxPerSec]);

  // Applies the zoom's scroll once the content width for the committed level
  // is in the DOM. Also re-fits when the window widens past the current
  // level: content must never be narrower than the viewport's fit.
  useLayoutEffect(() => {
    const scroll = pendingScrollRef.current;
    if (scroll !== null) {
      pendingScrollRef.current = null;
      const shell = shellRef.current;
      if (shell !== null) shell.scrollLeft = scroll;
    }
  }, [pxPerSec]);

  useEffect(() => {
    const shell = shellRef.current;
    if (shell === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      setPxPerSec((level) => {
        if (level === null || duration <= 0) return level;
        const min = minPxPerSec(shell.getBoundingClientRect().width, duration);
        return level < min ? min : level;
      });
    });
    observer.observe(shell);
    return () => observer.disconnect();
  }, [duration]);

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

  /**
   * Adds a marker at the playhead — M or the visible button. When paused, the
   * new flag is scrolled into view: a zoomed-out view must show where the
   * mark landed. During playback the view stays put, so a marking pass never
   * yanks the screen out from under the listener.
   */
  function addAtPlayhead(): void {
    addAt(playback.currentTime);
    if (!playback.playing) revealTime(playback.currentTime);
  }

  /** Scrolls the view to `time` — centered, pinned to the content edges. */
  function revealTime(time: number): void {
    const shell = shellRef.current;
    const view = viewRef.current;
    if (shell !== null && view !== null) {
      shell.scrollLeft = scrollLeftForTime(
        time,
        shell.getBoundingClientRect().width,
        view.duration,
        view.pxPerSec,
      );
    }
  }

  /**
   * The position under a pointer x-coordinate, in recording seconds — or
   * null while the view has no zoom level yet, where no position is honest.
   */
  function timeAtClientX(clientX: number): number | null {
    const shell = shellRef.current;
    const view = viewRef.current;
    if (shell === null || view === null) return null;
    const bounds = shell.getBoundingClientRect();
    if (bounds.width === 0) return null;
    // The viewport is the shell's rect; the click's offset within the content
    // adds the scroll. This stays exact at every zoom level.
    return clampToDuration(timeAtOffset(clientX, bounds.left, shell.scrollLeft, view.pxPerSec));
  }

  /** Clicking a flag: jump to the marker and select it for nudge/delete. */
  function select(marker: LabeledMarker): void {
    setSelectedId(marker.id);
    controller.seek(marker.time);
    // Jumps always bring the target into view.
    revealTime(marker.time);
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
      addAtPlayhead();
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
      // Jumps always bring the target into view (T08) — the zoomed view
      // must never leave the jumped-to marker off-screen.
      revealTime(target.time);
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
        revealTime(target.time);
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

  // The playhead in content pixels; pins to the recording's end so a trailing
  // position can never overflow the content.
  const playheadLeft =
    pxPerSec !== null && duration > 0
      ? Math.min(playback.currentTime, duration) * pxPerSec
      : 0;
  // The content's width — the waveform, flags, and ruler all span it.
  const viewWidth = pxPerSec !== null && duration > 0 ? contentWidth(pxPerSec, duration) : undefined;

  function onDoubleClick(event: React.MouseEvent): void {
    // Flags stop their own double-clicks from reaching here (a flag
    // double-click is just two flag clicks) — this runs only on the surface.
    const time = timeAtClientX(event.clientX);
    if (time !== null) addAt(time);
  }

  function onTouchStart(event: React.TouchEvent): void {
    if (event.touches.length !== 1) return;
    // Flags stop their own touches from reaching here; the surface is clear.
    // Any stale suppression from an earlier gesture ends here.
    suppressNextClick.current = false;
    const { clientX: x, clientY: y } = event.touches[0];
    const timer = setTimeout(() => {
      const time = timeAtClientX(x);
      if (time !== null) addAt(time);
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

  const cancelLongPress = useCallback((): void => {
    const press = longPress.current;
    if (press === null) return;
    clearTimeout(press.timer);
    longPress.current = null;
  }, []);

  /** Capture-phase guard: a long-press's trailing click must not seek. */
  function onClickCapture(event: React.MouseEvent): void {
    if (!suppressNextClick.current) return;
    suppressNextClick.current = false;
    event.stopPropagation();
    event.preventDefault();
  }

  // Zoom gestures register as native listeners: React's root-level wheel and
  // touchmove handlers are passive, so their synthetic events cannot cancel
  // the browser's scroll/pinch. The handlers read fresh zoom state through
  // `viewRef` (reassigned every render) and stay registered once.
  useEffect(() => {
    const shell = shellRef.current;
    if (shell === null) return;

    /**
     * Commits a zoom: the level through React, the scroll through the DOM —
     * but only after the new width commits, since the CSSOM clamps scrollLeft
     * against the *current* content width at assignment time and never
     * re-expands the clamp. A level that did not change needs no commit and
     * can apply its scroll directly.
     */
    const applyZoom = (next: ZoomView, current: number): void => {
      if (next.pxPerSec !== current) {
        setPxPerSec(next.pxPerSec);
        pendingScrollRef.current = next.scrollLeft;
      } else {
        shell.scrollLeft = next.scrollLeft;
      }
    };

    const onWheel = (event: WheelEvent): void => {
      if (!(event.ctrlKey || event.metaKey)) return;
      // Ctrl/cmd+scroll is this app's zoom — never the page's, even while
      // the recording is still loading.
      event.preventDefault();
      const view = viewRef.current;
      if (view === null) return;
      const rect = shell.getBoundingClientRect();
      const factor = Math.pow(ZOOM_STEP, -wheelNotches(event.deltaY, event.deltaMode));
      applyZoom(
        zoomAround(
          { pxPerSec: view.pxPerSec, scrollLeft: shell.scrollLeft },
          factor,
          event.clientX - rect.left,
          rect.width,
          view.duration,
        ),
        view.pxPerSec,
      );
    };

    /** Begins a pinch anchored at the current midpoint, once the fingers are
     * far enough apart that the anchor means something. */
    const beginPinch = (touches: TouchList): void => {
      const view = viewRef.current;
      if (view === null) return;
      const rect = shell.getBoundingClientRect();
      const [a, b] = [touches[0], touches[1]];
      const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (distance < PINCH_MIN_START_PX) return;
      const midX = (a.clientX + b.clientX) / 2;
      pinchRef.current = {
        startView: { pxPerSec: view.pxPerSec, scrollLeft: shell.scrollLeft },
        startDistance: distance,
        cursorOffset: midX - rect.left,
      };
    };

    const onPinchStart = (event: TouchEvent): void => {
      if (event.touches.length < 2) {
        pinchRef.current = null;
        return;
      }
      // Two or more fingers are never a long-press: a pending marker must
      // not fire because the gesture turned into something else.
      cancelLongPress();
      panRef.current = null;
      // Three-plus fingers: leave any running pinch untouched and ignore the
      // extras — an accidental extra touch must not freeze the zoom.
      if (event.touches.length === 2) beginPinch(event.touches);
    };

    const onPinchMove = (event: TouchEvent): void => {
      if (event.touches.length === 2) {
        // Two fingers belong to the pinch, whatever the browser was about to
        // do with them (page zoom included).
        event.preventDefault();
        if (pinchRef.current === null) {
          // Fingers that landed too close to anchor now have room — restart
          // from here instead of slamming the level from a 5 px base.
          beginPinch(event.touches);
        }
        const pinch = pinchRef.current;
        const view = viewRef.current;
        if (pinch === null || view === null) return;
        const rect = shell.getBoundingClientRect();
        const [a, b] = [event.touches[0], event.touches[1]];
        const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        // Recompute from the gesture's start each move, so the level follows
        // the finger spread absolutely — no per-event drift.
        applyZoom(
          zoomAround(
            pinch.startView,
            distance / pinch.startDistance,
            pinch.cursorOffset,
            rect.width,
            view.duration,
          ),
          view.pxPerSec,
        );
        return;
      }
      if (event.touches.length === 1) {
        // One finger pans the content (the browser keeps vertical page
        // scroll; the horizontal content scroll is ours). The pan engages on
        // a clearly horizontal drag — the same slop that cancels a
        // long-press — and a pan is not a tap, so no trailing click-seek.
        const pan = panRef.current;
        if (pan === null) return;
        const touch = event.touches[0];
        const dx = touch.clientX - pan.startX;
        const dy = touch.clientY - pan.startY;
        if (!pan.active) {
          if (Math.abs(dx) <= LONG_PRESS_SLOP_PX || Math.abs(dx) <= Math.abs(dy)) return;
          pan.active = true;
        }
        event.preventDefault();
        shell.scrollLeft = clampScrollLeft(
          pan.startScrollLeft - dx,
          shell.getBoundingClientRect().width,
          pan.duration,
          pan.pxPerSec,
        );
      }
      // Three-plus fingers: keep the running gesture; nothing to do.
    };

    const onPinchEnd = (event: TouchEvent): void => {
      if (event.touches.length < 2) {
        pinchRef.current = null;
        panRef.current = null;
      }
    };

    // The single-finger pan's origin — armed on every one-finger touchstart,
    // alongside the long-press timer it can cancel.
    const onPanStart = (event: TouchEvent): void => {
      if (event.touches.length !== 1) return;
      const view = viewRef.current;
      if (view === null) return;
      const touch = event.touches[0];
      panRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        startScrollLeft: shell.scrollLeft,
        pxPerSec: view.pxPerSec,
        duration: view.duration,
        active: false,
      };
    };

    shell.addEventListener('wheel', onWheel, { passive: false });
    shell.addEventListener('touchstart', onPinchStart, { passive: false });
    shell.addEventListener('touchstart', onPanStart);
    shell.addEventListener('touchmove', onPinchMove, { passive: false });
    shell.addEventListener('touchend', onPinchEnd);
    shell.addEventListener('touchcancel', onPinchEnd);
    return () => {
      shell.removeEventListener('wheel', onWheel);
      shell.removeEventListener('touchstart', onPinchStart);
      shell.removeEventListener('touchstart', onPanStart);
      shell.removeEventListener('touchmove', onPinchMove);
      shell.removeEventListener('touchend', onPinchEnd);
      shell.removeEventListener('touchcancel', onPinchEnd);
    };
  }, [cancelLongPress]);

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
        ref={shellRef}
        className="player-waveform-shell"
        onClickCapture={onClickCapture}
        onDoubleClick={onDoubleClick}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={cancelLongPress}
        onTouchCancel={cancelLongPress}
      >
        <div
          ref={containerRef}
          className="player-waveform"
          style={viewWidth !== undefined ? { width: `${viewWidth}px` } : undefined}
        />
        <MarkerFlags
          markers={labeled}
          duration={duration}
          selectedId={selectedId}
          onSelect={select}
          width={viewWidth}
        />
        {/* pointer-events: none — clicks pass through to the seek surface. */}
        <div
          className="player-playhead"
          style={{ left: `${playheadLeft}px` }}
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
          onClick={() => addAtPlayhead()}
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
