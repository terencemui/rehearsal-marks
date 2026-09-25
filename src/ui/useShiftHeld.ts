import { useEffect, useState } from 'react';

/**
 * Whether `Shift` is held right now — the state the correction decks read
 * before a press (T71).
 *
 * It is a fact about the keyboard rather than about the click, because the
 * decks say what they will do *before* they are pressed: the outer pair reads
 * `±0.5s` and, while `Shift` is down, `±1s`, and the press takes whichever the
 * label showed. A state that could only be read off the click could only be
 * read too late to write it down.
 *
 * Three things keep what it reports true:
 *
 * - Every key event carries the modifier state with it, so any key event at all
 *   re-answers the question. A key-up that never arrived — a browser dialog, an
 *   embed taking the keyboard, a chord the OS claimed — is corrected by the
 *   next key of any kind, and cannot strand a control promising a whole second.
 * - `Shift`'s own key-up is read as the key coming up, whatever modifier state
 *   it reports. Browsers disagree about that field on the modifier's own event.
 * - The window losing focus drops it outright. The student has left; no key-up
 *   is ever coming, and a deck that kept saying `±1s` would be describing a
 *   keyboard nobody is at.
 *
 * The listener is on the window, as the player's own shortcuts are, so no
 * focus or click has to land anywhere in particular for the decks to be right —
 * which is the point, since the whole gesture is "hold this, then click".
 *
 * It is called once, by the page, and the value is handed down (`MarkersAuthoring.shiftHeld`)
 * rather than read by each deck. The decks are not the surface that stays
 * mounted: they follow the playhead, so they are unmounted from one row and
 * mounted on the next while the student works, and state that lived in them
 * would start again at `false` on every row — the decks would read `±0.5s` with
 * `Shift` still down. A fact about the keyboard belongs to the surface that
 * outlives the rows, and the page is that surface.
 */
export function useShiftHeld(): boolean {
  const [held, setHeld] = useState(false);

  useEffect(() => {
    const read = (event: KeyboardEvent): void => {
      // The modifier's own event is about the modifier: a key-up of `Shift` is
      // `Shift` coming up, and some browsers report it with `shiftKey` still
      // set because the event belongs to the key that is leaving.
      if (event.key === 'Shift') setHeld(event.type === 'keydown');
      else setHeld(event.shiftKey);
    };
    const forget = (): void => setHeld(false);

    window.addEventListener('keydown', read);
    window.addEventListener('keyup', read);
    window.addEventListener('blur', forget);
    return () => {
      window.removeEventListener('keydown', read);
      window.removeEventListener('keyup', read);
      window.removeEventListener('blur', forget);
    };
  }, []);

  return held;
}
