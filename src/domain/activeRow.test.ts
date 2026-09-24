import { describe, expect, it } from 'vitest';
import { marker } from '../test/marker-fixture';
import { activeRowId } from './activeRow';
import { deriveLabels } from './labels';
import type { Movement } from './movement';

/**
 * The fixture: three markers at 10s, 20s, and 30s — labels A, B, C in time
 * order, produced through the public deriveLabels surface.
 */
function abcMarkers() {
  return deriveLabels([marker('a', 10), marker('b', 20), marker('c', 30)]);
}

/** A movement boundary, built by hand: this function reads starts, never writes them. */
function movement(id: string, start: number): Movement {
  return { id, name: id, start };
}

describe('activeRowId', () => {
  it('names the marker the playhead has last passed', () => {
    expect(activeRowId(abcMarkers(), [], 25)).toBe('b');
  });

  it('names the last marker when the playhead is past every mark', () => {
    expect(activeRowId(abcMarkers(), [], 35)).toBe('c');
  });

  it('names nothing before the first mark — the recording’s Start has no row', () => {
    expect(activeRowId(abcMarkers(), [], 0)).toBeNull();
  });

  it('names a mark the playhead has landed on within a media frame', () => {
    // A seek settles on a frame boundary — up to one MP3 frame (~26ms) short
    // of the time asked for — so a mark 19.977 in counts as reached, exactly
    // as the arrow walk and the readout's passed slot count it.
    expect(activeRowId(abcMarkers(), [], 19.977)).toBe('b');
  });

  it('names the movement boundary the playhead is sitting on, over the mark it has passed', () => {
    const movements = [movement('mv1', 15)];
    expect(activeRowId(abcMarkers(), movements, 15)).toBe('mv1');
    // And the marks either side of it are untouched by its presence.
    expect(activeRowId(abcMarkers(), movements, 14)).toBe('a');
    expect(activeRowId(abcMarkers(), movements, 16)).toBe('a');
  });

  it('judges "sitting on a boundary" to a media frame, as placing one is judged', () => {
    const movements = [movement('mv1', 15)];
    expect(activeRowId(abcMarkers(), movements, 15.03)).toBe('mv1');
    expect(activeRowId(abcMarkers(), movements, 14.97)).toBe('mv1');
    // Beyond the frame the boundary is not where the playhead is, and the row
    // is the marker's again.
    expect(activeRowId(abcMarkers(), movements, 15.2)).toBe('a');
  });

  it('gives a mark standing on a boundary to the movement — the two are peers, not ranks', () => {
    const movements = [movement('mv1', 20)];
    expect(activeRowId(abcMarkers(), movements, 20)).toBe('mv1');
  });

  it('names the movement when the recording is nothing but boundaries', () => {
    expect(activeRowId([], [movement('mv1', 100)], 100)).toBe('mv1');
    expect(activeRowId([], [movement('mv1', 100)], 0)).toBeNull();
  });

  it('names the first of two boundaries inside one frame — a set the domain will not mint', () => {
    // Starts stay a frame apart (ADR-0005): `addMovement` refuses a create that
    // lands within a frame of a boundary, and `moveMovement` refuses a re-time
    // that comes that close to a neighbour — so no set this app can produce has
    // two boundaries within a frame of one playhead, and the rule below decides
    // only what a hand-edited document would read as. It is the first, matching
    // the `find` the domain itself names a clashing boundary by — not the
    // nearer, which would be a rule for a state that cannot arise.
    const movements = [movement('mv1', 15), movement('mv2', 15.03)];
    expect(activeRowId([], movements, 15)).toBe('mv1');
    expect(activeRowId([], movements, 15.02)).toBe('mv1');
    // And the first is named even from the second's own start, which is what
    // "the first" means. A set the app can produce cannot ask; a set a document
    // could describe gets the rule the code has, not one held in reserve.
    expect(activeRowId([], movements, 15.03)).toBe('mv1');
  });
});
