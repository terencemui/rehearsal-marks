import {
  NUDGE_COARSE_STEP_SECONDS,
  NUDGE_HALF_STEP_SECONDS,
  NUDGE_STEP_SECONDS,
} from '../domain';

/**
 * One control of a correction deck: which way it moves the row, the step it
 * takes, and the words it shows.
 */
export interface NudgeControl {
  /** Which way the row moves — and so which deck the control belongs to. */
  direction: -1 | 1;
  /** The seconds the press writes, signed. */
  delta: number;
  /** What the control reads, which is what it will do. */
  label: string;
}

/**
 * What a step reads as: `−0.5s`, `+1s`. The minus is the typographic one the
 * rest of the page sets times in, not a hyphen.
 */
function stepLabel(delta: number): string {
  return `${delta < 0 ? '−' : '+'}${Math.abs(delta)}s`;
}

/** One control, its label drawn from the step it takes rather than beside it. */
function control(delta: number): NudgeControl {
  return { direction: delta < 0 ? -1 : 1, delta, label: stepLabel(delta) };
}

/**
 * The four nudge controls the active row's decks carry (T71), in the order the
 * strip reads them: the minus deck, then the plus deck, and within each the
 * half outboard of the tenth. Laid out flat, the row above them reads as the
 * time between `−0.5s −0.1s` and `+0.1s +0.5s`.
 *
 * They are defined here, once, because they are four facts that have to agree
 * with each other — which way each moves the row, how far, and what it says —
 * and four call sites assembling their own copy is four chances for a label to
 * drift from the step beside it.
 *
 * `shiftHeld` is read once and answers both halves of every control: the step
 * it takes and the words it shows. With `Shift` held the outer pair becomes a
 * whole second and says so (`−1s`, `+1s`), and the tenths do not move — the
 * fine step wants no coarse twin, and with the halves widened there is nothing
 * left for a widened tenth to be. A student therefore cannot be told one thing
 * and given another, which a tooltip about a hidden modifier could and did: the
 * old controls read `Shift` off the click itself, so nothing on them could say
 * what they would do before the press that did it.
 *
 * It is pure, and takes the held state as a value rather than reading the
 * keyboard, so what the decks say is decided here and not by the events that
 * happen to be in flight. Reading the keyboard is `useShiftHeld`'s job.
 */
export function nudgeControls(
  shiftHeld: boolean,
): [NudgeControl, NudgeControl, NudgeControl, NudgeControl] {
  const coarse = shiftHeld ? NUDGE_COARSE_STEP_SECONDS : NUDGE_HALF_STEP_SECONDS;
  return [
    control(-coarse),
    control(-NUDGE_STEP_SECONDS),
    control(NUDGE_STEP_SECONDS),
    control(coarse),
  ];
}
