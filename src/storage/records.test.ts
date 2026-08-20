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
    expect(defaultPlayerMode('upload')).toBe('label');
  });

  it('opens YouTube projects in Playback mode', () => {
    expect(defaultPlayerMode('youtube')).toBe('playback');
  });

  it('treats a missing source as an upload: legacy records are always uploads', () => {
    expect(defaultPlayerMode(undefined)).toBe('label');
  });
});
