import { FilePicker } from './FilePicker';

export interface ImportPickerProps {
  /** Called with the picked file; the caller runs the import pipeline. */
  onFile: (file: File) => void;
  /** True while the pipeline is running; disables the picker. */
  busy?: boolean;
}

/**
 * The workspace's zip-import entry point, next to "Create project". A single
 * file picker; anything that isn't a valid project zip is explained by the
 * pipeline after the pick, so the picker itself only narrows the hint.
 */
export function ImportPicker({ onFile, busy = false }: ImportPickerProps) {
  return (
    <section aria-label="Import project">
      <FilePicker accept=".zip,application/zip" label="Import project" onFile={onFile} busy={busy} />
    </section>
  );
}
