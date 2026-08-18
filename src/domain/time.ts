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
