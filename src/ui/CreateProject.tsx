import { useId, useState } from 'react';
import { FilePicker } from './FilePicker';
import './createProject.css';

export interface CreateProjectProps {
  /** Called with the picked file; the caller runs the upload pipeline. */
  onFile: (file: File) => void;
  /** Called with the pasted link, verbatim; the caller runs the YouTube pipeline. */
  onLink: (url: string) => void;
  /** Called when the link field is edited, so the caller can retire stale guidance. */
  onLinkEdit?: () => void;
  /** Rejection guidance from the last file pick, if any. */
  fileError: string | null;
  /** Rejection guidance from the last link attempt, if any. */
  linkError: string | null;
  /** True while any workspace pipeline is running; disables both inputs. */
  busy?: boolean;
  /** True while *this* surface's upload runs — only then does the file button report progress. */
  uploading?: boolean;
  /** True while *this* surface's link create runs — same rule for the link button. */
  creatingFromLink?: boolean;
}

/**
 * The one create surface, with two inputs: pick an audio file, or paste a
 * YouTube link. Both land in the same player session, so there is exactly one
 * place to start a project whatever the source.
 *
 * The two inputs keep separate guidance lines, each beside the control that
 * produced it — a rejected link must not blank out a file's rejection, and a
 * screen reader should hear the failure next to the field it belongs to. The
 * link field's own value is never validated here: the domain module owns what
 * a YouTube link is, and its guidance comes back through `linkError`.
 */
export function CreateProject({
  onFile,
  onLink,
  onLinkEdit,
  fileError,
  linkError,
  busy = false,
  uploading = false,
  creatingFromLink = false,
}: CreateProjectProps) {
  const [url, setUrl] = useState('');
  const inputId = useId();
  const errorId = useId();

  return (
    <section aria-label="Create project" className="create-project">
      <FilePicker
        accept=".mp3,.m4a,audio/mpeg,audio/mp3,audio/mp4,audio/x-m4a"
        label="Create project"
        onFile={onFile}
        busy={busy}
        working={uploading}
        error={fileError}
      />
      <form
        className="create-project-link"
        onSubmit={(event) => {
          event.preventDefault();
          // The field keeps its text through a rejection: the fix for a bad
          // link is usually an edit, not a retype.
          onLink(url);
        }}
      >
        <label htmlFor={inputId}>or paste a YouTube link</label>
        <input
          id={inputId}
          type="text"
          inputMode="url"
          autoComplete="off"
          placeholder="https://www.youtube.com/watch?v=…"
          value={url}
          disabled={busy}
          aria-invalid={linkError !== null}
          aria-describedby={linkError !== null ? errorId : undefined}
          onChange={(event) => {
            setUrl(event.target.value);
            // The guidance describes the text that was submitted; once that
            // text changes it is describing something that is no longer there.
            if (linkError !== null) onLinkEdit?.();
          }}
        />
        <button type="submit" disabled={busy || url.trim() === ''}>
          {creatingFromLink ? 'Creating…' : 'Create from link'}
        </button>
        {linkError !== null && (
          <p id={errorId} role="alert" className="upload-error">
            {linkError}
          </p>
        )}
      </form>
    </section>
  );
}
