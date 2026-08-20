import { FilePicker } from './FilePicker';

export interface ImportPickerProps {
  /** Called with the picked file; the caller runs the import pipeline. */
  onFile: (file: File) => void;
  /** True while any workspace pipeline is running; disables the picker. */
  busy?: boolean;
  /** True while *this* import runs — only then does the button report progress. */
  working?: boolean;
}

/**
 * The workspace's project-import entry point, next to "Create project". One
 * file picker for both import formats — an upload's zip or a YouTube
 * project's bare JSON — and anything that is neither is explained by the
 * pipeline after the pick, so the picker itself only narrows the hint.
 */
export function ImportPicker({ onFile, busy = false, working = false }: ImportPickerProps) {
  return (
    <section aria-label="Import project">
      <FilePicker
        accept=".zip,.json,application/zip,application/json"
        label="Import project"
        onFile={onFile}
        busy={busy}
        working={working}
      />
    </section>
  );
}
