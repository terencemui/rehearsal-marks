import { DomainError } from './errors';

/**
 * Parses the loose formats users type into the marker time field and
 * normalizes them to float seconds:
 *
 * - `310.5` — seconds
 * - `5:10.5` — minutes and seconds, colon- or space-separated (`5 10.5`)
 * - `1:05:10.5` — hours, minutes, seconds (same separators)
 *
 * Lenient on purpose: minutes and seconds beyond 59 are accepted, so typing
 * a timestamp never fights a strict format. Anything outside these shapes is
 * rejected — a dangling separator (`5:`) is a typo, not a time.
 */
export function parseTime(input: string): number {
  const trimmed = input.trim();

  // 1–3 numeric groups separated by runs of colons or spaces (a double
  // spacebar shouldn't fight the format); only the final group may carry a
  // fraction.
  const validShape =
    /^(?:\d+(?:\.\d+)?|\d+[: ]+\d+(?:\.\d+)?|\d+[: ]+\d+[: ]+\d+(?:\.\d+)?)$/;
  if (!validShape.test(trimmed)) {
    throw invalidTime(trimmed);
  }

  const [a, b, c] = trimmed.split(/[: ]+/).map(parseFloat);

  let seconds: number;
  if (b === undefined) {
    seconds = a;
  } else if (c === undefined) {
    seconds = a * 60 + b;
  } else {
    seconds = a * 3600 + b * 60 + c;
  }

  if (!Number.isFinite(seconds)) {
    throw invalidTime(trimmed);
  }
  return seconds;
}

function invalidTime(input: string): DomainError {
  return new DomainError(
    `Invalid time "${input}". Use seconds like "310.5", or clock formats like "5:10.5", "1:05:10", or "5 10".`,
    'invalid-time-format',
  );
}

/**
 * Renders a marker timestamp the way the spec displays them: `mm:ss.mmm`,
 * or `h:mm:ss.mmm` once the recording reaches an hour (the recording's
 * duration picks the shape, so every timestamp on one project reads alike).
 * Times are rounded to the displayed millisecond — the full float lives in
 * the marker; this is display-only. Negative times clamp to zero rather than
 * rendering a sign.
 */
export function formatTime(seconds: number, duration: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;

  const mm = String(minutes).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  const mmm = String(ms).padStart(3, '0');

  return duration >= 3600 ? `${hours}:${mm}:${ss}.${mmm}` : `${mm}:${ss}.${mmm}`;
}

/**
 * Renders a timestamp in whole seconds — `mm:ss`, or `h:mm:ss` once the
 * recording reaches an hour — the display twin of {@link formatTime} for
 * reading from a music stand. The recording's duration picks the shape just
 * as it does for the millisecond formatter, so every timestamp on one project
 * reads alike. Times round to the nearest second; the full float lives in the
 * marker; this is display-only. Negative times clamp to zero rather than
 * rendering a sign.
 */
export function formatWholeSeconds(seconds: number, duration: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  const mm = String(minutes).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');

  return duration >= 3600 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
