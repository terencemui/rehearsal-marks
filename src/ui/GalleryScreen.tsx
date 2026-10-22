import { useEffect, useState } from 'react';
import type { ReactNode, SyntheticEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { formatRulerTime } from '../playback/ruler';
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

/** A count and its noun, pluralised — "21 markers", "1 recording". */
function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** The project a recording's card opens: its oldest published set. */
function oldestProject(group: GalleryGroup) {
  return group.projects[group.projects.length - 1];
}

/**
 * The recording's still, decorative beside the title the card already names.
 * hq720 is the high-resolution still; not every upload has one, so a failed
 * load steps down to the medium still, and a second failure hides the image
 * rather than leaving a broken frame.
 */
function Thumbnail({ videoId }: { videoId: string }) {
  function handleError(event: SyntheticEvent<HTMLImageElement>): void {
    const image = event.currentTarget;
    if (image.dataset.fallback === 'true') {
      image.hidden = true;
      return;
    }
    image.dataset.fallback = 'true';
    image.src = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
  }

  return (
    <img
      className="gallery-thumb"
      src={`https://i.ytimg.com/vi/${videoId}/hq720.jpg`}
      alt=""
      loading="lazy"
      decoding="async"
      onError={handleError}
    />
  );
}

/**
 * The public gallery (T50, T90): the app's front door. One card per recording
 * with a published public project — newest recording first, where a recording
 * sits at its newest project's position in the flat, newest-first read. The
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
 * beside the grouping helper. The count and the no-match state speak in
 * recordings, the unit the gallery now shows.
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
  // A card's target is the oldest project in the whole recording, never the
  // query's narrowed view of it: a project-name search keeps the card's link
  // where the unfiltered gallery puts it.
  const oldestByVideo = new Map(
    groups.map((group) => [group.videoId, oldestProject(group)]),
  );
  return (
    <GalleryFrame>
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
      {!emptyServer && matching.length === 0 && (
        <>
          <p className="gallery-empty">No recordings match “{query.trim()}”.</p>
          <button
            type="button"
            className="gallery-action"
            onClick={() => navigate('/', { replace: true })}
          >
            Clear search
          </button>
        </>
      )}
      <ol className="gallery-grid">
        {matching.map((group) => {
          const project = oldestByVideo.get(group.videoId)!;
          return (
            <li key={group.videoId}>
              <Link className="gallery-card" to={`/gallery/${project.id}`}>
                <span className="gallery-image">
                  <Thumbnail videoId={group.videoId} />
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
