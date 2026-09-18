import { useEffect, useRef } from 'react';
import type { AudioController } from '../audio';
import { nextMarker, previousMarker } from '../domain';
import type { LabeledMarker } from '../domain';

export interface PlayerKeysOptions {
  /** The session's controller — every shortcut acts on it. */
  controller: AudioController;
  /** Markers with derived labels, in time order — what ↑/↓ walk. */
  markers: LabeledMarker[];
  /**
   * Whether the recording's load has settled. Before it does there is nothing
   * to play, seek, or jump to, so every shortcut is inert.
   */
  settled: boolean;
  /**
   * What `M` does — placing a mark at the playhead. Supplied only by the
   * markings page (T56), where adding is the job; the practice surface and the
   * read-only view pass nothing and the key is simply absent, so the surfaces
   * that may not author carry no authoring key at all.
   */
  onAddMarker?: () => void;
}

/**
 * The playback shortcuts both player surfaces share (T55): Space to
 * play/pause, ←/→ to seek ∓5s, ↑/↓ to walk the marks (wrapping). They are the
 * keys the practice surface has carried since playback-only (T39), lifted out
 * of it so the markings page plays a recording exactly as the practice surface
 * does without either surface owning a copy of the handler.
 *
 * The handler is registered once at the window and reads the latest values
 * through a ref reassigned every render, so a shortcut always sees the current
 * marks and playhead without re-registering per tick.
 *
 * `Alt` and the arrows stay the browser's — the marker nudge is not here, so
 * Alt+← is the browser's Back again, an accepted consequence of playback-only
 * — and `Shift`+arrows stay the browser's too (scroll, selection).
 *
 * One key is the markings page's alone: `M` places a mark at the playhead, and
 * only a caller that supplies `onAddMarker` — the page where authoring is the
 * job (T56) — hears it. The practice surface's copy of this hook carries no
 * adding key and no way to author, which is the point of it being optional.
 */
export function usePlayerKeys({
  controller,
  markers,
  settled,
  onAddMarker,
}: PlayerKeysOptions): void {
  const keyDownRef = useRef<(event: KeyboardEvent) => void>(() => {});
  keyDownRef.current = (event: KeyboardEvent) => {
    // One action per press: holding a key repeats the event at the OS repeat
    // rate, which would storm seeks and marker jumps.
    if (event.repeat) return;
    const target = event.target;
    // Shortcuts are suppressed while focus is in a text input. Space gets one
    // extra exception: a focused button owns it through native activation —
    // handling it too would toggle twice.
    const inTextInput =
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable);

    if (inTextInput) return;
    // Before the recording settles there is nothing to play, seek, or jump to
    // — the shortcuts are inert until then. The load takes a moment; a Space
    // pressed into it would otherwise be swallowed against a dead embed.
    if (!settled) return;

    if (event.key === ' ') {
      // A focused button owns Space through native activation — handling it
      // too would toggle twice.
      if (target instanceof HTMLElement && target.tagName === 'BUTTON') {
        return;
      }
      event.preventDefault();
      controller.togglePlay();
      return;
    }

    // Arrows are plain chords only: Shift+arrows stay the browser's (scroll,
    // selection), and Alt+arrows do too — the marker nudge is gone, so Alt+←
    // is the browser's Back again, an accepted consequence of playback-only.
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    const plainArrows = plain && !event.shiftKey;

    // The one authoring key, on the one surface that authors (T56): `M` places
    // a mark at the playhead and touches nothing else, so the student hears the
    // landmark and keeps listening. A plain chord only — ⌘M minimises the
    // window on macOS — and unclaimed since ADR-0005 removed the A–Z letter
    // jumps.
    if (plain && onAddMarker !== undefined && event.key.toLowerCase() === 'm') {
      onAddMarker();
      return;
    }

    if (plainArrows && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      // Plain arrows seek ∓5s from the live playhead — the store's value can
      // trail the audible position by a timeupdate interval.
      event.preventDefault();
      controller.seek(controller.getCurrentTime() + (event.key === 'ArrowLeft' ? -5 : 5));
      return;
    }
    if (plainArrows && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      // ↑/↓ jump between markers anchored at the live playhead, wrapping at
      // the ends. Jumping never selects and never touches playback state. A
      // key with nothing to jump to is left alone, so arrow scrolling still
      // works.
      const anchor = controller.getCurrentTime();
      const target =
        event.key === 'ArrowDown' ? nextMarker(markers, anchor) : previousMarker(markers, anchor);
      if (target === null) return;
      event.preventDefault();
      controller.seek(target.time);
      return;
    }
  };

  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyDownRef.current(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
}
