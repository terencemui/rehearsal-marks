import { describe, expect, it } from 'vitest';
import { defaultPlayerMode } from './records';

describe('defaultPlayerMode', () => {
  it('opens a project with marks in Playback — it is immediately practiceable', () => {
    expect(defaultPlayerMode(2)).toBe('playback');
  });

  it('opens an empty project in Label — marking is the only thing to do with it', () => {
    expect(defaultPlayerMode(0)).toBe('label');
  });
});
