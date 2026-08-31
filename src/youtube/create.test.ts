import { describe, expect, it, vi } from 'vitest';
import { createProjectFromYouTubeLink } from './create';
import type { YouTubeDependencies } from './create';
import type { ProjectValues } from '../projects/types';
import { serverProject } from '../test/server-project-fixture';

const ID = 'dQw4w9WgXcQ';
const CANONICAL = `https://www.youtube.com/watch?v=${ID}`;
const TITLE = 'Brahms — Intermezzo Op. 118 No. 2';

/**
 * Pipeline dependencies against a fake server: `create` records the values it
 * is handed and answers with the stored row — the server's own row, ownership
 * and stamps included, exactly as the real adapter returns it.
 */
function dependencies(overrides: Partial<YouTubeDependencies> = {}) {
  const created: ProjectValues[] = [];
  const deps: YouTubeDependencies = {
    fetchTitle: vi.fn(async () => TITLE),
    create: vi.fn(async (values: ProjectValues) => {
      created.push(values);
      // The server owns identity, status, and stamps; only the client-written
      // fields carry over.
      return serverProject({ ...values, id: 'project-created', createdAt: 0, updatedAt: 0 });
    }),
    ...overrides,
  };
  return { deps, created };
}

describe('createProjectFromYouTubeLink', () => {
  it('creates a bare YouTube project whose identity is the video ID', async () => {
    const { deps, created } = dependencies();

    const outcome = await createProjectFromYouTubeLink(CANONICAL, deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // The video ID is the recording's identity — no upload facts exist on the
    // record at all.
    expect(outcome.project.videoId).toBe(ID);
    expect(created).toHaveLength(1);
    expect(created[0].videoId).toBe(ID);
  });

  it('records the video ID as the recording identity, whatever form was pasted', async () => {
    const { deps } = dependencies();

    const outcome = await createProjectFromYouTubeLink(`https://youtu.be/${ID}?t=42`, deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.project.videoId).toBe(ID);
    // The title lookup asks about the canonical form, not the pasted one.
    expect(deps.fetchTitle).toHaveBeenCalledWith(CANONICAL);
  });

  it('names the project after the video title', async () => {
    const { deps, created } = dependencies();

    const outcome = await createProjectFromYouTubeLink(CANONICAL, deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.project.name).toBe(TITLE);
    expect(created[0].name).toBe(TITLE);
  });

  it.each([
    ['the title lookup returns nothing', async () => null],
    ['the title lookup fails outright', async () => Promise.reject(new Error('offline'))],
    ['the title is blank', async () => '   '],
  ])('still creates the project when %s', async (_case, fetchTitle) => {
    // A title this app cannot read is not a reason to refuse the project: the
    // video may still play, and an unplayable one is the player's story to
    // tell. The name falls back to something identifying rather than empty.
    const { deps } = dependencies({
      fetchTitle: fetchTitle as YouTubeDependencies['fetchTitle'],
    });

    const outcome = await createProjectFromYouTubeLink(CANONICAL, deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.project.name).toContain(ID);
    expect(outcome.project.videoId).toBe(ID);
  });

  it('trims a title that arrives padded', async () => {
    const { deps } = dependencies({ fetchTitle: async () => `  ${TITLE}\n` });

    const outcome = await createProjectFromYouTubeLink(CANONICAL, deps);

    expect(outcome.ok && outcome.project.name).toBe(TITLE);
  });

  it('creates a bare timeline: no markers, no movements, a zero duration', async () => {
    // Nothing decodes and nothing is copied in (T51): the owner's marks are
    // their own. Duration is 0 because oEmbed reports none; the embed corrects
    // the in-memory duration once it loads, and the server never persists it.
    const { deps, created } = dependencies();

    const outcome = await createProjectFromYouTubeLink(CANONICAL, deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.project.markers).toEqual([]);
    expect(outcome.project.movements).toEqual([]);
    expect(created[0].markers).toEqual([]);
    expect(created[0].movements).toEqual([]);
    expect(created[0].duration).toBe(0);
  });

  it('carries the canonical recording title, fixed at creation', async () => {
    // The user's own name starts equal to the title and is the only editable
    // half; the recording title stays the canonical fact.
    const { deps, created } = dependencies();

    const outcome = await createProjectFromYouTubeLink(CANONICAL, deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(created[0].recordingTitle).toBe(TITLE);
  });

  it.each([
    ['a playlist link', 'https://www.youtube.com/playlist?list=PLabcdef', /playlist/i],
    ['a malformed link', 'not a youtube link', /YouTube video link/],
    ['an empty field', '', /YouTube video link/],
  ])('rejects %s with guidance and creates nothing', async (_case, input, expected) => {
    const { deps } = dependencies();

    const outcome = await createProjectFromYouTubeLink(input, deps);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.guidance).toMatch(expected);
    expect(deps.create).not.toHaveBeenCalled();
    // A rejected link is decided before any network call — nothing is asked
    // about a video that was never named.
    expect(deps.fetchTitle).not.toHaveBeenCalled();
  });

  it('propagates a create failure instead of reporting a project that was never saved', async () => {
    const { deps } = dependencies({
      create: async () => {
        throw new Error('create failed');
      },
    });

    await expect(createProjectFromYouTubeLink(CANONICAL, deps)).rejects.toThrow('create failed');
  });

  it('asks the server for nothing the server owns — identity, status, and stamps are not in the values', async () => {
    // The values are exactly the client-writable create fields; the server
    // decides ownership, visibility, publication status, and timestamps.
    const { deps, created } = dependencies();

    await createProjectFromYouTubeLink(CANONICAL, deps);

    expect(created[0]).toEqual({
      name: TITLE,
      recordingTitle: TITLE,
      videoId: ID,
      duration: 0,
      markers: [],
      movements: [],
    });
  });
});
