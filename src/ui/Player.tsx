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
import { defaultPlayerMode } from '../storage';
import type { Autosave, PlayerMode, ProjectRecord, SaveStatus } from '../storage';
import { MarkerFlags } from './MarkerFlags';
import { MarkerInspector } from './MarkerInspector';
import { PracticeReadout } from './PracticeReadout';
import { STATUS_TEXT } from './status';
import { UndoToast } from './UndoToast';
import {
  ZOOM_STEP,
  clampScrollLeft,
  contentWidth,
  fitPxPerSec,
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
  /**
   * When set, the player streams this URL instead of the record's audio
   * blob: the library's first load, where playback must start while the
   * download still runs. The record's blob is still persisted behind the
   * scenes, but the stream itself keeps playing uninterruptedly.
   */
  streamUrl?: string | null;
  /** Replaces the ruler note (the library stream explains itself differently). */
  rulerNote?: string;
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

/**
 * What a YouTube project's ruler says instead of the waveform note. The embed
 * reports its playhead on a coarse clock and lands seeks at segment
 * granularity, so a mark taken *from the player* inherits that slack — while a
 * typed time or a nudge edits the marker's own time and stays exact. Saying so
 * is the difference between a tool that feels imprecise and one that is honest
 * about which of its numbers are approximate.
 */
const YOUTUBE_RULER_NOTE =
  'Playing from YouTube — no waveform, and the embed’s clock is coarse: marks taken from the ' +
  'playhead and click-to-seek land within about a quarter second. Typed times and nudges stay exact.';

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
 * timeline, and the project still exports.
 */
const YOUTUBE_FAILED_EXPLANATION =
  'This YouTube video couldn’t be played — it may be private, removed, region-blocked, ' +
  'or unavailable for embedding. Your marks are still here, and the project still exports.';

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
 *
 * T18 modes: every project has a Playback | Label posture, seeded from the
 * record's persisted `playerMode` (each source's default on first open) and
 * written back on every switch. Playback mode is navigation-only — the
 * read-only posture of a practice session — so every editing tool (M,
 * double-click and long-press adds, the Add marker button, nudges, typed
 * times, aliases, delete with undo, Esc deselect, flag-click selection) is
 * gated behind Label mode; the keyboard scheme, flag jumps, and the volume
 * slider work in both. A selection made in Label mode survives a posture
 * switch but stays hidden — and Delete cannot reach it — while practicing.
 */
export function Player({
  autosave,
  peaks,
  controller,
  streamUrl = null,
  rulerNote,
  onExit,
}: PlayerProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<RenderMode | null>(null);
  /**
   * Whether the load reported that the source cannot play. The audio layer
   * publishes this on `LoadResult.error`; a player that ignored it would show
   * a live-looking transport over a dead embed.
   */
  const [loadFailed, setLoadFailed] = useState(false);
  /** Bumped by the failure card's Retry — re-runs the load effect. */
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [status, setStatus] = useState<SaveStatus>(() => autosave.status());
  // The record's identity — name, source, and audio — never changes in the player.
  const record = autosave.get();
  /**
   * A YouTube project: the video is the main item and the ruler sits under it,
   * so the timeline is always fitted to the viewport — never zoomed, which
   * would stretch the embed off-screen. Its canonical URL is the recording
   * identity the audio layer plays from.
   */
  const isYouTube = record.source === 'youtube';
  const youtubeUrl = record.audioMeta.source;
  // The record as React state. Every mutation goes through `update`, which
  // applies it to the autosave and mirrors the result back here, so flags,
  // labels, and the inspector render from the same record that persists.
  const [current, setCurrent] = useState<ProjectRecord>(record);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // T18. The player's posture, seeded from the record's last-used mode and
  // persisted on every switch. A record saved before the field existed has
  // none — its first open applies the source-dependent default, exactly as
  // creation stamps it. `editing` is the one gate every editing tool reads;
  // navigation never does.
  const [playerMode, setPlayerMode] = useState<PlayerMode>(
    record.playerMode ?? defaultPlayerMode(record.source, record.markers.length),
  );
  const editing = playerMode === 'label';
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
    const width = shell.getBoundingClientRect().width;
    setPxPerSec(isYouTube ? fitPxPerSec(width, duration) : minPxPerSec(width, duration));
  }, [duration, isYouTube, pxPerSec]);

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
        const width = shell.getBoundingClientRect().width;
        // A YouTube timeline is always exactly the viewport, so a resize
        // re-fits in both directions; a zoomable one only ever rises to the
        // new minimum, leaving the user's chosen level alone.
        if (isYouTube) return fitPxPerSec(width, duration);
        const min = minPxPerSec(width, duration);
        return level < min ? min : level;
      });
    });
    observer.observe(shell);
    return () => observer.disconnect();
  }, [duration, isYouTube]);

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

  /**
   * A flag click: always jump to the marker — navigation exists in both
   * postures — but select it for nudge/delete only in Label mode. Playback
   * mode's clicks never touch the (hidden) selection.
   */
  function handleFlagClick(marker: LabeledMarker): void {
    controller.seek(marker.time);
    // Jumps always bring the target into view.
    revealTime(marker.time);
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
    if (mode === null) return;

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
      // Jumps always bring the target into view (T08) — the zoomed view
      // must never leave the jumped-to marker off-screen.
      revealTime(target.time);
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
        revealTime(target.time);
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

  // The record's blob, read through a ref so the load effect's dependencies
  // don't include it: while a url stream is active, the blob landing
  // mid-stream must not re-run the load and restart playback.
  const audioBlobRef = useRef(record.audio);
  audioBlobRef.current = record.audio;

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    let cancelled = false;
    controller
      .load(
        // The load options are source-discriminated exactly like the record:
        // a YouTube project has only its canonical URL to play from — no
        // blob, no peaks — and the audio layer owns everything after that.
        isYouTube
          ? {
              source: 'youtube',
              url: youtubeUrl,
              container,
              // The stored duration is the failure state's timeline: a dead
              // embed reports nothing, so the ruler and the marks that ride
              // on it render from the last honest length the record has.
              duration: autosave.get().audioMeta.duration,
            }
          : {
              source: 'upload',
              blob: streamUrl !== null ? null : audioBlobRef.current,
              url: streamUrl,
              container,
              peaks,
            },
      )
      .then((result) => {
        if (cancelled) return;
        setMode(result.mode);
        setLoadFailed(result.error !== undefined);
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
        if (!cancelled) {
          setMode('ruler');
          // A rejected YouTube load is a dead source, not a ruler fallback —
          // the card must return rather than leaving live-looking controls
          // over an embed that failed again. Uploads never set the flag (their
          // rejection path falls back to a playing ruler).
          if (isYouTube) setLoadFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
    // `streamUrl` is the load's only changing target: the blob is a ref
    // (uploads never change it mid-session) so a stream stays uninterrupted.
    // The source and its URL are fixed for the life of a session; `loadAttempt`
    // is the failure card's retry, the one deliberate re-run of the whole load.
  }, [autosave, controller, isYouTube, loadAttempt, peaks, streamUrl, update, youtubeUrl]);

  /** The failure card's retry: back to loading, then a fresh load attempt. */
  function retryLoad(): void {
    setMode(null);
    setLoadFailed(false);
    setLoadAttempt((attempt) => attempt + 1);
  }

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

  /** The note under a ruler-only timeline, when the caller supplied none. */
  function defaultRulerNote(): string {
    // The failure card carries its own explanation; this note only ever
    // describes working playback.
    if (isYouTube) return YOUTUBE_RULER_NOTE;
    return 'Waveform unavailable — the timeline still works.';
  }

  function onDoubleClick(event: React.MouseEvent): void {
    // Flags stop their own double-clicks from reaching here (a flag
    // double-click is just two flag clicks) — this runs only on the surface.
    // Playback mode adds nothing: the double-click's clicks still seek
    // through the surface, which is exactly its navigation-only meaning.
    // A source that cannot play is muted the same way — no marks from a dead
    // clock, while the clicks keep their seek meaning. `mode === null` also
    // guards the retry window: after the failure card's Retry resets the
    // load, a stale zoom view must not accept adds before the new load
    // settles.
    if (!editing || loadFailed || mode === null) return;
    const time = timeAtClientX(event.clientX);
    if (time !== null) addAt(time);
  }

  function onTouchStart(event: React.TouchEvent): void {
    if (event.touches.length !== 1) return;
    // Flags stop their own touches from reaching here; the surface is clear.
    // Any stale suppression from an earlier gesture ends here — even in
    // Playback mode, where the long-press below never arms, a lingering
    // guard must not eat a practice session's next seek click.
    suppressNextClick.current = false;
    // Playback mode adds nothing; a long-press there is just a pause before
    // the seek the trailing click performs. A dead source is muted the same
    // way — no marks from a clock that is not playing anything — and the
    // retry window (`mode === null`) stays muted too.
    if (!editing || loadFailed || mode === null) return;
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

  // The seek surface plus its overlays, shared by both layouts: the
  // practice split view on a YouTube project, or the plain shell elsewhere.
  const timelineShell = (
    <div
      ref={shellRef}
      className={isYouTube ? 'player-waveform-shell youtube-shell' : 'player-waveform-shell'}
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
        selectedId={editing ? selectedId : null}
        onFlagClick={handleFlagClick}
        width={viewWidth}
      />
      {/* pointer-events: none — clicks pass through to the seek surface. */}
      <div
        className="player-playhead"
        style={{ left: `${playheadLeft}px` }}
        aria-hidden="true"
      />
    </div>
  );

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
    // A YouTube timeline has no zoom to gesture at — it is always exactly the
    // viewport — so the listeners are never registered and the browser keeps
    // its own pinch and scroll over the embed.
    if (isYouTube) return;

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
  }, [cancelLongPress, isYouTube]);

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
      {loadFailed && isYouTube && (
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
      {isYouTube ? (
        // T27: the practice split view — the video (with its ruler and
        // markers below, and the `youtube-shell` class confining flags and
        // playhead to the ruler band) in roughly the left half, the practice
        // readout following the live playhead beside it.
        <div className="player-practice-split">
          {timelineShell}
          <PracticeReadout
            markers={labeled}
            currentTime={playback.currentTime}
            duration={duration}
          />
        </div>
      ) : (
        timelineShell
      )}
      <div className="player-transport">
        <button
          type="button"
          aria-pressed={playback.playing}
          // A source that reported it cannot play has an inert transport;
          // leaving Play enabled would promise something no click delivers.
          disabled={mode === null || loadFailed}
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
            disabled={mode === null || loadFailed}
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
      {mode === 'ruler' && !(loadFailed && isYouTube) && (
        <p className="ruler-note">
          {rulerNote ??
            (isYouTube && editing && current.markers.length === 0
              ? // One note, both truths: the missing labels and the coarse
                // clock the first mark will inherit — stacked hint paragraphs
                // would read as one warning doubled.
                `${YOUTUBE_NO_LABELS_NOTE} ${YOUTUBE_RULER_NOTE}`
              : defaultRulerNote())}
        </p>
      )}
    </main>
  );
}
