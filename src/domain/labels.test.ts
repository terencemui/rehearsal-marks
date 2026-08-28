import { describe, expect, it } from 'vitest';
import { marker } from '../test/marker-fixture';
import { deriveLabels, labelForRank } from './labels';

describe('labelForRank', () => {
  it.each([
    [0, 'A'],
    [1, 'B'],
    [25, 'Z'],
    [26, 'AA'],
    [27, 'AB'],
    [51, 'AZ'],
    [52, 'BA'],
    [701, 'ZZ'],
    [702, 'AAA'],
  ])('maps rank %i to label %s', (rank, expected) => {
    expect(labelForRank(rank)).toBe(expected);
  });
});

describe('deriveLabels', () => {
  it('assigns labels by time rank, earliest first, regardless of input order', () => {
    const markers = [marker('a', 30), marker('b', 10), marker('c', 20)];

    const labeled = deriveLabels(markers);

    expect(labeled.map((m) => [m.id, m.label])).toEqual([
      ['b', 'A'],
      ['c', 'B'],
      ['a', 'C'],
    ]);
  });

  it('breaks equal times deterministically by createdAt, then id', () => {
    const markers = [
      marker('a', 10, [], 2),
      marker('b', 10, [], 1),
      marker('c', 10, [], 1),
    ];

    const labeled = deriveLabels(markers);

    expect(labeled.map((m) => m.id)).toEqual(['b', 'c', 'a']);
  });

  it('continues past Z as AA, AB', () => {
    const markers = Array.from({ length: 28 }, (_, i) => marker(`m${i}`, i));

    const labeled = deriveLabels(markers);

    expect(labeled.map((m) => m.label)).toEqual([
      'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N',
      'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'AA', 'AB',
    ]);
  });

  it('never mutates the input or stores the label on the marker', () => {
    const markers = [marker('a', 30), marker('b', 10)];

    deriveLabels(markers);

    expect(markers.map((m) => m.id)).toEqual(['a', 'b']);
    expect(markers[0]).not.toHaveProperty('label');
  });
});

describe('deriveLabels with movements', () => {
  it('restarts the letters at A within each movement', () => {
    const markers = [
      marker('a', 10),
      marker('b', 20),
      marker('c', 900),
      marker('d', 1000),
      marker('e', 2000),
    ];
    const movements = [
      { id: 'm1', name: 'I. Allegro', start: 0 },
      { id: 'm2', name: 'II. Adagio', start: 831 },
      { id: 'm3', name: 'III. Finale', start: 1620 },
    ];

    const labeled = deriveLabels(markers, movements);

    // Each movement's letters read the same, whether the piece is one
    // movement or four.
    expect(labeled.map((m) => [m.id, m.label])).toEqual([
      ['a', 'A'],
      ['b', 'B'],
      ['c', 'A'],
      ['d', 'B'],
      ['e', 'A'],
    ]);
  });

  it('leads markers before the first movement as their own group, labelled from A', () => {
    const markers = [marker('a', 5), marker('b', 10), marker('c', 40)];
    const movements = [{ id: 'm1', name: 'I. Allegro', start: 30 }];

    const labeled = deriveLabels(markers, movements);

    // The orphan "before the first movement" group labels from A like any
    // other, so the movement's own letters still start fresh.
    expect(labeled.map((m) => [m.id, m.label])).toEqual([
      ['a', 'A'],
      ['b', 'B'],
      ['c', 'A'],
    ]);
  });

  it('labels exactly as the flat list when there are no movements', () => {
    const markers = [marker('a', 10), marker('b', 20)];

    expect(deriveLabels(markers, [])).toEqual(deriveLabels(markers));
  });
});
