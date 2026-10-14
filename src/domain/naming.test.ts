import { describe, expect, it } from 'vitest';
import { NAMINGS, markerIdentity, markerName, markerReading, markerTitle } from './naming';
import type { LabeledMarker } from './marker';

/** A marker already carrying its derived label — the shape every surface reads. */
function labeled(label: string, aliases: string[] = []): LabeledMarker {
  return { id: `m-${label}`, time: 10, aliases, createdAt: 0, label };
}

describe('markerName', () => {
  it('reads the label and the first alias in letters, as it always has', () => {
    expect(markerName(labeled('A', ['Recap']), 'letters')).toBe('A — Recap');
    // A mark with no name is its bare label.
    expect(markerName(labeled('A'), 'letters')).toBe('A');
  });

  it('reads the derived label in decimal under numbers', () => {
    expect(markerName(labeled('3', ['Intro']), 'numbers')).toBe('3 — Intro');
    expect(markerName(labeled('3'), 'numbers')).toBe('3');
  });

  it('reads the alias alone under measures, and nothing when there is none', () => {
    // The derived label names nothing in a score that boxes bar numbers, so
    // it is not shown at all here.
    expect(markerName(labeled('D', ['17']), 'measures')).toBe('17');
    expect(markerName(labeled('D'), 'measures')).toBe('');
  });
});

describe('markerReading', () => {
  it('divides the reading where a surface draws a box around the mark', () => {
    // The mark and the alias apart, because the box a score draws takes the
    // whole mark and none of the alias — and a mark whose own label carries a
    // dash must not be split on the separator the joined reading uses.
    expect(markerReading(labeled('A', ['Recap']), 'letters')).toEqual({
      mark: 'A',
      alias: 'Recap',
    });
    expect(markerReading(labeled('3'), 'numbers')).toEqual({ mark: '3', alias: null });
  });

  it('reads the alias as the mark itself under measures, with nothing beside it', () => {
    expect(markerReading(labeled('D', ['17']), 'measures')).toEqual({ mark: '17', alias: null });
    // An unnamed mark has no mark of its own — a blank name area the surfaces
    // that must say something fill from `markerIdentity`.
    expect(markerReading(labeled('D'), 'measures')).toEqual({ mark: '', alias: null });
  });

  it('joins back into exactly the reading `markerName` shows', () => {
    // The two cannot drift: `markerName` is these parts, joined.
    for (const naming of NAMINGS) {
      for (const m of [labeled('A', ['Recap']), labeled('A'), labeled('12', ['Bar 12'])]) {
        const { mark, alias } = markerReading(m, naming);
        expect(markerName(m, naming)).toBe(alias === null ? mark : `${mark} — ${alias}`);
      }
    }
  });
});

describe('markerIdentity', () => {
  it('is the derived label where the label names the mark, alias or not', () => {
    // The accessible names have always been the bare label — `Delete marker A`
    // — and stay that way; an alias is shown beside it, not in place of it.
    expect(markerIdentity(labeled('A', ['Recap']), 'letters')).toBe('A');
    expect(markerIdentity(labeled('3'), 'numbers')).toBe('3');
  });

  it('is the alias under measures, falling back to the derived label when unnamed', () => {
    expect(markerIdentity(labeled('D', ['17']), 'measures')).toBe('17');
    // The one thing this reading is for: a mark whose row shows nothing still
    // announces itself.
    expect(markerIdentity(labeled('D'), 'measures')).toBe('D');
  });
});

describe('markerTitle', () => {
  it('carries every alias where the label names the mark, as the browsing row always has', () => {
    // The visible reading shows only the first alias; the tooltip is where the
    // whole name survives an ellipsis.
    expect(markerTitle(labeled('A', ['Recap', 'Chorus']), 'letters')).toBe('A — Recap, Chorus');
    expect(markerTitle(labeled('A'), 'letters')).toBe('A');
  });

  it('carries the alias alone under measures, and nothing when there is none', () => {
    expect(markerTitle(labeled('D', ['17']), 'measures')).toBe('17');
    expect(markerTitle(labeled('D'), 'measures')).toBe('');
  });
});

