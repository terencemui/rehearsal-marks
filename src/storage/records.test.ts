import { describe, expect, it } from 'vitest';
import { projectRecord } from '../test/project-fixture';
import { defaultPlayerMode } from './records';

describe('defaultPlayerMode', () => {
  it('opens a project that arrived with marks in Playback mode', () => {
    // A video whose community label set loaded is practiceable immediately.
    expect(defaultPlayerMode(2)).toBe('playback');
  });

  it('opens a project with no marks in Label mode', () => {
    // A bare pasted link has an empty timeline; opening it read-only would
    // hide the only thing there is to do with it.
    expect(defaultPlayerMode(0)).toBe('label');
  });

  it('treats a record with no persisted mode by its marks', () => {
    // The record's own rule decides the posture; a marker count is enough.
    expect(defaultPlayerMode(projectRecord().markers.length)).toBe('playback');
  });
});
