import { useEffect, useRef } from 'react';
import type { AudioController } from '../audio';
import {
  nextMarker,
  previousMarker,
  NUDGE_COARSE_STEP_SECONDS,
  NUDGE_STEP_SECONDS,
} from '../domain';
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
  /**
   * What `[` and `]` do — nudging the mark being corrected by `delta` seconds,
   * negative for earlier (T57). Supplied only by the markings page, where a mark
   * can be corrected; the practice surface and the read-only view pass nothing
   * and the keys are simply absent, so the surfaces that may not change a mark
   * carry no key that could.
   */
  onNudge?: (delta: number) => void;
  /**
   * What a walk with ↑/↓ landed on, beside the jump itself (T57). The markings
   * page takes the mark it reached as the one being corrected, so a correction
   * is reachable without a pointer. A surface that passes nothing keeps the walk
   * bare: jumping never selects (ADR-0003).
   */
  onWalk?: (marker: LabeledMarker) => void;
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
 * `Alt` and the arrows stay the browser's — Alt+← is the browser's Back on
 * Windows and Linux, an accepted consequence of playback-only — and
 * `Shift`+arrows stay the browser's too (scroll, selection).
 *
 * The markings page's own keys are the ones this hook binds and no other
 * surface hears, because each arrives as a callback only that page supplies:
 * `M` places a mark at the playhead (T56), and `[`/`]` nudge the mark being
 * corrected (T57). The practice surface's copy carries no adding key and no
 * correcting key, which is the point of both being optional.
 */
export function usePlayerKeys({
  controller,
  markers,
  settled,
  onAddMarker,
  onNudge,
  onWalk,
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

    // Plain chords: no modifier that means something else to the browser or the
    // operating system. `Shift` is not one of them — it is the correction keys'
    // own coarse step, and the arrows exclude it separately.
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;

    // The correction keys, on the one surface that corrects (T57): `[` nudges
    // the mark being corrected a tenth of a second earlier and `]` the same
    // later, either by a whole second with Shift. A shifted bracket reaches the
    // page as `{` or `}` on most layouts, so both spellings are the same key and
    // Shift is read for the step rather than the key.
    //
    // Deliberately above the settle gate below: a correction moves a mark the
    // record already holds and asks the recording for nothing, so it is not held
    // back by a load it does not depend on — and the block's own nudge controls
    // would otherwise work while their keys did not.
    if (plain && onNudge !== undefined) {
      const direction =
        event.key === '[' || event.key === '{' ? -1 : event.key === ']' || event.key === '}' ? 1 : 0;
      if (direction !== 0) {
        event.preventDefault();
        onNudge(direction * (event.shiftKey ? NUDGE_COARSE_STEP_SECONDS : NUDGE_STEP_SECONDS));
        return;
      }
    }

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

    // Shift+arrows stay the browser's (scroll, selection), and Alt+arrows do
    // too — Alt+← is the browser's Back on Windows and Linux, an accepted
    // consequence of playback-only.
    const plainArrows = plain && !event.shiftKey;

    // The one authoring key, on the one surface that authors (T56): `M` places
    // a mark at the playhead and touches nothing else, so the student hears the
    // landmark and keeps listening. A plain chord only — ⌘M minimises the
    // window on macOS — and unclaimed since ADR-0005 removed the A–Z letter
    // jumps. It is a playhead gesture, so it waits for the recording like the
    // rest of the keys above it.
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
      // the ends. Jumping never touches playback state, and it never selects —
      // except where a caller asks to hear about the landing (T57). A key with
      // nothing to jump to is left alone, so arrow scrolling still works.
      const anchor = controller.getCurrentTime();
      const target =
        event.key === 'ArrowDown' ? nextMarker(markers, anchor) : previousMarker(markers, anchor);
      if (target === null) return;
      event.preventDefault();
      controller.seek(target.time);
      onWalk?.(target);
      return;
    }
  };

  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyDownRef.current(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
}
