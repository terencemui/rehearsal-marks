import { useId, useState } from 'react';
import './createProject.css';

export interface CreateProjectProps {
  /** Called with the pasted link, verbatim; the caller runs the YouTube pipeline. */
  onLink: (url: string) => void;
  /** Called when the link field is edited, so the caller can retire stale guidance. */
  onLinkEdit?: () => void;
  /** Rejection guidance from the last link attempt, if any. */
  linkError: string | null;
  /** True while any workspace pipeline is running; disables the link input and button. */
  busy?: boolean;
  /** True while *this* surface's link create runs — only then does the button report progress. */
  creatingFromLink?: boolean;
}

/**
 * The one create surface: paste a YouTube link. Pasting an accepted link
 * creates a project named after the video and opens the player — there is no
 * other way into a project.
 *
 * The field's own value is never validated here: the domain module owns what
 * a YouTube link is, and its guidance comes back through `linkError`.
 */
export function CreateProject({
  onLink,
  onLinkEdit,
  linkError,
  busy = false,
  creatingFromLink = false,
}: CreateProjectProps) {
  const [url, setUrl] = useState('');
  const inputId = useId();
  const errorId = useId();

  return (
    <section aria-label="Create project">
      <form
        className="create-project-link"
        onSubmit={(event) => {
          event.preventDefault();
          // The field keeps its text through a rejection: the fix for a bad
          // link is usually an edit, not a retype.
          onLink(url);
        }}
      >
        <label htmlFor={inputId}>Paste a YouTube link</label>
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
