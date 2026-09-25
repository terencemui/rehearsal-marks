import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useShiftHeld } from './useShiftHeld';

/**
 * The held state the correction decks read (T71).
 *
 * It is read from the keyboard rather than from the click that follows it,
 * because the decks say what they will do *before* the press — and a state that
 * can only be read off a click can only be read too late. What the tests below
 * pin is that it is a fact about the keyboard *now*, whatever route the events
 * took to say so: a key-up that never arrives cannot leave a control promising
 * a whole second it will not take.
 */

/** A key event of the kind the window hears, dispatched at the window. */
function press(type: 'keydown' | 'keyup', key: string, shiftKey: boolean): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent(type, { key, shiftKey, bubbles: true }));
  });
}

describe('useShiftHeld', () => {
  it('starts false, and follows Shift down and up', () => {
    const { result } = renderHook(() => useShiftHeld());
    expect(result.current).toBe(false);

    press('keydown', 'Shift', true);
    expect(result.current).toBe(true);

    press('keyup', 'Shift', false);
    expect(result.current).toBe(false);
  });

  it('reads Shift off whichever key is pressed, not off Shift alone', () => {
    // The student holds Shift and then presses a bracket, a letter, anything:
    // each of those key events carries the modifier's state with it, so the
    // decks are right whether or not Shift's own key events were seen.
    const { result } = renderHook(() => useShiftHeld());

    press('keydown', ']', true);
    expect(result.current).toBe(true);
  });

  it('forgets a Shift whose key-up never arrived', () => {
    // The event that goes missing is the one holding the state up: a key-up
    // swallowed by a browser dialog, an embed taking the keyboard, a chord the
    // OS claimed. The next key event of any kind says what is actually held, so
    // the stranded state cannot outlive it.
    const { result } = renderHook(() => useShiftHeld());

    press('keydown', 'Shift', true);
    expect(result.current).toBe(true);

    press('keydown', 'a', false);
    expect(result.current).toBe(false);
  });

  it('takes Shift’s own key-up at its word, whatever modifier state it reports', () => {
    // Browsers disagree about the `shiftKey` a Shift key-up carries — Chrome
    // reports the key as no longer held, and others report it still held
    // because the event is the modifier's own. The key-up of Shift is the one
    // event that means the key came up, so it is read as that.
    const { result } = renderHook(() => useShiftHeld());

    press('keydown', 'Shift', true);
    press('keyup', 'Shift', true);
    expect(result.current).toBe(false);
  });

  it('drops the held state when the window loses focus', () => {
    // Clicking out of the window, or into another application: no key-up is
    // ever heard, so a control left claiming a whole second would go on saying
    // it while the student is somewhere else entirely.
    const { result } = renderHook(() => useShiftHeld());

    press('keydown', 'Shift', true);
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(result.current).toBe(false);
  });
});
