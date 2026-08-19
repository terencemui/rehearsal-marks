import { useId, useRef } from 'react';

export interface FilePickerProps {
  /** Accepted file types for the picker's accept attribute (a hint, not enforcement). */
  accept: string;
  /** The button label. */
  label: string;
  /** Called with the picked file; the caller runs the pipeline. */
  onFile: (file: File) => void;
  /** True while the pipeline is running; disables the picker. */
  busy?: boolean;
  /** Guidance from the last attempt, if any. */
  error?: string | null;
}

/**
 * The one file-picking mechanism: a hidden input in front of a button, with
 * the input reset on change so picking the same file again re-fires change.
 * Upload, zip import, and any future picker route through here so the
 * mechanism — and any fix to it — lives in a single place.
 */
export function FilePicker({
  accept,
  label,
  onFile,
  busy = false,
  error = null,
}: FilePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  return (
    <>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept}
        hidden
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Reset so picking the same file again re-fires change.
          event.target.value = '';
          if (file) onFile(file);
        }}
      />
      <button type="button" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? 'Importing…' : label}
      </button>
      {error !== null && (
        <p role="alert" className="upload-error">
          {error}
        </p>
      )}
    </>
  );
}
