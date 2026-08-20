/**
 * YouTube link rules — pure logic beside the time parser, and the only place
 * that knows what a YouTube URL looks like. Every accepted share form collapses
 * to one canonical URL, so two people pasting the same video in different forms
 * land on one recording identity; everything else is rejected with guidance
 * that names the actual problem.
 */

import { DomainError } from './errors';

/** A pasted link, resolved to the video it names. */
export interface YouTubeLink {
  /** The token identity matching compares. */
  videoId: string;
  /** The normalized form a YouTube project stores as its recording identity. */
  canonicalUrl: string;
}

/**
 * A video ID: exactly 11 characters of the URL-safe alphabet. IDs are
 * case-sensitive, so this is a shape check only — never a normalization.
 */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** Host prefixes YouTube itself serves; anything else must match exactly. */
const HOST_PREFIXES = ['www.', 'm.', 'music.'];

/** Path prefixes that name one video: `/shorts/ID`, `/embed/ID`, `/live/ID`, `/v/ID`. */
const VIDEO_PATHS = ['shorts', 'embed', 'live', 'v'];

/** The one stored URL form, built from a video ID. */
export function canonicalYouTubeUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Resolves any accepted link form to its video, or throws a `DomainError`
 * explaining why it cannot. Accepts watch links, `youtu.be` short links,
 * shorts, embeds, and live permalinks, on any of YouTube's hosts, with or
 * without a scheme, and with any extra parameters — a start time, a share
 * tag, or a playlist position, none of which change which video was pasted.
 * Playlists get their own guidance; everything else is a malformed link.
 */
export function parseYouTubeLink(input: string): YouTubeLink {
  const url = parseUrl(input.trim());
  if (url === null) throw malformedLink();

  const host = youtubeHost(url.hostname.toLowerCase());
  if (host === null) throw malformedLink();

  const segments = url.pathname.split('/').filter((segment) => segment !== '');

  // youtu.be puts the ID in the path and nothing else: `youtu.be/ID`.
  if (host === 'youtu.be') return resolve(segments[0]);

  // A playlist names a collection, not a video — but a watch link carrying a
  // `list` still names the video in `v`, so only the absence of `v` decides.
  if (segments[0] === 'playlist') throw playlistLink();
  if (segments[0] === 'watch') {
    const id = url.searchParams.get('v');
    if (id === null && url.searchParams.has('list')) throw playlistLink();
    return resolve(id);
  }
  if (segments.length === 2 && VIDEO_PATHS.includes(segments[0])) {
    return resolve(segments[1]);
  }
  throw malformedLink();
}

/** A candidate ID, validated and turned into the link's two facts. */
function resolve(videoId: string | null | undefined): YouTubeLink {
  if (videoId === null || videoId === undefined || !VIDEO_ID.test(videoId)) {
    throw malformedLink();
  }
  return { videoId, canonicalUrl: canonicalYouTubeUrl(videoId) };
}

/**
 * The URL, parsed as pasted or with the scheme a browser's address bar hides.
 * A non-http(s) scheme is retried as a bare host, so `youtu.be/ID` — which
 * parses as an opaque scheme — is read as the link the user meant.
 */
function parseUrl(input: string): URL | null {
  if (input === '') return null;
  const direct = tryUrl(input);
  if (direct !== null && (direct.protocol === 'http:' || direct.protocol === 'https:')) {
    return direct;
  }
  return tryUrl(`https://${input}`);
}

function tryUrl(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

/**
 * The registrable YouTube host a URL is on, or null. Only the subdomains
 * YouTube itself serves are stripped, so a lookalike like
 * `youtube.com.example.com` never passes as YouTube.
 */
function youtubeHost(hostname: string): 'youtube.com' | 'youtu.be' | null {
  const prefix = HOST_PREFIXES.find((candidate) => hostname.startsWith(candidate));
  const bare = prefix === undefined ? hostname : hostname.slice(prefix.length);
  if (bare === 'youtube.com' || bare === 'youtube-nocookie.com') return 'youtube.com';
  if (bare === 'youtu.be') return 'youtu.be';
  return null;
}

function playlistLink(): DomainError {
  return new DomainError(
    'That link points at a playlist, not a single video. Open the video you want on YouTube and paste its link instead.',
    'youtube-playlist-link',
  );
}

function malformedLink(): DomainError {
  return new DomainError(
    'That doesn’t look like a YouTube video link. Paste one like https://www.youtube.com/watch?v=… or https://youtu.be/…',
    'invalid-youtube-link',
  );
}
