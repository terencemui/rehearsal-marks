import { describe, expect, it, vi } from 'vitest';
import { fetchYouTubeTitle } from './title';

const CANONICAL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const TITLE = 'Brahms — Intermezzo Op. 118 No. 2';

/** Only the two members the lookup reads; the rest of Response is irrelevant here. */
function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as unknown as Response;
}

/** A `fetch` stand-in that records the URL it was asked for. */
function stubFetch(impl: () => Promise<Response>) {
  return vi.fn<typeof fetch>(impl);
}

describe('fetchYouTubeTitle', () => {
  it('reads the title from the oEmbed payload', async () => {
    const fetchImpl = stubFetch(async () => jsonResponse({ title: TITLE, author_name: 'Someone' }));

    expect(await fetchYouTubeTitle(CANONICAL, fetchImpl)).toBe(TITLE);
  });

  it('asks oEmbed about the canonical URL, encoded as a query parameter', async () => {
    const fetchImpl = stubFetch(async () => jsonResponse({ title: TITLE }));

    await fetchYouTubeTitle(CANONICAL, fetchImpl);

    const requested = String(fetchImpl.mock.calls[0][0]);
    expect(requested).toContain('youtube.com/oembed');
    expect(requested).toContain(encodeURIComponent(CANONICAL));
    expect(requested).toContain('format=json');
  });

  it.each([
    ['the video is private or gone', async () => jsonResponse({}, false)],
    ['the payload carries no title', async () => jsonResponse({ author_name: 'Someone' })],
    ['the title is not a string', async () => jsonResponse({ title: 42 })],
    ['the payload is not an object', async () => jsonResponse('nope')],
    [
      'the body is not JSON at all',
      async () =>
        ({
          ok: true,
          json: async () => {
            throw new Error('Unexpected token');
          },
        }) as unknown as Response,
    ],
    [
      'the network is unreachable',
      async (): Promise<Response> => {
        throw new Error('Failed to fetch');
      },
    ],
  ])('answers null when %s', async (_case, impl) => {
    // Every failure is the same answer — a missing title never blocks the
    // project, so nothing here is allowed to reject.
    expect(await fetchYouTubeTitle(CANONICAL, stubFetch(impl))).toBeNull();
  });
});
