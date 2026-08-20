import type { LoadOptions } from '../audio';

/**
 * Narrows a captured `load` call's options to the upload arm — component
 * tests always load uploads today — throwing if a different source arrives.
 */
export function uploadLoad(options: LoadOptions): Extract<LoadOptions, { source: 'upload' }> {
  if (options.source !== 'upload') throw new Error('Expected an upload load.');
  return options;
}

/** The same narrowing for the YouTube arm — URL and container, no bytes. */
export function youtubeLoad(options: LoadOptions): Extract<LoadOptions, { source: 'youtube' }> {
  if (options.source !== 'youtube') throw new Error('Expected a YouTube load.');
  return options;
}
