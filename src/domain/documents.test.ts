import { describe, expect, it } from 'vitest';
import { marker } from '../test/marker-fixture';
import { parseMarkers, parseMovements } from './documents';
import { DomainError, type DomainErrorCode } from './errors';

function expectDomainError(fn: () => unknown, code: DomainErrorCode, message?: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    if (message !== undefined) {
      expect((error as DomainError).message).toContain(message);
    }
    return;
  }
  expect.unreachable(`expected a DomainError with code "${code}"`);
}

describe('parseMarkers', () => {
  it('accepts a valid markers document and returns the domain model', () => {
    const parsed = parseMarkers([marker('a', 30, ['Recap']), marker('b', 10), marker('c', 20, ['Coda'])]);

    expect(parsed).toEqual([
      marker('a', 30, ['Recap']),
      marker('b', 10),
      marker('c', 20, ['Coda']),
    ]);
  });

  it('trims aliases on parse', () => {
    const parsed = parseMarkers([marker('a', 10, ['  Coda '])]);

    expect(parsed[0].aliases).toEqual(['Coda']);
  });

  it('accepts an alias that matches a derived label — the collision rule is gone', () => {
    // ADR-0005: an alias may read as a derived label, even one that only
    // exists once time order is known (here, "C" is marker a's label, and
    // this earlier marker may claim it too).
    const parsed = parseMarkers([marker('a', 30), marker('b', 10, ['C']), marker('c', 20)]);

    expect(parsed.find((m) => m.id === 'b')?.aliases).toEqual(['C']);
  });

  it('rejects empty, over-long, repeated, and already-taken aliases', () => {
    const base = [marker('a', 10, ['Recap'])];
    expectDomainError(() => parseMarkers([marker('b', 20, ['  '])]), 'invalid-markers');
    expectDomainError(() => parseMarkers([marker('b', 20, ['x'.repeat(17)])]), 'invalid-markers');
    expectDomainError(() => parseMarkers([marker('b', 20, ['Recap', 'recap'])]), 'invalid-markers');
    expectDomainError(() => parseMarkers([...base, marker('b', 20, ['Recap'])]), 'invalid-markers');
  });

  it('rejects a document that is not an array', () => {
    for (const value of [{}, '[]', null, 42]) {
      expectDomainError(() => parseMarkers(value), 'invalid-value');
    }
  });

  it('rejects a marker that is not an object', () => {
    expectDomainError(() => parseMarkers(['nope']), 'invalid-value');
  });

  it('rejects duplicate marker ids — id is stable identity for aliases', () => {
    expectDomainError(() => parseMarkers([marker('a', 10), marker('a', 20)]), 'invalid-markers');
  });

  it.each([
    ['marker time is a string', (ms: Array<Record<string, unknown>>) => { ms[0].time = '10'; }],
    ['marker time is negative', (ms: Array<Record<string, unknown>>) => { ms[0].time = -5; }],
    ['marker id is not a string', (ms: Array<Record<string, unknown>>) => { ms[0].id = 5; }],
    ['marker createdAt is missing', (ms: Array<Record<string, unknown>>) => { delete ms[0].createdAt; }],
    ['aliases is not an array', (ms: Array<Record<string, unknown>>) => { ms[0].aliases = 'Recap'; }],
    ['alias is not a string', (ms: Array<Record<string, unknown>>) => { ms[0].aliases = [5]; }],
  ] as Array<[string, (ms: Array<Record<string, unknown>>) => void]>)(
    'rejects a document where %s',
    (_name, breakIt) => {
      const doc = [{ id: 'a', time: 10, aliases: [], createdAt: 0 }];
      breakIt(doc);

      expectDomainError(() => parseMarkers(doc), 'invalid-value');
    },
  );
});

describe('parseMovements', () => {
  it('accepts a valid movements document and returns the domain model', () => {
    const parsed = parseMovements([
      { id: 'm1', name: 'I. Allegro', start: 0 },
      { id: 'm2', name: 'II. Andante cantabile', start: 831 },
    ]);

    expect(parsed).toEqual([
      { id: 'm1', name: 'I. Allegro', start: 0 },
      { id: 'm2', name: 'II. Andante cantabile', start: 831 },
    ]);
  });

  it('rejects a document that is not an array', () => {
    for (const value of [{}, '[]', null]) {
      expectDomainError(() => parseMovements(value), 'invalid-value');
    }
  });

  it('rejects duplicate movement ids', () => {
    const doc = [
      { id: 'm1', name: 'I', start: 0 },
      { id: 'm1', name: 'II', start: 10 },
    ];

    expectDomainError(() => parseMovements(doc), 'invalid-movements');
  });

  it('rejects starts that are not strictly increasing', () => {
    const doc = [
      { id: 'm1', name: 'I', start: 0 },
      { id: 'm2', name: 'II', start: 0 },
    ];

    expectDomainError(() => parseMovements(doc), 'invalid-movements');
  });

  it.each([
    ['movement id is not a string', (ms: Array<Record<string, unknown>>) => { ms[0].id = 7; }],
    ['movement name is blank', (ms: Array<Record<string, unknown>>) => { ms[0].name = '   '; }],
    ['movement start is a string', (ms: Array<Record<string, unknown>>) => { ms[0].start = '10'; }],
    ['movement start is negative', (ms: Array<Record<string, unknown>>) => { ms[0].start = -1; }],
  ] as Array<[string, (ms: Array<Record<string, unknown>>) => void]>)(
    'rejects a document where %s',
    (_name, breakIt) => {
      const doc = [{ id: 'm1', name: 'I. Allegro', start: 0 }];
      breakIt(doc);

      expectDomainError(() => parseMovements(doc), 'invalid-value');
    },
  );
});
