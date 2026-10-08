import { useNavigate, useSearchParams } from 'react-router';
import type { GalleryScreenState } from './GalleryScreen';
import { withSyntheticDensity } from './prototypeGalleryData';
import './prototypeConsole.css';

/**
 * PROTOTYPE — Direction B, "The Console", on the gallery.
 *
 * The gallery as a **bank of recordings**, not a page of entries: each
 * recording is a lit header strip on the deck, and each project beneath it is
 * a channel row that comes up when you point at it — the row lifts, its name
 * brightens, and a focus bar marks its left edge. The marker count is a
 * readout on the right, in tabular figures, where a device would put a level.
 *
 * No accent is spent on decoration: the only colour on the surface is the
 * focus bar, and it means "this row is live".
 */
export function GalleryConsolePrototype({ groups, readFailed, retry }: GalleryScreenState) {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  /** Carry the variant through, so opening a project keeps the direction. */
  function open(id: string): void {
    const variant = params.get('variant');
    navigate(variant === null ? `/gallery/${id}` : `/gallery/${id}?variant=${variant}`);
  }

  if (readFailed) {
    return (
      <section className="console-root console-gallery" role="region" aria-label="Public gallery">
        <h2 className="console-gallery-title">Gallery</h2>
        <p role="alert" className="console-notice">
          Couldn’t load the gallery. Check your connection and try again.
        </p>
        <button type="button" className="console-retry" onClick={retry}>
          Retry
        </button>
      </section>
    );
  }
  if (groups === null) return null;
  if (groups.length === 0) {
    return (
      <section className="console-root console-gallery" role="region" aria-label="Public gallery">
        <h2 className="console-gallery-title">Gallery</h2>
        <p className="console-notice">No public projects yet.</p>
      </section>
    );
  }

  const index = withSyntheticDensity(groups);

  return (
    <section className="console-root console-gallery" role="region" aria-label="Public gallery">
      <h2 className="console-gallery-title">Gallery</h2>
      <p className="console-gallery-intro">Published projects, newest first.</p>

      <div className="console-bank">
        {index.map((group) => (
          <article className="console-recording" key={group.videoId}>
            <h3 className="console-recording-strip">
              <span className="console-recording-name">{group.recordingTitle}</span>
            </h3>
            <ul className="console-channels">
              {group.projects.map((project) => (
                <li key={project.id}>
                  <button
                    type="button"
                    className="console-channel"
                    onClick={() => open(project.id)}
                  >
                    <span className="console-channel-name">{project.name}</span>
                    <span className="console-channel-readout">
                      <span className="console-readout-value">{project.markerCount}</span>
                      <span className="console-readout-unit">
                        {project.markerCount === 1 ? 'marker' : 'markers'}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
