import { describe, expect, it } from 'vitest';
import type { Movement } from './movement';
import { movementForTime } from './movement';

/** The ADR-0005 boundary model: start-only, strictly increasing starts. */
function movements(): Movement[] {
  return [
    { id: 'm1', name: 'I. Allegro', start: 0 },
    { id: 'm2', name: 'II. Adagio', start: 831 },
    { id: 'm3', name: 'III. Finale', start: 1620 },
  ];
}

describe('movementForTime', () => {
  it('returns the latest movement whose start is at or before the time', () => {
    const ms = movements();

    expect(movementForTime(ms, 0)?.id).toBe('m1');
    expect(movementForTime(ms, 830)?.id).toBe('m1');
    expect(movementForTime(ms, 831)?.id).toBe('m2');
    expect(movementForTime(ms, 1619.9)?.id).toBe('m2');
    expect(movementForTime(ms, 9999)?.id).toBe('m3');
  });

  it('returns null before the first movement — those markers are orphans', () => {
    // The first movement starts at 30, so markers before it belong to no movement.
    const ms = [{ id: 'm1', name: 'I. Allegro', start: 30 }, ...movements().slice(1)];

    expect(movementForTime(ms, 0)).toBeNull();
    expect(movementForTime(ms, 29.9)).toBeNull();
    expect(movementForTime(ms, 30)?.id).toBe('m1');
  });

  it('returns null when there are no movements', () => {
    expect(movementForTime([], 10)).toBeNull();
  });
});
