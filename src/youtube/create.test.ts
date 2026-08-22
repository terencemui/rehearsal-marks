import { describe, expect, it, vi } from 'vitest';
import { createStorage } from '../storage';
import type { ProjectRecord } from '../storage';
import { createProjectFromYouTubeLink } from './create';
import type { YouTubeDependencies } from './create';

const ID = 'dQw4w9WgXcQ';
const CANONICAL = `https://www.youtube.com/watch?v=${ID}`;
const TITLE = 'Brahms — Intermezzo Op. 118 No. 2';

/** Pipeline dependencies writing into a fresh fake-indexeddb database. */
async function dependencies(overrides: Partial<YouTubeDependencies> = {}) {
  const storage = await createStorage({ name: `youtube-test-${crypto.randomUUID()}` });
  return {
    storage,
    deps: {
      fetchTitle: vi.fn<(url: string) => Promise<string | null>>(async () => TITLE),
      // No community labels by default: the bare-link case is the baseline.
      loadCommunityLabels: vi.fn(async () => null),
      save: (record: ProjectRecord) => storage.projects.save(record),
      now: () => 1_700_000_000_000,
      ...overrides,
    },
  };
}

describe('createProjectFromYouTubeLink', () => {
  it('creates a YouTube project whose identity is the video ID', async () => {
    const { deps, storage } = await dependencies();

    const outcome = await createProjectFromYouTubeLink(CANONICAL, deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // The video ID is the recording's identity — no upload facts exist on the
    // record at all.
    expect(outcome.project.videoId).toBe(ID);
    expect(outcome.project.markers).toEqual([]);

    const stored = await storage.projects.get(outcome.project.id);
    expect(stored?.videoId).toBe(ID);
  });

  it('records the video ID as the recording identity, whatever form was pasted', async () => {
    const { deps } = await dependencies();

    const outcome = await createProjectFromYouTubeLink(`https://youtu.be/${ID}?t=42`, deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.project.videoId).toBe(ID);
    // The title lookup asks about the canonical form, not the pasted one.
    expect(deps.fetchTitle).toHaveBeenCalledWith(CANONICAL);
  });

  it('names the project after the video title', async () => {
    const { deps } = await dependencies();

    const outcome = await createProjectFromYouTubeLink(CANONICAL, deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.project.name).toBe(TITLE);
  });

  it.each([
    ['the title lookup returns nothing', async () => null],
    ['the title lookup fails outright', async () => Promise.reject(new Error('offline'))],
    ['the title is blank', async () => '   '],
  ])('still creates the project when %s', async (_case, fetchTitle) => {
    // A title this app cannot read is not a reason to refuse the project: the
    // video may still play, and an unplayable one is the player's story to
    // tell. The name falls back to something identifying rather than empty.
    const { deps } = await dependencies({
      fetchTitle: fetchTitle as YouTubeDependencies['fetchTitle'],
    });

    const outcome = await createProjectFromYouTubeLink(CANONICAL, deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.project.name).toContain(ID);
    expect(outcome.project.videoId).toBe(ID);
  });

  it('trims a title that arrives padded', async () => {
    const { deps } = await dependencies({ fetchTitle: async () => `  ${TITLE}\n` });

    const outcome = await createProjectFromYouTubeLink(CANONICAL, deps);

    expect(outcome.ok && outcome.project.name).toBe(TITLE);
  });

  it('opens in Label mode, because a bare link arrives with no marks', async () => {
    // The posture is stamped at creation and the player reads it, so nothing
    // else gets to decide: a project with an empty timeline must land with
    // the marking tools in reach, not read-only.
    const { deps } = await dependencies();

    const outcome = await createProjectFromYouTubeLink(CANONICAL, deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.project.markers).toEqual([]);
    expect(outcome.project.playerMode).toBe('label');
  });

  it('stamps both timestamps from the injected clock', async () => {
    const { deps } = await dependencies();

    const outcome = await createProjectFromYouTubeLink(CANONICAL, deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.project.createdAt).toBe(1_700_000_000_000);
    expect(outcome.project.updatedAt).toBe(1_700_000_000_000);
  });

  it.each([
    ['a playlist link', 'https://www.youtube.com/playlist?list=PLabcdef', /playlist/i],
    ['a malformed link', 'not a youtube link', /YouTube video link/],
    ['an empty field', '', /YouTube video link/],
  ])('rejects %s with guidance and stores nothing', async (_case, input, expected) => {
    const { deps, storage } = await dependencies();

    const outcome = await createProjectFromYouTubeLink(input, deps);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.guidance).toMatch(expected);
    expect(await storage.projects.list()).toEqual([]);
    // A rejected link is decided before any network call — nothing is asked
    // about a video that was never named.
    expect(deps.fetchTitle).not.toHaveBeenCalled();
  });

  it('propagates a save failure instead of reporting a project that was never saved', async () => {
    const { deps } = await dependencies({
      save: async () => {
        throw new Error('save failed');
      },
    });

    await expect(createProjectFromYouTubeLink(CANONICAL, deps)).rejects.toThrow('save failed');
  });

  it('copies a loaded community label set into the project as its own marks', async () => {
    const community = {
      markers: [
        { id: 'm1', time: 10, aliases: ['Recap'], createdAt: 1 },
        { id: 'm2', time: 222.35, aliases: [], createdAt: 2 },
      ],
      duration: 604.2,
    };
    const { deps } = await dependencies({
      loadCommunityLabels: vi.fn(async () => community),
    });

    const outcome = await createProjectFromYouTubeLink(CANONICAL, deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.project.markers).toEqual(community.markers);
    // The set's duration seeds the record, so a project with marks has an
    // honest timeline before the embed reports its own.
    expect(outcome.project.duration).toBe(604.2);
    // Marks in hand means immediately practiceable: the source's own default.
    expect(outcome.project.playerMode).toBe('playback');
    // The loader is asked about the video's identity, not the pasted text.
    expect(deps.loadCommunityLabels).toHaveBeenCalledWith(ID);
  });

  it('still creates the project when the community lookup fails outright', async () => {
    const { deps } = await dependencies({
      loadCommunityLabels: vi.fn(async () => {
        throw new Error('offline');
      }),
    });

    const outcome = await createProjectFromYouTubeLink(CANONICAL, deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.project.markers).toEqual([]);
    expect(outcome.project.playerMode).toBe('label');
  });
});
