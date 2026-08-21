import { describe, expect, it } from 'vitest';
import { marker } from '../test/marker-fixture';
import { deriveLabels } from './labels';
import { practiceReadout } from './practice';

/**
 * The fixture: three markers at 10s, 20s, and 30s — labels A, B, C in time
 * order, produced through the public deriveLabels surface.
 */
function abcMarkers() {
  return deriveLabels([marker('a', 10), marker('b', 20), marker('c', 30)]);
}

describe('practiceReadout', () => {
  it('reads Start before the first mark, with the bar toward the first marker', () => {
    const readout = practiceReadout(abcMarkers(), 5, 40);
    expect(readout.passed).toBeNull();
    expect(readout.passedTime).toBe(0);
    expect(readout.next?.label).toBe('A');
    expect(readout.nextTime).toBe(10);
    expect(readout.progress).toBeCloseTo(0.5);
  });

  it('shows the passed and next markers between two marks', () => {
    const readout = practiceReadout(abcMarkers(), 15, 40);
    expect(readout.passed?.label).toBe('A');
    expect(readout.passedTime).toBe(10);
    expect(readout.next?.label).toBe('B');
    expect(readout.nextTime).toBe(20);
    expect(readout.progress).toBeCloseTo(0.5);
  });

  it('counts a marker the playhead sits exactly on as passed', () => {
    const readout = practiceReadout(abcMarkers(), 10, 40);
    expect(readout.passed?.label).toBe('A');
    expect(readout.next?.label).toBe('B');
    expect(readout.progress).toBe(0);
  });

  it('counts a marker within one media frame ahead as passed — the arrow tolerance', () => {
    // 19.977 is the frame-snapped landing of a seek to 20: the playhead
    // within a frame of B has reached it, exactly as nextMarker skips it.
    const readout = practiceReadout(abcMarkers(), 19.977, 40);
    expect(readout.passed?.label).toBe('B');
    expect(readout.next?.label).toBe('C');
  });

  it('holds the bar at zero for the frame before a marker flips to passed', () => {
    // 19.98 is within a frame of B: B already counts as passed, and the bar
    // starts its run toward C from 0 — never a backwards fill.
    const readout = practiceReadout(abcMarkers(), 19.98, 40);
    expect(readout.passed?.label).toBe('B');
    expect(readout.progress).toBe(0);
  });

  it('reads End after the last mark, with the bar spanning the last mark to the end', () => {
    const readout = practiceReadout(abcMarkers(), 33, 40);
    expect(readout.passed?.label).toBe('C');
    expect(readout.passedTime).toBe(30);
    expect(readout.next).toBeNull();
    expect(readout.nextTime).toBe(40);
    // Three seconds past the last mark, ten seconds of recording left — a
    // third full, never full just because the last mark passed.
    expect(readout.progress).toBeCloseTo(0.3);
  });

  it('fills the bar only at the recording end, not at the last mark', () => {
    expect(practiceReadout(abcMarkers(), 30, 40).progress).toBe(0);
    expect(practiceReadout(abcMarkers(), 40, 40).progress).toBe(1);
  });

  it('fills the bar when the last marker sits at the recording end', () => {
    // The last mark at the recording's very end: the bar spans the mark to
    // the end — a zero-length span — so reaching the end reads full, never
    // pinned empty by the degenerate interval.
    const end = deriveLabels([marker('a', 10), marker('b', 40)]);
    expect(practiceReadout(end, 40, 40).progress).toBe(1);
    // Within a frame of the end, the tolerance has already reached it.
    expect(practiceReadout(end, 39.96, 40).progress).toBe(1);
  });

  it('clamps a trailing playhead to the recording end', () => {
    expect(practiceReadout(abcMarkers(), 45, 40).progress).toBe(1);
  });

  it('reads Start to End with the bar toward the recording when there are no markers', () => {
    const readout = practiceReadout([], 12, 40);
    expect(readout.passed).toBeNull();
    expect(readout.next).toBeNull();
    expect(readout.passedTime).toBe(0);
    expect(readout.nextTime).toBe(40);
    expect(readout.progress).toBeCloseTo(0.3);
  });

  it('holds a zero progress on a zero-duration recording', () => {
    const readout = practiceReadout([], 0, 0);
    expect(readout.passedTime).toBe(0);
    expect(readout.nextTime).toBe(0);
    expect(readout.progress).toBe(0);
  });

  it('passes a same-time cluster as a group, the last of the cluster most recent', () => {
    const cluster = deriveLabels([marker('a', 10), marker('b', 10), marker('c', 20)]);
    const readout = practiceReadout(cluster, 10, 40);
    expect(readout.passed?.label).toBe('B');
    expect(readout.next?.label).toBe('C');
  });
});
