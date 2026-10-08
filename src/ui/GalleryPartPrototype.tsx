import { useNavigate, useSearchParams } from 'react-router';
import { formatWholeSeconds } from '../domain';
import type { GalleryScreenState } from './GalleryScreen';
import { withSyntheticDensity } from './prototypeGalleryData';
import './prototypePart.css';

/**
 * PROTOTYPE — Direction A, "The Part", on the gallery.
 *
 * The gallery as an **index** to a printed edition: each recording is a ruled
 * heading carrying the canonical title and the recording's length, and each
 * project beneath it is a catalogue entry — the owner's name on the reading
 * axis, the marker count right-aligned on a tabular one, so the counts form a
 * clean column down the page the way a part's bar numbers do.
 *
 * The rules here are the only decoration and they are structural: a rule under
 * a recording's title separates one recording's holdings from the next, which
 * is the one thing the grouping has to say.
 */
export function GalleryPartPrototype({ groups, readFailed, retry }: GalleryScreenState) {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  /** Carry the variant through, so opening a project keeps the direction. */
  function open(id: string): void {
    const variant = params.get('variant');
    navigate(variant === null ? `/gallery/${id}` : `/gallery/${id}?variant=${variant}`);
  }

  if (readFailed) {
    return (
      <section className="part-root part-gallery" role="region" aria-label="Public gallery">
        <h2 className="part-gallery-title">Gallery</h2>
        <p role="alert" className="part-notice">
          Couldn’t load the gallery. Check your connection and try again.
        </p>
        <button type="button" className="part-retry" onClick={retry}>
          Retry
        </button>
      </section>
    );
  }
  if (groups === null) return null;
  if (groups.length === 0) {
    return (
      <section className="part-root part-gallery" role="region" aria-label="Public gallery">
        <h2 className="part-gallery-title">Gallery</h2>
        <p className="part-notice">No public projects yet.</p>
      </section>
    );
  }

  const index = withSyntheticDensity(groups);

  return (
    <section className="part-root part-gallery" role="region" aria-label="Public gallery">
      <h2 className="part-gallery-title">Gallery</h2>
      <p className="part-gallery-intro">Published projects, newest first.</p>

      {index.map((group) => (
        <article className="part-recording" key={group.videoId}>
          <h3 className="part-recording-title">
            <span className="part-recording-name">{group.recordingTitle}</span>
            <span className="part-recording-length">
              {formatWholeSeconds(group.duration, group.duration)}
            </span>
          </h3>
          <ul className="part-entries">
            {group.projects.map((project) => (
              <li key={project.id}>
                <button type="button" className="part-entry" onClick={() => open(project.id)}>
                  <span className="part-entry-name">{project.name}</span>
                  <span className="part-entry-count">
                    {project.markerCount} {project.markerCount === 1 ? 'marker' : 'markers'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </section>
  );
}
