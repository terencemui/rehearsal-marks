import { describe, expect, it } from 'vitest';
import { validateYouTubeLabelSet, videoIdOf } from './community';

/** A YouTube label set's project.json — the community contribution format. */
function labelsetFile(url: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    project: {
      id: 'set-1',
      name: 'A labeled performance',
      createdAt: 1000,
      updatedAt: 2000,
      source: 'youtube',
    },
    markers: [
      { id: 'm1', time: 10, label: 'A', aliases: ['Recap'], createdAt: 1 },
      { id: 'm2', time: 222.35, label: 'B', aliases: [], createdAt: 2 },
    ],
    audioMeta: {
      sha256: '',
      duration: 604.2,
      mimeType: '',
      filename: 'A labeled performance',
      sizeBytes: 0,
      source: url,
      license: '',
      attribution: '',
    },
  });
}

describe('videoIdOf', () => {
  it('extracts the video ID from any accepted form', () => {
    expect(videoIdOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(videoIdOf('https://youtu.be/dQw4w9WgXcQ?t=42')).toBe('dQw4w9WgXcQ');
    expect(videoIdOf('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('resolves null for anything that is not a single YouTube video link', () => {
    expect(videoIdOf('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(videoIdOf('https://www.youtube.com/playlist?list=PLabc')).toBeNull();
    expect(videoIdOf('')).toBeNull();
  });
});

describe('validateYouTubeLabelSet', () => {
  it('accepts a set naming the video and returns its markers and duration', () => {
    const set = validateYouTubeLabelSet(
      labelsetFile('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
      'dQw4w9WgXcQ',
    );

    // Matching compares video IDs, so any accepted URL form matches a set
    // published under any other form.
    expect(set).toEqual({
      markers: [
        { id: 'm1', time: 10, aliases: ['Recap'], createdAt: 1 },
        { id: 'm2', time: 222.35, aliases: [], createdAt: 2 },
      ],
      duration: 604.2,
    });
  });

  it('matches across URL forms — identity is the video ID, never the URL shape', () => {
    const set = validateYouTubeLabelSet(
      labelsetFile('https://youtu.be/dQw4w9WgXcQ'),
      'dQw4w9WgXcQ',
    );

    expect(set).not.toBeNull();
  });

  it('resolves null for a set naming a different video', () => {
    expect(
      validateYouTubeLabelSet(
        labelsetFile('https://www.youtube.com/watch?v=anotherVideoId'),
        'dQw4w9WgXcQ',
      ),
    ).toBeNull();
  });

  it('resolves null for a set that is not a YouTube project', () => {
    const uploadShaped = JSON.parse(
      labelsetFile('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    ) as { project: Record<string, unknown> };
    uploadShaped.project.source = 'upload';

    expect(
      validateYouTubeLabelSet(JSON.stringify(uploadShaped), 'dQw4w9WgXcQ'),
    ).toBeNull();
  });

  it('resolves null for a set that is not a valid project file', () => {
    expect(validateYouTubeLabelSet('{not json', 'dQw4w9WgXcQ')).toBeNull();
  });
});
