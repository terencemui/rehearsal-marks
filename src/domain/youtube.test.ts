import { describe, expect, it } from 'vitest';
import { DomainError, type DomainErrorCode } from './errors';
import { canonicalYouTubeUrl, parseYouTubeLink } from './youtube';

/** A real-shaped video ID: 11 chars of the URL-safe alphabet. */
const ID = 'dQw4w9WgXcQ';
const CANONICAL = `https://www.youtube.com/watch?v=${ID}`;

function expectRejection(input: string, code: DomainErrorCode, message?: string): void {
  try {
    parseYouTubeLink(input);
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    if (message !== undefined) {
      expect((error as DomainError).message).toContain(message);
    }
    return;
  }
  expect.unreachable(`expected "${input}" to be rejected as "${code}"`);
}

describe('parseYouTubeLink', () => {
  it.each([
    // Watch links, across the hosts and schemes YouTube itself hands out.
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}`,
    `http://www.youtube.com/watch?v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}`,
    // Short links.
    `https://youtu.be/${ID}`,
    // Shorts, embeds, and live permalinks all name a single video.
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    // Pasted without a scheme, as a browser address bar shows it.
    `www.youtube.com/watch?v=${ID}`,
    `youtube.com/watch?v=${ID}`,
    `youtu.be/${ID}`,
  ])('accepts %s and normalizes it to the canonical URL', (input) => {
    expect(parseYouTubeLink(input)).toEqual({ videoId: ID, canonicalUrl: CANONICAL });
  });

  it.each([
    // Extra parameters ride along on every share form; none of them change
    // which video was pasted, so all of them drop out of the canonical URL.
    [`https://www.youtube.com/watch?v=${ID}&t=42s`, 'a start time'],
    [`https://www.youtube.com/watch?app=desktop&v=${ID}`, 'a leading parameter'],
    [`https://www.youtube.com/watch?v=${ID}&feature=share`, 'a share tag'],
    [`https://youtu.be/${ID}?t=42`, 'a short-link start time'],
    [`https://www.youtube.com/shorts/${ID}?feature=share`, 'a shorts share tag'],
    // A video *within* a playlist is still one video — the list is context,
    // not the thing being pasted, so it normalizes rather than rejecting.
    [`https://www.youtube.com/watch?v=${ID}&list=PLabcdef&index=3`, 'a playlist position'],
  ])('drops %s from the canonical URL', (input) => {
    expect(parseYouTubeLink(input).canonicalUrl).toBe(CANONICAL);
  });

  it('ignores surrounding whitespace from a copy-paste', () => {
    expect(parseYouTubeLink(`  ${CANONICAL}\n`).canonicalUrl).toBe(CANONICAL);
  });

  it('preserves the exact video ID, including case and URL-safe punctuation', () => {
    // IDs are case-sensitive and may carry `-`/`_`; a normalizer that lowercased
    // or stripped them would silently point at a different video.
    const tricky = 'aB-_9xYzQ1w';
    expect(parseYouTubeLink(`https://youtu.be/${tricky}`)).toEqual({
      videoId: tricky,
      canonicalUrl: `https://www.youtube.com/watch?v=${tricky}`,
    });
  });

  it.each([
    ['https://www.youtube.com/playlist?list=PLabcdef', 'a bare playlist'],
    ['https://www.youtube.com/watch?list=PLabcdef', 'a watch link with no video'],
    ['https://m.youtube.com/playlist?list=PLabcdef', 'a mobile playlist'],
  ])('rejects %s with playlist guidance', (input) => {
    expectRejection(input, 'youtube-playlist-link', 'playlist');
  });

  it.each([
    ['', 'an empty string'],
    ['   ', 'blank space'],
    ['not a url', 'free text'],
    ['https://vimeo.com/12345', 'another video host'],
    ['https://www.youtube.com/', 'the site root'],
    ['https://www.youtube.com/@somechannel', 'a channel'],
    ['https://www.youtube.com/results?search_query=brahms', 'a search'],
    ['https://youtu.be/', 'a short link with no ID'],
    [`https://www.youtube.com/watch?v=${ID}extra`, 'an over-long ID'],
    ['https://www.youtube.com/watch?v=tooshort', 'an under-long ID'],
    [`https://www.youtube.com/watch?v=dQw4w9WgXc$`, 'an ID with illegal punctuation'],
    // The lookalike host: `youtube.com` appearing anywhere but the registrable
    // domain must never be treated as YouTube.
    [`https://youtube.com.example.com/watch?v=${ID}`, 'a lookalike domain'],
    [`https://example.com/youtube.com/watch?v=${ID}`, 'a path that mentions youtube'],
  ])('rejects %s with malformed-link guidance', (input) => {
    expectRejection(input, 'invalid-youtube-link', 'YouTube video link');
  });
});

describe('canonicalYouTubeUrl', () => {
  it('builds the one stored form from a video ID', () => {
    expect(canonicalYouTubeUrl(ID)).toBe(CANONICAL);
  });

  it('round-trips every accepted form through one identity', () => {
    // The identity claim the app's recording identity rests on: whatever form
    // was pasted, two links naming the same video produce the same canonical URL.
    const forms = [
      `https://youtu.be/${ID}?t=1`,
      `https://www.youtube.com/shorts/${ID}`,
      `https://m.youtube.com/watch?v=${ID}&list=PLx`,
    ];
    const canonical = forms.map((form) => parseYouTubeLink(form).canonicalUrl);
    expect(new Set(canonical)).toEqual(new Set([canonicalYouTubeUrl(ID)]));
  });
});
