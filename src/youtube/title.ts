/**
 * The video-title lookup — the only network call the YouTube create path
 * makes. YouTube's oEmbed endpoint is public, keyless, and CORS-enabled, so a
 * client-only app can read a video's title without a server or an API key.
 *
 * Every failure is the same answer: null. A title is a convenience — the
 * project's default name — never a gate on creating it, so nothing here
 * rejects, and the caller falls back to naming the project by video ID.
 */

const OEMBED_ENDPOINT = 'https://www.youtube.com/oembed';

/** A title lookup that hangs must not hold the create button hostage. */
const TITLE_FETCH_TIMEOUT_MS = 10_000;

/**
 * The video's title, or null when it cannot be read — offline, rate-limited,
 * or a video that is private, deleted, or embed-disabled (oEmbed answers 401
 * or 404 for those). A null is not a verdict on playability: the player is
 * what discovers whether the video actually plays.
 */
export async function fetchYouTubeTitle(
  canonicalUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const url = `${OEMBED_ENDPOINT}?url=${encodeURIComponent(canonicalUrl)}&format=json`;
  try {
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(TITLE_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    if (typeof payload !== 'object' || payload === null) return null;
    const title = (payload as { title?: unknown }).title;
    return typeof title === 'string' ? title : null;
  } catch {
    return null;
  }
}
