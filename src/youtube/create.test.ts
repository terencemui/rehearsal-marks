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
      save: (record: ProjectRecord) => storage.projects.save(record),
      now: () => 1_700_000_000_000,
      ...overrides,
    },
  };
}

describe('createProjectFromYouTubeLink', () => {
  it('creates a YouTube project that stores no audio', async () => {
    const { deps, storage } = await dependencies();

    const outcome = await createProjectFromYouTubeLink(CANONICAL, deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.project.source).toBe('youtube');
    // The app never holds YouTube audio — the null is the discriminator the
    // record type and the size estimate both rest on.
    expect(outcome.project.audio).toBeNull();
    expect(outcome.project.audioMeta.sizeBytes).toBe(0);
    expect(outcome.project.audioMeta.sha256).toBe('');
    expect(outcome.project.markers).toEqual([]);

    const stored = await storage.projects.get(outcome.project.id);
    expect(stored?.audio).toBeNull();
    expect(stored?.source).toBe('youtube');
  });

  it('records the canonical URL as the recording identity, whatever form was pasted', async () => {
    const { deps } = await dependencies();

    const outcome = await createProjectFromYouTubeLink(`https://youtu.be/${ID}?t=42`, deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.project.audioMeta.source).toBe(CANONICAL);
    // The title lookup asks about the canonical form, not the pasted one.
    expect(deps.fetchTitle).toHaveBeenCalledWith(CANONICAL);
  });

  it('names the project after the video title', async () => {
    const { deps } = await dependencies();

    const outcome = await createProjectFromYouTubeLink(CANONICAL, deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.project.name).toBe(TITLE);
    expect(outcome.project.audioMeta.filename).toBe(TITLE);
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
    expect(outcome.project.audioMeta.source).toBe(CANONICAL);
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

  it('propagates a storage failure instead of reporting a project that was never saved', async () => {
    const { deps } = await dependencies({
      save: async () => {
        throw new Error('storage-full');
      },
    });

    await expect(createProjectFromYouTubeLink(CANONICAL, deps)).rejects.toThrow('storage-full');
  });
});
