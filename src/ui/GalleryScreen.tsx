import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { filterGalleryGroups, groupGalleryProjects } from '../projects';
import type { GalleryGroup, ProjectsApi } from '../projects';
import './gallery.css';

export interface GalleryScreenProps {
  /** The anonymous read surface — the gallery's only source. */
  api: ProjectsApi;
}

/** The gallery's shell — the heading and region the states share. */
function GalleryFrame({ children }: { children: ReactNode }) {
  return (
    <section className="gallery" role="region" aria-label="Public gallery">
      <h2>Gallery</h2>
      {children}
    </section>
  );
}

/** A count and its noun, pluralised — "21 markers", "1 project". */
function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** The marker count's label — the one plural the gallery's entries carry. */
function markerCountLabel(count: number): string {
  return countLabel(count, 'marker');
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
 *
 * The search (T87) is the URL's `?q=`: the navbar writes it with history
 * replace, so a refresh restores the results, and the filter is a pure rule
 * beside the grouping helper.
 */
export function GalleryScreen({ api }: GalleryScreenProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const query = searchParams.get('q') ?? '';
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
      <GalleryFrame>
        <p role="alert" className="gallery-error">
          Couldn’t load the gallery. Check your connection and try again.
        </p>
        <button type="button" className="gallery-action" onClick={() => setAttempt((n) => n + 1)}>
          Retry
        </button>
      </GalleryFrame>
    );
  }
  // The read is in flight — nothing to paint until it lands.
  if (groups === null) return null;
  const emptyServer = groups.length === 0;
  const matching = emptyServer ? [] : filterGalleryGroups(groups, query);
  const count = matching.reduce((total, group) => total + group.projects.length, 0);
  return (
    <GalleryFrame>
      {/* The live region every state shares: a search announces its count,
          and an empty result announces zero. */}
      <p className={emptyServer ? 'gallery-empty' : 'gallery-intro'} role="status">
        {emptyServer
          ? 'No public projects yet.'
          : query.trim() === ''
            ? 'Published projects, newest first.'
            : `${countLabel(count, 'project')} found.`}
      </p>
      {!emptyServer && count === 0 && (
        <>
          <p className="gallery-empty">No projects match “{query.trim()}”.</p>
          <button
            type="button"
            className="gallery-action"
            onClick={() => navigate('/', { replace: true })}
          >
            Clear search
          </button>
        </>
      )}
      {matching.map((group) => (
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
    </GalleryFrame>
  );
}
