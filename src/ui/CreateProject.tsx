import { useEffect, useId, useState } from 'react';
import { parseYouTubeLink } from '../domain';
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
  /**
   * Optional: the published-project count for a video, shown as a debounced
   * peek under the field once the text parses as a YouTube link (T51). Null
   * or a failed read shows nothing; only a count above zero speaks.
   */
  countPublished?: (videoId: string) => Promise<number>;
}

/** The peek's debounce window — a pause while the user keeps typing. */
const PEEK_DEBOUNCE_MS = 400;

/**
 * The one create surface: paste a YouTube link. Pasting an accepted link
 * creates a project named after the video and opens the player — there is no
 * other way into a project.
 *
 * The field's own value is never validated here: the domain module owns what
 * a YouTube link is, and its guidance comes back through `linkError`. A
 * debounced peek runs alongside: once the text reads as a link, the published
 * projects already waiting for that video are announced under the field, so a
 * student about to duplicate a performance's marks sees them before they
 * create a bare project.
 */
export function CreateProject({
  onLink,
  onLinkEdit,
  linkError,
  busy = false,
  creatingFromLink = false,
  countPublished,
}: CreateProjectProps) {
  const [url, setUrl] = useState('');
  const [peek, setPeek] = useState<string | null>(null);
  const inputId = useId();
  const errorId = useId();
  const peekId = useId();

  // The peek follows the field: debounced, and only while the text reads as a
  // link. A response that lands behind a newer edit is discarded — the count
  // describes the video the field holds now, not one it held a moment ago.
  useEffect(() => {
    let videoId: string | null = null;
    try {
      videoId = parseYouTubeLink(url.trim()).videoId;
    } catch {
      videoId = null;
    }
    if (videoId === null || countPublished === undefined) {
      setPeek(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void countPublished(videoId!)
        .then((count) => {
          if (cancelled || count <= 0) return;
          setPeek(
            count === 1
              ? '1 published project for this video'
              : `${count} published projects for this video`,
          );
        })
        .catch(() => {
          // A peek that fails is nothing the user needs to see — the count is
          // a convenience, and a create still works without it.
        });
    }, PEEK_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [url, countPublished]);

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
          aria-describedby={
            linkError !== null ? errorId : peek !== null ? peekId : undefined
          }
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
        {peek !== null && (
          <p id={peekId} className="create-project-peek">
            {peek}
          </p>
        )}
        {linkError !== null && (
          <p id={errorId} role="alert" className="upload-error">
            {linkError}
          </p>
        )}
      </form>
    </section>
  );
}
