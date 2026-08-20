/** A failed decode pass: the recording cannot be turned into peaks. */
export class DecodeError extends Error {
  constructor(cause: unknown) {
    super(
      'This recording could not be decoded for waveform display. The timeline still works.',
      { cause },
    );
    this.name = 'DecodeError';
  }
}

/**
 * The YouTube embed's playability failure — the load result's error channel,
 * so the player can show an honest state instead of a silent dead embed.
 * `code` is the IFrame API's `onError` code (2, 5, 100, 101, 150), or 0 when
 * the API script itself never loaded.
 */
export class YouTubePlaybackError extends Error {
  readonly code: number;

  constructor(code: number, cause?: unknown) {
    super("This YouTube video couldn't play.", { cause });
    this.name = 'YouTubePlaybackError';
    this.code = code;
  }
}
