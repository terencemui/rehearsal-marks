import { describe, expect, it, vi } from 'vitest';
import { COMMUNITY_VIDEO_ID, labelSetRow } from '../test/commons-fixture';
import type { LabelSetRow } from './labelSet';
import { CommonsError } from './errors';
import { loadPublishedLabelSet, readCommonsConfig } from './load';

const CONFIG = { supabaseUrl: 'https://abccompany.supabase.co', anonKey: 'anon-key-1' };

/** A valid published row list, as the Commons serializes it. */
function rowBody(overrides: Partial<LabelSetRow> = {}): string {
  return JSON.stringify([labelSetRow(overrides)]);
}

describe('readCommonsConfig', () => {
  it('reads the client identity from Vite env', () => {
    expect(
      readCommonsConfig({ VITE_SUPABASE_URL: CONFIG.supabaseUrl, VITE_SUPABASE_ANON_KEY: CONFIG.anonKey }),
    ).toEqual(CONFIG);
  });

  it.each([
    ['neither var', {}],
    ['only the URL', { VITE_SUPABASE_URL: CONFIG.supabaseUrl }],
    ['only the key', { VITE_SUPABASE_ANON_KEY: CONFIG.anonKey }],
    ['a blank URL', { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: CONFIG.anonKey }],
    ['a blank key', { VITE_SUPABASE_URL: CONFIG.supabaseUrl, VITE_SUPABASE_ANON_KEY: ' ' }],
    ['an unparseable URL', { VITE_SUPABASE_URL: 'not a url', VITE_SUPABASE_ANON_KEY: CONFIG.anonKey }],
  ])('returns null when there is %s', (_case, env) => {
    expect(readCommonsConfig(env)).toBeNull();
  });
});

describe('loadPublishedLabelSet', () => {
  it('queries the published label set for the video ID', async () => {
    let request: { url: string; headers?: Record<string, string> } | null = null;
    const fetchText = vi.fn(async (url: string, headers?: Record<string, string>) => {
      request = { url, headers };
      return rowBody();
    });
    await loadPublishedLabelSet(COMMUNITY_VIDEO_ID, { fetchText, config: CONFIG });

    expect(fetchText).toHaveBeenCalledTimes(1);
    const parsed = new URL(request!.url);
    expect(parsed.origin + parsed.pathname).toBe('https://abccompany.supabase.co/rest/v1/label_sets');
    // Matching is by video ID — never by duration — against the row's own key.
    expect(parsed.searchParams.get('video_id')).toBe(`eq.${COMMUNITY_VIDEO_ID}`);
    // Anonymous readers see published label sets and nothing else.
    expect(parsed.searchParams.get('publication_status')).toBe('eq.published');
    expect(parsed.searchParams.get('limit')).toBe('1');
    // The read projection only: contributor identity and stamps never reach
    // an anonymous reader.
    expect(parsed.searchParams.get('select')).toBe('video_id,duration,markers,movements');
    // The anon key names the role RLS applies.
    expect(request!.headers).toEqual({
      apikey: CONFIG.anonKey,
      Authorization: `Bearer ${CONFIG.anonKey}`,
    });
  });

  it('returns the parsed row for a published set', async () => {
    const set = await loadPublishedLabelSet(COMMUNITY_VIDEO_ID, {
      fetchText: vi.fn(async () => rowBody()),
      config: CONFIG,
    });
    expect(set?.video_id).toBe(COMMUNITY_VIDEO_ID);
    expect(set?.markers).toEqual(labelSetRow().markers);
    expect(set?.duration).toBe(604.2);
  });

  it('parses a projected row — the fields the read consumes', async () => {
    // The Commons answers the requested projection; a full row parses the
    // same way, but the minimal answer is what the query asks for.
    const body = JSON.stringify([
      {
        video_id: COMMUNITY_VIDEO_ID,
        duration: 604.2,
        markers: labelSetRow().markers,
        movements: [],
      },
    ]);
    const set = await loadPublishedLabelSet(COMMUNITY_VIDEO_ID, {
      fetchText: vi.fn(async () => body),
      config: CONFIG,
    });
    expect(set).toEqual({
      video_id: COMMUNITY_VIDEO_ID,
      duration: 604.2,
      markers: labelSetRow().markers,
      movements: [],
    });
  });

  it('returns null when no published set exists', async () => {
    const set = await loadPublishedLabelSet(COMMUNITY_VIDEO_ID, {
      fetchText: vi.fn(async () => '[]'),
      config: CONFIG,
    });
    expect(set).toBeNull();
  });

  it('returns null without fetching when the app is not wired to the Commons', async () => {
    const fetchText = vi.fn(async () => {
      throw new Error('must not fetch');
    });
    const set = await loadPublishedLabelSet(COMMUNITY_VIDEO_ID, { fetchText, config: null });
    expect(set).toBeNull();
    expect(fetchText).not.toHaveBeenCalled();
  });

  it.each([
    ['a non-array body', '{ "video_id": "dQw4w9WgXcQ" }'],
    ['garbage', '{not json'],
  ])('is a loud error when the Commons answers %s', async (_case, body) => {
    await expect(
      loadPublishedLabelSet(COMMUNITY_VIDEO_ID, { fetchText: vi.fn(async () => body), config: CONFIG }),
    ).rejects.toMatchObject({ name: 'CommonsError', code: 'invalid-response' });
  });

  it('is a loud error when the row fails the domain rules', async () => {
    await expect(
      loadPublishedLabelSet(COMMUNITY_VIDEO_ID, {
        fetchText: vi.fn(async () => rowBody({ video_id: 'not-an-id' })),
        config: CONFIG,
      }),
    ).rejects.toMatchObject({ name: 'CommonsError', code: 'invalid-label-set-row' });
  });

  it('is a loud error when the row carries unreadable markers', async () => {
    await expect(
      loadPublishedLabelSet(COMMUNITY_VIDEO_ID, {
        fetchText: vi.fn(async () => rowBody({ markers: 'not-an-array' as never })),
        config: CONFIG,
      }),
    ).rejects.toMatchObject({ name: 'CommonsError', code: 'invalid-label-set-row' });
  });

  it('propagates a fetch failure as-is — the create pipeline degrades it', async () => {
    const failure = new CommonsError("The Commons couldn't be reached.", 'fetch-failed');
    await expect(
      loadPublishedLabelSet(COMMUNITY_VIDEO_ID, {
        fetchText: vi.fn(async () => {
          throw failure;
        }),
        config: CONFIG,
      }),
    ).rejects.toBe(failure);
  });
});
