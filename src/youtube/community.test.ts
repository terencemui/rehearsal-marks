import { describe, expect, it, vi } from 'vitest';
import { COMMUNITY_VIDEO_ID, labelSetRow } from '../test/commons-fixture';
import {
  communityLabelSetFromRow,
  loadCommunityLabelSet,
  validateYouTubeLabelSet,
  videoIdOf,
} from './community';

const CONFIG = { supabaseUrl: 'https://abccompany.supabase.co', anonKey: 'anon-key-1' };

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
    movements: [],
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
      movements: [],
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

describe('communityLabelSetFromRow', () => {
  it('checks out a row naming the video as the set the project copies', () => {
    expect(communityLabelSetFromRow(labelSetRow(), COMMUNITY_VIDEO_ID)).toEqual({
      markers: labelSetRow().markers,
      movements: [],
      duration: 604.2,
    });
  });

  it('resolves null for a row naming a different video — marks never transfer', () => {
    expect(
      communityLabelSetFromRow(labelSetRow({ video_id: 'ABCDEFGHIJK' }), COMMUNITY_VIDEO_ID),
    ).toBeNull();
  });
});

describe('loadCommunityLabelSet', () => {
  /** A fetchText stub that responds with the body, or throws for a failure. */
  function respondWith(body: string | null, throwOnFetch: Error | null = null) {
    return vi.fn(async () => {
      if (throwOnFetch !== null) throw throwOnFetch;
      if (body === null) throw new Error('unexpected fetch');
      return body;
    });
  }

  it('returns the published set for the video, keyed on its ID', async () => {
    const set = await loadCommunityLabelSet(COMMUNITY_VIDEO_ID, {
      fetchText: respondWith(JSON.stringify([labelSetRow()])),
      config: CONFIG,
    });
    expect(set).toEqual({ markers: labelSetRow().markers, movements: [], duration: 604.2 });
  });

  it('returns null when the Commons has no published set for the video', async () => {
    const set = await loadCommunityLabelSet(COMMUNITY_VIDEO_ID, {
      fetchText: respondWith('[]'),
      config: CONFIG,
    });
    expect(set).toBeNull();
  });

  it('returns null without fetching when the app is not wired to the Commons', async () => {
    const fetchText = respondWith(null);
    const set = await loadCommunityLabelSet(COMMUNITY_VIDEO_ID, { fetchText, config: null });
    expect(set).toBeNull();
    expect(fetchText).not.toHaveBeenCalled();
  });

  it('never checks out a row for a different video, whatever the query returned', async () => {
    const set = await loadCommunityLabelSet(COMMUNITY_VIDEO_ID, {
      fetchText: respondWith(JSON.stringify([labelSetRow({ video_id: 'ABCDEFGHIJK' })])),
      config: CONFIG,
    });
    expect(set).toBeNull();
  });

  it('propagates a Commons failure — the create pipeline turns it into an unlabeled video', async () => {
    const failure = new Error('offline');
    await expect(
      loadCommunityLabelSet(COMMUNITY_VIDEO_ID, {
        fetchText: respondWith(null, failure),
        config: CONFIG,
      }),
    ).rejects.toBe(failure);
  });
});
