/**
 * PROTOTYPE — gallery card anatomy. Throwaway: never merge this file.
 *
 * The question: given one card per recording (thumbnail, duration, recording
 * title, project name, marker count, movement count), which arrangement of
 * those facts should the gallery wear? Three structurally different answers
 * render on the real `/` route, switched by `?variant=`:
 *
 *   A — YouTube-literal: facts stacked under the image, duration on the image.
 *   B — Plate: the recording title in a ruled band under the image.
 *   C — Contents: a three-row table of contents under the image.
 *
 * The grid, data, ordering, and link behaviour are shared; only the card's
 * anatomy changes. Judged at real widths against the local gallery's four
 * hr-Sinfonieorchester recordings.
 */

import { useEffect } from 'react';
import type { SyntheticEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { formatRulerTime } from '../playback/ruler';
import type { GalleryGroup, PublicProjectSummary } from '../projects';
import './gallery-prototype.css';

/** The three arrangements this prototype judges. */
export type PrototypeVariant = 'A' | 'B' | 'C';

const VARIANTS: { key: PrototypeVariant; name: string }[] = [
  { key: 'A', name: 'YouTube-literal' },
  { key: 'B', name: 'Plate' },
  { key: 'C', name: 'Contents' },
];

/** Whether a URL's `?variant=` names one of the three arrangements. */
export function isPrototypeVariant(value: string | null): value is PrototypeVariant {
  return value === 'A' || value === 'B' || value === 'C';
}

/** The project a recording's card opens: its oldest published set. */
function defaultProject(group: GalleryGroup): PublicProjectSummary {
  return group.projects[group.projects.length - 1];
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** The 16:9 thumbnail, with a lower-resolution fallback when hq720 is absent. */
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
      className="proto-thumb"
      src={`https://i.ytimg.com/vi/${videoId}/hq720.jpg`}
      alt=""
      loading="lazy"
      decoding="async"
      onError={handleError}
    />
  );
}

/** YouTube's own placement: a duration chip in the thumbnail's corner. */
function DurationBadge({ duration }: { duration: number }) {
  return <span className="proto-duration">{formatRulerTime(duration)}</span>;
}

/** The one metadata line A and B share: set name, marks, movements. */
function metaLine(group: GalleryGroup): string {
  const project = defaultProject(group);
  return `${project.name} · ${plural(project.markerCount, 'marker')} · ${plural(
    project.movementCount,
    'movement',
  )}`;
}

function VariantA({ group }: { group: GalleryGroup }) {
  const project = defaultProject(group);
  return (
    <Link className="proto-card proto-card--a" to={`/gallery/${project.id}`}>
      <span className="proto-image">
        <Thumbnail videoId={group.videoId} />
        <DurationBadge duration={group.duration} />
      </span>
      <h3 className="proto-a-title">{group.recordingTitle}</h3>
      <p className="proto-meta">{metaLine(group)}</p>
    </Link>
  );
}

function VariantB({ group }: { group: GalleryGroup }) {
  const project = defaultProject(group);
  return (
    <Link className="proto-card proto-card--b" to={`/gallery/${project.id}`}>
      <span className="proto-image">
        <Thumbnail videoId={group.videoId} />
        <DurationBadge duration={group.duration} />
      </span>
      <h3 className="proto-b-plate">{group.recordingTitle}</h3>
      <p className="proto-meta">{metaLine(group)}</p>
    </Link>
  );
}

function VariantC({ group }: { group: GalleryGroup }) {
  const project = defaultProject(group);
  return (
    <Link className="proto-card proto-card--c" to={`/gallery/${project.id}`}>
      <Thumbnail videoId={group.videoId} />
      <div className="proto-contents">
        <div className="proto-row proto-row--title">
          <h3>{group.recordingTitle}</h3>
          <span className="proto-c-duration">{formatRulerTime(group.duration)}</span>
        </div>
        <div className="proto-row">
          <span>{project.name}</span>
          <span>{plural(project.markerCount, 'marker')}</span>
        </div>
        <div className="proto-row">
          <span>Movements</span>
          <span>{project.movementCount}</span>
        </div>
      </div>
    </Link>
  );
}

/** The floating bar that flips variants; arrows and ←/→ cycle it. */
function Switcher({
  current,
  onChange,
}: {
  current: PrototypeVariant;
  onChange: (next: PrototypeVariant) => void;
}) {
  const index = VARIANTS.findIndex((variant) => variant.key === current);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      const delta = event.key === 'ArrowRight' ? 1 : -1;
      onChange(VARIANTS[(index + delta + VARIANTS.length) % VARIANTS.length].key);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [index, onChange]);

  function step(delta: number): void {
    onChange(VARIANTS[(index + delta + VARIANTS.length) % VARIANTS.length].key);
  }

  return (
    <div className="proto-switcher" role="group" aria-label="Prototype variant">
      <button type="button" onClick={() => step(-1)} aria-label="Previous variant">
        ←
      </button>
      <span className="proto-switcher-label">
        {current} — {VARIANTS[index].name}
      </span>
      <button type="button" onClick={() => step(1)} aria-label="Next variant">
        →
      </button>
    </div>
  );
}

/**
 * The three card anatomies over the gallery's real, already-filtered groups.
 * `groups` arrive newest-recording first; each group's oldest project is the
 * card's default and link target.
 */
export function GalleryPrototype({
  groups,
  variant,
}: {
  groups: readonly GalleryGroup[];
  variant: PrototypeVariant;
}) {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  function show(next: PrototypeVariant): void {
    const search = new URLSearchParams(params);
    search.set('variant', next);
    void navigate({ pathname: '/', search: `?${search.toString()}` }, { replace: true });
  }

  return (
    <>
      <div className="proto-grid">
        {groups.map((group) => {
          if (variant === 'A') return <VariantA key={group.videoId} group={group} />;
          if (variant === 'B') return <VariantB key={group.videoId} group={group} />;
          return <VariantC key={group.videoId} group={group} />;
        })}
      </div>
      <Switcher current={variant} onChange={show} />
    </>
  );
}
