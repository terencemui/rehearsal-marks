import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { formatRulerTime } from '../playback/ruler';
import { filterGalleryGroups, groupGalleryProjects, sortGalleryGroups } from '../projects';
import type { GalleryGroup, GallerySort, ProjectsApi } from '../projects';
import { countLabel } from '../projects/summary';
import { Thumbnail } from './Thumbnail';
import './gallery.css';

export interface GalleryScreenProps {
  /** The anonymous read surface — the gallery's only source. */
  api: ProjectsApi;
}

/**
 * The gallery's shell — the heading and region the states share. The sort
 * control, when there is one, sits in the same row as the heading, right
 * of it — it is never shown while the frame is used for the loading or
 * error states.
 */
function GalleryFrame({
  children,
  sortControl,
}: {
  children: ReactNode;
  sortControl?: ReactNode;
}) {
  return (
    <section className="gallery" role="region" aria-label="Public gallery">
      <div className="gallery-header">
        <h2>Gallery</h2>
        {sortControl}
      </div>
      {children}
    </section>
  );
}

/** The project a recording's card opens: its oldest published set. */
function oldestProject(group: GalleryGroup) {
  return group.projects[group.projects.length - 1];
}

/**
 * The public gallery (T50, T90): the app's front door. One card per recording
 * with a published public project — ordered by the sort (Trending by default), where a recording
 * ranks by its newest project and its projects' summed views. The
 * card is the recording's own still, its duration, and its canonical title,
 * never the owner's editable project name (T90). Several projects sharing a
 * video ID are still one card, and the card opens the recording's oldest
 * published project in the read-only view (`/gallery/:id`). Anonymous
 * browsing needs no account: the read rides the anon key.
 *
 * The read is one shot on mount (a stateless surface): loading paints
 * nothing, a failed read surfaces as an error with a retry rather than a
 * crash, and an empty server answers "no public projects yet" instead of a
 * blank grid.
 *
 * The search (T87) is the URL's `?q=`: the navbar writes it with history
 * replace, so a refresh restores the results, and the filter is a pure rule
 * beside the grouping helper. The count speaks in recordings, the unit the
 * gallery now shows — a zero count needs no further explanation, and
 * clearing the search is the field's own job (T105).
 *
 * The sort control (Trending, Newest, Oldest, Most popular) orders whatever the search leaves: group,
 * then filter, then sort.
 */
export function GalleryScreen({ api }: GalleryScreenProps) {
  const [searchParams] = useSearchParams();
  const query = searchParams.get('q') ?? '';
  /** The gallery's groups; null while the read is in flight. */
  const [groups, setGroups] = useState<GalleryGroup[] | null>(null);
  /** The order — the gallery's own state, not the URL, so leaving resets it. */
  const [sort, setSort] = useState<GallerySort>('trending');
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
  const matching = emptyServer ? [] : sortGalleryGroups(filterGalleryGroups(groups, query), sort);
  return (
    <GalleryFrame
      sortControl={
        !emptyServer && (
          <span className="gallery-sort">
            <select
              aria-label="Sort by"
              value={sort}
              onChange={(event) => setSort(event.target.value as GallerySort)}
            >
              <option value="trending">Trending</option>
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="popular">Most popular</option>
            </select>
          </span>
        )
      }
    >
      {/* The live region every state shares: a search announces its count,
          and an empty result announces zero. It stays mounted, empty, when
          the unfiltered gallery has nothing to announce. */}
      <p className={emptyServer ? 'gallery-empty' : 'gallery-status'} role="status">
        {emptyServer
          ? 'No public projects yet.'
          : query.trim() === ''
            ? ''
            : `${countLabel(matching.length, 'recording')} found.`}
      </p>
      <ol className="gallery-grid">
        {matching.map((group) => {
          const project = oldestProject(group);
          return (
            <li key={group.videoId}>
              <Link className="gallery-card" to={`/gallery/${project.id}`}>
                <span className="gallery-image">
                  <Thumbnail videoId={group.videoId} className="gallery-thumb" />
                  <span className="gallery-duration">{formatRulerTime(group.duration)}</span>
                </span>
                <h3 className="gallery-card-title">{group.recordingTitle}</h3>
              </Link>
            </li>
          );
        })}
      </ol>
    </GalleryFrame>
  );
}
