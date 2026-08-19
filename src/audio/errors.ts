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
