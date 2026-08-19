import { FilePicker } from './FilePicker';

export interface UploadPickerProps {
  /** Called with the picked file; the caller runs the upload pipeline. */
  onFile: (file: File) => void;
  /** Rejection guidance from the last attempt, if any. */
  error: string | null;
  /** True while the pipeline is running; disables the picker. */
  busy?: boolean;
}

/**
 * The "Create project" entry point: a single file picker restricted to MP3
 * and M4A. Unsupported formats are surfaced as guidance after the pick —
 * the `accept` attribute is a hint, not enforcement, so WAV/FLAC must be
 * caught by the pipeline too.
 */
export function UploadPicker({ onFile, error, busy = false }: UploadPickerProps) {
  return (
    <section aria-label="Create project">
      <FilePicker
        accept=".mp3,.m4a,audio/mpeg,audio/mp3,audio/mp4,audio/x-m4a"
        label="Create project"
        onFile={onFile}
        busy={busy}
        error={error}
      />
    </section>
  );
}
