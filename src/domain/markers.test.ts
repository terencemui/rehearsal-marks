import { describe, expect, it } from 'vitest';
import { marker } from '../test/marker-fixture';
import { DomainError, type DomainErrorCode } from './errors';
import { newId } from './id';
import { deriveLabels } from './labels';
import type { Marker } from './marker';
import {
  addMarker,
  createMarker,
  moveMarker,
  removeMarker,
  setAliases,
} from './markers';

/** id → derived label, via the public API. */
function labelsOf(markers: readonly Marker[]): Record<string, string> {
  return Object.fromEntries(deriveLabels(markers).map((m) => [m.id, m.label]));
}

function expectDomainError(fn: () => unknown, code: DomainErrorCode): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    return;
  }
  expect.unreachable(`expected a DomainError with code "${code}"`);
}

describe('addMarker', () => {
  it('adds a marker out of chronological order and keeps labels dense in time order', () => {
    const markers = [marker('a', 10), marker('b', 30)];

    const next = addMarker(markers, marker('c', 20));

    expect(labelsOf(next)).toEqual({ a: 'A', c: 'B', b: 'C' });
  });

  it('rejects a non-finite or negative time', () => {
    for (const time of [NaN, Infinity, -1]) {
      expectDomainError(() => addMarker([], marker('a', time)), 'invalid-time');
    }
  });

  it('normalizes and validates aliases on add', () => {
    const next = addMarker([], marker('a', 10, ['  Recap ']));

    expect(next[0].aliases).toEqual(['Recap']);
  });

  it('rejects a marker whose aliases are invalid or duplicate on add', () => {
    const markers = [marker('a', 10), marker('b', 20, ['Recap'])]; // labels A, B

    expectDomainError(() => addMarker(markers, marker('c', 30, ['   '])), 'alias-empty');
    expectDomainError(
      () => addMarker(markers, marker('c', 30, ['x'.repeat(17)])),
      'alias-too-long',
    );
    expectDomainError(
      () => addMarker(markers, marker('c', 30, ['Recap', 'recap'])),
      'alias-duplicate',
    );
    expectDomainError(() => addMarker(markers, marker('c', 30, ['recap'])), 'alias-duplicate');
    expectDomainError(
      () => addMarker(markers, marker('c', 30, ['Recap', 'b'])),
      'alias-duplicate',
    );
  });

  it('rejects a marker whose id already exists', () => {
    expectDomainError(() => addMarker([marker('a', 10)], marker('a', 20)), 'duplicate-marker-id');
  });
});

describe('removeMarker', () => {
  it('re-labels the remaining markers densely after a delete', () => {
    const markers = [marker('a', 10), marker('b', 20), marker('c', 30), marker('d', 40)];

    const next = removeMarker(markers, 'b');

    expect(labelsOf(next)).toEqual({ a: 'A', c: 'B', d: 'C' });
  });

  it('rejects an unknown id', () => {
    expectDomainError(() => removeMarker([marker('a', 10)], 'nope'), 'marker-not-found');
  });
});

describe('moveMarker', () => {
  it('re-ranks labels when a marker moves between its neighbors', () => {
    const markers = [marker('a', 10), marker('b', 20), marker('c', 30)];

    const next = moveMarker(markers, 'a', 25);

    expect(labelsOf(next)).toEqual({ b: 'A', a: 'B', c: 'C' });
  });

  it('rejects a non-finite or negative time', () => {
    expectDomainError(() => moveMarker([marker('a', 10)], 'a', NaN), 'invalid-time');
  });

  it('rejects an unknown id', () => {
    expectDomainError(() => moveMarker([marker('a', 10)], 'nope', 5), 'marker-not-found');
  });
});

describe('mutations are immutable', () => {
  it('returns new arrays and leaves the input untouched', () => {
    const markers = [marker('a', 10), marker('b', 20)];

    addMarker(markers, marker('c', 30));
    removeMarker(markers, 'a');
    moveMarker(markers, 'b', 5);
    setAliases(markers, 'a', ['Recap']);

    expect(markers.map((m) => m.id)).toEqual(['a', 'b']);
    expect(markers[0].time).toBe(10);
    expect(markers[0].aliases).toEqual([]);
  });
});

describe('setAliases', () => {
  it('stores trimmed aliases', () => {
    const next = setAliases([marker('a', 10)], 'a', ['  Recap ', '1']);

    expect(next[0].aliases).toEqual(['Recap', '1']);
  });

  it('allows clearing all aliases', () => {
    const next = setAliases([marker('a', 10, ['Recap'])], 'a', []);

    expect(next[0].aliases).toEqual([]);
  });

  it('rejects an alias that is empty after trimming', () => {
    expectDomainError(() => setAliases([marker('a', 10)], 'a', ['   ']), 'alias-empty');
  });

  it('rejects an alias longer than 16 characters but allows exactly 16', () => {
    expectDomainError(
      () => setAliases([marker('a', 10)], 'a', ['x'.repeat(17)]),
      'alias-too-long',
    );
    expect(setAliases([marker('a', 10)], 'a', ['x'.repeat(16)])[0].aliases).toEqual([
      'x'.repeat(16),
    ]);
  });

  it('rejects duplicate aliases on the same marker, case-insensitively', () => {
    expectDomainError(
      () => setAliases([marker('a', 10)], 'a', ['Recap', 'recap']),
      'alias-duplicate',
    );
  });

  it('rejects an alias already used by another marker, case-insensitively', () => {
    const markers = [marker('a', 10), marker('b', 20, ['Recap'])];

    expectDomainError(() => setAliases(markers, 'a', ['RECAP']), 'alias-duplicate');
  });

  it('accepts an alias that matches a derived label — the collision rule is gone', () => {
    // ADR-0005: the alias-vs-label collision rule existed only to keep the A–Z
    // letter-jump keys unambiguous. With the keys gone, an alias may read as
    // another marker's label — or its own — because labels restart per movement
    // and no longer name a unique target. The only uniqueness left is among
    // aliases.
    const markers = [marker('a', 10), marker('b', 20)]; // labels A, B

    expect(setAliases(markers, 'a', ['b'])[0].aliases).toEqual(['b']);
    expect(setAliases(markers, 'a', ['A'])[0].aliases).toEqual(['A']);
  });

  it('accepts any characters within the length limit', () => {
    const next = setAliases([marker('a', 10)], 'a', ['1', '→', 'ß']);

    expect(next[0].aliases).toEqual(['1', '→', 'ß']);
  });

  it('rejects an unknown id', () => {
    expectDomainError(() => setAliases([marker('a', 10)], 'nope', ['Recap']), 'marker-not-found');
  });
});

describe('aliases never cascade', () => {
  it('leaves other markers untouched when setting aliases', () => {
    const markers = [marker('a', 10, ['Recap']), marker('b', 20, ['Dev'])];

    const next = setAliases(markers, 'b', ['Development']);

    expect(next[0].aliases).toEqual(['Recap']);
  });

  it('aliases follow their marker through deletes and re-times', () => {
    let markers = [marker('a', 10, ['Recap']), marker('b', 20), marker('c', 30)];

    markers = removeMarker(markers, 'b');
    expect(labelsOf(markers)).toEqual({ a: 'A', c: 'B' });

    markers = moveMarker(markers, 'a', 35);
    expect(labelsOf(markers)).toEqual({ c: 'A', a: 'B' });
    expect(markers.find((m) => m.id === 'a')?.aliases).toEqual(['Recap']);
  });
});

describe('createMarker', () => {
  it('creates a marker with a uuid id, the given time, no aliases, and a createdAt near now', () => {
    const before = Date.now();
    const created = createMarker(12.5);
    const after = Date.now();

    expect(created.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(created.time).toBe(12.5);
    expect(created.aliases).toEqual([]);
    expect(created.createdAt).toBeGreaterThanOrEqual(before);
    expect(created.createdAt).toBeLessThanOrEqual(after);
  });

  it('rejects an invalid time', () => {
    expectDomainError(() => createMarker(-0.1), 'invalid-time');
  });
});

describe('newId', () => {
  it('generates unique uuid-formatted ids', () => {
    const ids = Array.from({ length: 1000 }, () => newId());

    expect(new Set(ids).size).toBe(1000);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });
});
