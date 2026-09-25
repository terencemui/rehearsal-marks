import { describe, expect, it } from 'vitest';
import {
  NUDGE_COARSE_STEP_SECONDS,
  NUDGE_HALF_STEP_SECONDS,
  NUDGE_STEP_SECONDS,
} from '../domain';
import type { NudgeControl } from './nudgeControls';
import { nudgeControls } from './nudgeControls';

/**
 * The four controls the active row's correction decks carry (T71), as a
 * function of whether `Shift` is held.
 *
 * jsdom computes no layout, so the strip's order and the pairing of each label
 * with the step it takes are read here, where the four are defined, rather than
 * off the rendered decks — and they are read once, so no call site can assemble
 * a second copy of them that says something else.
 */

/**
 * What a label promises, in seconds: `−0.5s` reads as -0.5. The label is the
 * only thing a student is told before the press, so reading it back as a number
 * is how the promise is held against what the press does.
 */
function promised(label: string): number {
  return Number(label.replace('−', '-').replace(/s$/, ''));
}

/** The four labels, in the order the decks read them from left to right. */
function labels(controls: readonly NudgeControl[]): string[] {
  return controls.map((control) => control.label);
}

describe('nudgeControls', () => {
  it('reads the halves outboard and the tenths inboard, minus side first', () => {
    // The row above sits between two decks: the whole strip reads
    // `−0.5s −0.1s +0.1s +0.5s`, so the coarse steps are the outer pair and the
    // fine ones sit next to the time they move.
    expect(labels(nudgeControls(false))).toEqual(['−0.5s', '−0.1s', '+0.1s', '+0.5s']);
  });

  it('carries the domain’s own steps, signed and paired with their labels', () => {
    expect(nudgeControls(false).map((control) => control.delta)).toEqual([
      -NUDGE_HALF_STEP_SECONDS,
      -NUDGE_STEP_SECONDS,
      NUDGE_STEP_SECONDS,
      NUDGE_HALF_STEP_SECONDS,
    ]);
    expect(nudgeControls(false).map((control) => control.direction)).toEqual([-1, -1, 1, 1]);
  });

  it('makes the outer pair a whole second while Shift is held, label and step together', () => {
    const shifted = nudgeControls(true);
    expect(labels(shifted)).toEqual(['−1s', '−0.1s', '+0.1s', '+1s']);
    expect(shifted.map((control) => control.delta)).toEqual([
      -NUDGE_COARSE_STEP_SECONDS,
      -NUDGE_STEP_SECONDS,
      NUDGE_STEP_SECONDS,
      NUDGE_COARSE_STEP_SECONDS,
    ]);
    // Still a pair of earlier controls then a pair of later ones: the decks do
    // not swap sides as the labels change, so nothing moves under the pointer.
    expect(shifted.map((control) => control.direction)).toEqual([-1, -1, 1, 1]);
  });

  it('leaves the tenths alone whatever is held — the fine step wants no coarse twin', () => {
    expect(nudgeControls(true).slice(1, 3)).toEqual(nudgeControls(false).slice(1, 3));
    expect(labels(nudgeControls(true)).slice(1, 3)).toEqual(['−0.1s', '+0.1s']);
  });

  it('promises on every label exactly the step the press takes, in both states', () => {
    // The whole reason the state is read once (T71): a control that took its
    // label from one reading and its step from another could promise a whole
    // second and take a tenth — which is what a tooltip about a hidden modifier
    // did, and what nothing on the control could contradict before the press.
    for (const control of [...nudgeControls(false), ...nudgeControls(true)]) {
      expect(promised(control.label)).toBeCloseTo(control.delta);
    }
  });
});
