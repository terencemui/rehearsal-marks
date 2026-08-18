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
