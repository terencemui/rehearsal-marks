import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { filterGalleryGroups, groupGalleryProjects } from '../projects';
import type { GalleryGroup, ProjectsApi } from '../projects';
import { GalleryPrototype, isPrototypeVariant } from './GalleryPrototype';
import './gallery.css';

export interface GalleryScreenProps {
  /** The anonymous read surface — the gallery's only source. */
  api: ProjectsApi;
}

/** The gallery's shell — the heading and region the states share. */
function GalleryFrame({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <section
      className={wide ? 'gallery gallery--prototype' : 'gallery'}
      role="region"
      aria-label="Public gallery"
    >
      <h2>Gallery</h2>
      {children}
    </section>
  );
}

/**
 * PROTOTYPE — the recording-level search the card grid needs: any match on a
 * recording's title or one of its projects keeps that recording's card whole.
 */
function filterRecordings(groups: readonly GalleryGroup[], query: string): GalleryGroup[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...groups];
  return groups.filter(
    (group) =>
      group.recordingTitle.toLowerCase().includes(needle) ||
      group.projects.some((project) => project.name.toLowerCase().includes(needle)),
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
  const requestedVariant = searchParams.get('variant');
  /**
   * PROTOTYPE — `?variant=A|B|C` swaps the card anatomy on the real gallery.
   * Dev builds only, so a stray query can never reach a production reader.
   */
  const variant =
    import.meta.env.DEV && isPrototypeVariant(requestedVariant) ? requestedVariant : null;
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
  // PROTOTYPE — the card grid searches at the recording level, so a set-name
  // match keeps the whole card. The shipped list keeps its own rule.
  const matching = emptyServer
    ? []
    : variant === null
      ? filterGalleryGroups(groups, query)
      : filterRecordings(groups, query);
  const count =
    variant === null
      ? matching.reduce((total, group) => total + group.projects.length, 0)
      : matching.length;
  const unit = variant === null ? 'project' : 'recording';
  return (
    <GalleryFrame wide={variant !== null}>
      {/* The live region every state shares: a search announces its count,
          and an empty result announces zero. */}
      <p className={emptyServer ? 'gallery-empty' : 'gallery-intro'} role="status">
        {emptyServer
          ? 'No public projects yet.'
          : query.trim() === ''
            ? variant === null
              ? 'Published projects, newest first.'
              : 'Published recordings, newest first.'
            : `${countLabel(count, unit)} found.`}
      </p>
      {!emptyServer && count === 0 && (
        <>
          <p className="gallery-empty">No {unit}s match “{query.trim()}”.</p>
          <button
            type="button"
            className="gallery-action"
            onClick={() => navigate('/', { replace: true })}
          >
            Clear search
          </button>
        </>
      )}
      {variant !== null ? (
        <GalleryPrototype groups={matching} variant={variant} />
      ) : (
        matching.map((group) => (
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
        ))
      )}
    </GalleryFrame>
  );
}
