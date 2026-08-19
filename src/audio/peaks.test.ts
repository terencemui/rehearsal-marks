import { describe, expect, it } from 'vitest';
import { bucketedPeaks } from './peaks';

describe('bucketedPeaks', () => {
  it('buckets a known signal into min/max per column', () => {
    const channel = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7]);

    expect(bucketedPeaks([channel], 2)).toEqual([
      [0, 3],
      [4, 7],
    ]);
  });

  it('collapses multiple channels into one min/max track', () => {
    const left = new Float32Array([1, 2, 3, 4]);
    const right = new Float32Array([-2, -1, 0, 5]);

    // Column 0 = frames 0–1 (values 1, 2, -2, -1), column 1 = frames 2–3 (3, 4, 0, 5).
    expect(bucketedPeaks([left, right], 2)).toEqual([
      [-2, 2],
      [0, 5],
    ]);
  });

  it('reads silence as zero-height peaks', () => {
    const silent = new Float32Array([0, 0, 0, 0]);

    expect(bucketedPeaks([silent], 1)).toEqual([[0, 0]]);
  });

  it('assigns every frame to exactly one column', () => {
    // 10 frames over 3 columns: `floor(i * 3 / 10)` puts frames 0–3 in the
    // first column, 4–6 in the second, 7–9 in the third — a complete tiling.
    const channel = new Float32Array(Array.from({ length: 10 }, (_, i) => i));
    const peaks = bucketedPeaks([channel], 3);

    const covered = peaks.reduce((total, [min, max]) => total + (max - min + 1), 0);
    expect(covered).toBe(10);
    expect(peaks[0]).toEqual([0, 3]);
    expect(peaks[1]).toEqual([4, 6]);
    expect(peaks[2]).toEqual([7, 9]);
  });

  it('pads with silence when there are more columns than frames', () => {
    const channel = new Float32Array([1, 2]);

    // Frames 0 and 1 map to columns 0 and 2; the rest have no frames.
    expect(bucketedPeaks([channel], 4)).toEqual([
      [1, 1],
      [0, 0],
      [2, 2],
      [0, 0],
    ]);
  });

  it('returns no peaks for an empty buffer', () => {
    expect(bucketedPeaks([], 4)).toEqual([]);
    expect(bucketedPeaks([new Float32Array(0)], 4)).toEqual([]);
    expect(bucketedPeaks([new Float32Array(4)], 0)).toEqual([]);
  });
});
