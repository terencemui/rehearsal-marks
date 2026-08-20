import { describe, expect, it } from 'vitest';
import { projectRecord, uploadAudio, youtubeProjectRecord } from '../test/project-fixture';
import { defaultPlayerMode, estimateStoredSize } from './records';

/**
 * Size estimation for the nullable-audio shape. The two fixtures carry the
 * same name, audioMeta, and markers, so the serialized data contribution
 * cancels out and the difference between them is exactly the audio bytes.
 */
describe('estimateStoredSize', () => {
  it('treats a YouTube project’s null audio as zero bytes', () => {
    const upload = projectRecord();
    const youtube = youtubeProjectRecord();

    const difference = estimateStoredSize(upload) - estimateStoredSize(youtube);

    expect(difference).toBe(uploadAudio(upload).size);
  });

  it('still counts the stored data when there is no audio', () => {
    expect(estimateStoredSize(youtubeProjectRecord())).toBeGreaterThan(0);
  });
});

describe('defaultPlayerMode', () => {
  it('opens uploads in Label mode — a new upload arrives ready to mark', () => {
    expect(defaultPlayerMode('upload', 0)).toBe('label');
  });

  it('opens a YouTube project that arrived with marks in Playback mode', () => {
    // A video whose community label set loaded is practiceable immediately.
    expect(defaultPlayerMode('youtube', 2)).toBe('playback');
  });

  it('opens a YouTube project with no marks in Label mode', () => {
    // A bare pasted link has an empty timeline; opening it read-only would
    // hide the only thing there is to do with it.
    expect(defaultPlayerMode('youtube', 0)).toBe('label');
  });

  it('never sends an upload to Playback, however many marks it carries', () => {
    // Uploads are created to be marked; marks arriving with one (an imported
    // project) do not change the posture its creation path stamps.
    expect(defaultPlayerMode('upload', 12)).toBe('label');
  });

  it('treats a missing source as an upload: legacy records are always uploads', () => {
    expect(defaultPlayerMode(undefined, 0)).toBe('label');
  });
});
