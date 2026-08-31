import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { groupGalleryProjects } from '../projects';
import type { GalleryGroup, ProjectsApi } from '../projects';
import './gallery.css';

export interface GalleryScreenProps {
  /** The anonymous read surface — the gallery's only source. */
  api: ProjectsApi;
}

/**
 * The marker count's label — the one plural the gallery's entries carry.
 */
function markerCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'marker' : 'markers'}`;
}

/**
 * The public gallery (T50): the app's front door. Lists every published
 * public project, newest first, grouped under its recording's canonical
 * title — the recording identity, never the owner's editable name, so a
 * rename never mislabels the recording. Each entry is the project's name and
 * marker count; opening one is navigation to the read-only view
 * (`/gallery/:id`). Anonymous browsing needs no account: the read rides the
 * anon key, and the group a recording lands at is where its newest project
 * sits (T50's grouping seam).
 *
 * The read is one shot on mount (a stateless surface): loading paints
 * nothing, a failed read surfaces as an error with a retry rather than a
 * crash, and an empty server answers "no public projects yet" instead of a
 * blank list.
 */
export function GalleryScreen({ api }: GalleryScreenProps) {
  const navigate = useNavigate();
  /** The gallery's groups; null while the read is in flight. */
  const [groups, setGroups] = useState<GalleryGroup[] | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  /** Bumped by the error card's Retry — re-runs the read. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setGroups(null);
    setReadFailed(false);
    void api
      .listPublishedProjects()
      .then((projects) => {
        if (!cancelled) setGroups(groupGalleryProjects(projects));
      })
      .catch(() => {
        if (!cancelled) setReadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [api, attempt]);

  if (readFailed) {
    return (
      <section className="gallery" role="region" aria-label="Public gallery">
        <h2>Gallery</h2>
        <p role="alert" className="gallery-error">
          Couldn’t load the gallery. Check your connection and try again.
        </p>
        <button type="button" className="gallery-retry" onClick={() => setAttempt((n) => n + 1)}>
          Retry
        </button>
      </section>
    );
  }
  // The read is in flight — nothing to paint until it lands.
  if (groups === null) return null;
  if (groups.length === 0) {
    return (
      <section className="gallery" role="region" aria-label="Public gallery">
        <h2>Gallery</h2>
        <p className="gallery-empty">No public projects yet.</p>
      </section>
    );
  }
  return (
    <section className="gallery" role="region" aria-label="Public gallery">
      <h2>Gallery</h2>
      <p className="gallery-intro">Published projects, newest first.</p>
      {groups.map((group) => (
        <article className="gallery-group" key={group.videoId}>
          <h3 className="gallery-recording">{group.recordingTitle}</h3>
          <ul className="gallery-list">
            {group.projects.map((project) => (
              <li key={project.id}>
                <button
                  type="button"
                  className="gallery-entry"
                  onClick={() => navigate(`/gallery/${project.id}`)}
                >
                  <span className="gallery-name">{project.name}</span>
                  <span className="gallery-count">{markerCountLabel(project.markerCount)}</span>
                </button>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </section>
  );
}
