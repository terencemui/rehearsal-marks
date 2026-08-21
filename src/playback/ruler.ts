/**
 * The timeline's math, shared by every playback backend. Kept pure
 * so each backend adapter stays a thin one: tick spacing and label format are
 * settled here, and the renderer below only has to draw the result.
 */

/** Candidate label spacings, seconds — the first that fits is used. */
const TICK_INTERVALS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600];

/** One labeled tick on the ruler. */
export interface RulerTick {
  /** Seconds from the recording start. */
  time: number;
  /** Display label for the tick. */
  label: string;
}

/**
 * Evenly spaced ticks for a recording's duration, using the coarsest
 * candidate interval that yields at most 10 labels. A missing or unknown
 * duration — 0, negative, or Infinity from a stream whose length the media
 * element cannot report — renders a single zero tick instead of a loop
 * that can never terminate.
 */
export function rulerTicks(duration: number): RulerTick[] {
  if (!Number.isFinite(duration) || duration <= 0) {
    return [{ time: 0, label: formatRulerTime(0) }];
  }
  const interval = TICK_INTERVALS.find((candidate) => duration / candidate <= 10) ?? 3600;
  const ticks: RulerTick[] = [];
  for (let step = 0; step * interval <= duration; step++) {
    const time = step * interval;
    ticks.push({ time, label: formatRulerTime(time) });
  }
  return ticks;
}

/** m:ss below an hour, h:mm:ss from an hour up. Labels are whole seconds. */
export function formatRulerTime(seconds: number): string {
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`;
}
