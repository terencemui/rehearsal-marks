import { describe, expect, it } from 'vitest';
import { marker } from '../test/marker-fixture';
import { deriveLabels } from './labels';
import { markerForLetter, nextMarker, previousMarker } from './navigation';

/**
 * The fixture: three markers at 10s, 20s, and 30s — labels A, B, C in time
 * order, produced through the public deriveLabels surface.
 */
function abcMarkers() {
  return deriveLabels([marker('a', 10), marker('b', 20), marker('c', 30)]);
}

describe('nextMarker', () => {
  it('jumps forward to the next marker from between two markers', () => {
    expect(nextMarker(abcMarkers(), 15)?.id).toBe('b');
  });

  it('jumps to the first marker when the playhead is before every marker', () => {
    expect(nextMarker(abcMarkers(), 0)?.id).toBe('a');
  });

  it('skips past a marker the playhead sits exactly on', () => {
    expect(nextMarker(abcMarkers(), 10)?.id).toBe('b');
  });

  it('walks past a marker the playhead lands on by a media frame', () => {
    // A seek settles on a frame boundary — up to one MP3 frame (~26ms) short
    // of the requested time — so the tolerance must span a frame, not just
    // exact equality. 19.977 is the frame-snapped landing of a seek to 20.
    expect(nextMarker(abcMarkers(), 19.977)?.id).toBe('c');
  });

  it('still lands on a marker approached from before it', () => {
    expect(nextMarker(abcMarkers(), 19.9)?.id).toBe('b');
  });

  it('wraps to the first marker when the playhead is past the last', () => {
    expect(nextMarker(abcMarkers(), 35)?.id).toBe('a');
  });

  it('returns null when there are no markers', () => {
    expect(nextMarker([], 5)).toBeNull();
  });
});

describe('previousMarker', () => {
  it('jumps back to the previous marker from between two markers', () => {
    expect(previousMarker(abcMarkers(), 15)?.id).toBe('a');
  });

  it('wraps to the last marker when the playhead is before every marker', () => {
    expect(previousMarker(abcMarkers(), 0)?.id).toBe('c');
  });

  it('skips past a marker the playhead sits exactly on, wrapping', () => {
    expect(previousMarker(abcMarkers(), 10)?.id).toBe('c');
  });

  it('walks past a marker the playhead lands on by a media frame', () => {
    expect(previousMarker(abcMarkers(), 20.023)?.id).toBe('a');
  });

  it('still lands on a marker approached from after it', () => {
    expect(previousMarker(abcMarkers(), 20.1)?.id).toBe('b');
  });

  it('jumps to the last marker when the playhead is past it', () => {
    expect(previousMarker(abcMarkers(), 35)?.id).toBe('c');
  });

  it('returns null when there are no markers', () => {
    expect(previousMarker([], 5)).toBeNull();
  });
});

describe('markerForLetter', () => {
  it('finds a marker by its label, case-insensitively', () => {
    expect(markerForLetter(abcMarkers(), 'b')?.id).toBe('b');
    expect(markerForLetter(abcMarkers(), 'B')?.id).toBe('b');
  });

  it('returns null when no marker has that label', () => {
    expect(markerForLetter(abcMarkers(), 'd')).toBeNull();
    expect(markerForLetter([], 'a')).toBeNull();
  });

  it('matches multi-letter labels only by their full label', () => {
    // 27 markers: labels A–Z then AA. A single letter never reaches AA.
    const markers = deriveLabels(
      Array.from({ length: 27 }, (_, i) => marker(`m${i}`, i + 1)),
    );

    expect(markerForLetter(markers, 'a')?.id).toBe('m0');
    expect(markerForLetter(markers, 'aa')?.id).toBe('m26');
  });
});
