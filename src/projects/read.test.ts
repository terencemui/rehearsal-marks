import { describe, expect, it } from 'vitest';
import { createDefaultProjectsApi } from './api';
import {
  getPublicProject,
  listPublishedForVideo,
  listPublishedProjects,
  readProjectsConfig,
} from './read';
import type { ProjectsReadDependencies } from './read';

/** The good env and the config it parses to — the wiring contract's happy case. */
const GOOD_ENV = {
  VITE_SUPABASE_URL: 'https://abc.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'anon-key',
};
const GOOD_CONFIG = { supabaseUrl: 'https://abc.supabase.co', anonKey: 'anon-key' };

/** A canned PostgREST row for one published public project. */
const ROW = {
  id: '7f8f4a10-2c3e-4b1a-9d5b-6a0e8f9c1d2e',
  name: 'Honeck Tchaikovsky 5',
  recording_title: 'Tschaikowsky: 5. Sinfonie — hr-Sinfonieorchester, Manfred Honeck',
  video_id: 'a_B02BZp-5Y',
  duration: 3036,
  created_at: '2026-08-28T12:00:00.000Z',
  markers: [
    { id: 'm1', time: 34, aliases: ['I. Andante'], createdAt: 1787184000000 },
    { id: 'm2', time: 913, aliases: ['II. Andante'], createdAt: 1787184000000 },
  ],
};

/** The read dependencies with a fetchText that records the URL it was asked for. */
function deps(body: string, onUrl?: (url: string) => void): ProjectsReadDependencies {
  return {
    config: GOOD_CONFIG,
    fetchText: async (url: string) => {
      onUrl?.(url);
      return body;
    },
  };
}

/** The query URL's decoded query string — where the read's contract lives. */
function queryOf(url: string): string {
  return new URL(url).searchParams.toString();
}

describe('readProjectsConfig', () => {
  it('returns the config when both vars are set', () => {
    expect(readProjectsConfig(GOOD_ENV)).toEqual(GOOD_CONFIG);
  });

  it('trims surrounding whitespace', () => {
    expect(
      readProjectsConfig({ ...GOOD_ENV, VITE_SUPABASE_ANON_KEY: '  anon-key  ' }),
    ).toEqual(GOOD_CONFIG);
  });

  it('returns null when either var is missing or blank', () => {
    expect(readProjectsConfig({ VITE_SUPABASE_URL: 'https://abc.supabase.co' })).toBeNull();
    expect(readProjectsConfig({ ...GOOD_ENV, VITE_SUPABASE_ANON_KEY: '   ' })).toBeNull();
    expect(readProjectsConfig({})).toBeNull();
  });

  it('returns null for a URL a fetch could never use', () => {
    expect(readProjectsConfig({ ...GOOD_ENV, VITE_SUPABASE_URL: 'not a url' })).toBeNull();
  });
});

describe('listPublishedProjects', () => {
  it('queries published projects, newest first, carrying the gallery projection', async () => {
    let seenUrl = '';
    await listPublishedProjects(deps(JSON.stringify([ROW]), (url) => (seenUrl = url)));

    expect(queryOf(seenUrl)).toContain('publication_status=eq.published');
    expect(queryOf(seenUrl)).toContain('order=created_at.desc');
    const select = queryOf(seenUrl);
    for (const column of ['id', 'name', 'recording_title', 'video_id', 'duration', 'created_at', 'markers']) {
      expect(select).toContain(column);
    }
  });

  it('sends the anon-key header pair every anonymous read carries', async () => {
    let headers: Record<string, string> | undefined;
    await listPublishedProjects({
      config: GOOD_CONFIG,
      fetchText: async (_url, h) => {
        headers = h;
        return '[]';
      },
    });

    expect(headers).toEqual({ apikey: 'anon-key', Authorization: 'Bearer anon-key' });
  });

  it('parses each row into a summary, counting markers and reading the stamp', async () => {
    const projects = await listPublishedProjects(deps(JSON.stringify([ROW])));

    expect(projects).toEqual([
      {
        id: ROW.id,
        name: ROW.name,
        recordingTitle: ROW.recording_title,
        videoId: ROW.video_id,
        duration: ROW.duration,
        markerCount: 2,
        createdAt: Date.parse(ROW.created_at),
      },
    ]);
  });

  it('returns an empty list when no projects are published', async () => {
    expect(await listPublishedProjects(deps('[]'))).toEqual([]);
  });

  it('skips a row the reader cannot parse instead of rejecting the whole gallery', async () => {
    // The schema guarantees `markers` is JSON, not that it is an array — a
    // single malformed row must not blank every healthy entry beside it.
    const badRow = { ...ROW, markers: { not: 'an array' } };
    const projects = await listPublishedProjects(deps(JSON.stringify([ROW, badRow])));

    expect(projects).toHaveLength(1);
    expect(projects[0].id).toBe(ROW.id);
  });

  it('is empty when the deployment is not wired up', async () => {
    expect(
      await listPublishedProjects({ config: null, fetchText: async () => '[]' }),
    ).toEqual([]);
  });

  it('throws when the body is nothing a read could parse', async () => {
    await expect(listPublishedProjects(deps('not json'))).rejects.toThrow();
  });
});

describe('listPublishedForVideo', () => {
  it('scopes the query to one video, newest first', async () => {
    let seenUrl = '';
    await listPublishedForVideo('a_B02BZp-5Y', deps('[]', (url) => (seenUrl = url)));

    expect(queryOf(seenUrl)).toContain('video_id=eq.a_B02BZp-5Y');
    expect(queryOf(seenUrl)).toContain('order=created_at.desc');
  });
});

describe('getPublicProject', () => {
  it('selects the content with the identity and parses it into a public project', async () => {
    let seenUrl = '';
    const fullRow = { ...ROW, movements: [{ id: 'mv1', name: 'I', start: 34 }] };
    const project = await getPublicProject(ROW.id, deps(JSON.stringify([fullRow]), (url) => (seenUrl = url)));

    expect(queryOf(seenUrl)).toContain(`id=eq.${ROW.id}`);
    expect(queryOf(seenUrl)).toContain('markers');
    expect(queryOf(seenUrl)).toContain('movements');
    expect(project).toEqual({
      id: ROW.id,
      name: ROW.name,
      recordingTitle: ROW.recording_title,
      videoId: ROW.video_id,
      duration: ROW.duration,
      markerCount: 2,
      createdAt: Date.parse(ROW.created_at),
      markers: fullRow.markers,
      movements: fullRow.movements,
    });
  });

  it('returns null when the project is not visible (not published, not public, or missing)', async () => {
    expect(
      await getPublicProject('7f8f4a10-2c3e-4b1a-9d5b-6a0e8f9c1d2e', deps('[]')),
    ).toBeNull();
  });

  it('returns null for an id that cannot name a row, without fetching', async () => {
    // A hand-edited /gallery/not-a-uuid is a bad address, not a backend
    // outage — null (the not-found surface), and no query is even built.
    let fetched = false;
    expect(
      await getPublicProject('not-a-uuid', {
        config: GOOD_CONFIG,
        fetchText: async () => {
          fetched = true;
          return '[]';
        },
      }),
    ).toBeNull();
    expect(fetched).toBe(false);
  });

  it('is null when the deployment is not wired up', async () => {
    expect(await getPublicProject('x', { config: null, fetchText: async () => '[]' })).toBeNull();
  });
});

describe('createDefaultProjectsApi', () => {
  it('returns an api when the env is configured', () => {
    expect(createDefaultProjectsApi(GOOD_ENV)).not.toBeNull();
  });

  it('returns null (not wired up) when the env is absent — the honest unconfigured case', () => {
    expect(createDefaultProjectsApi({})).toBeNull();
    expect(createDefaultProjectsApi({ VITE_SUPABASE_URL: 'https://abc.supabase.co' })).toBeNull();
  });

  it('delegates the reads to the real transport', async () => {
    const api = createDefaultProjectsApi(GOOD_ENV);
    expect(api).not.toBeNull();
    // The reads hit the real fetch; asserting the seam delegates is a shape
    // check, not a network call.
    expect(typeof api?.listPublishedProjects).toBe('function');
    expect(typeof api?.listPublishedForVideo).toBe('function');
    expect(typeof api?.getPublicProject).toBe('function');
  });
});
