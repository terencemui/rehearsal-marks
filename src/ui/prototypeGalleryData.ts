import type { GalleryGroup, PublicProjectSummary } from '../projects';

/**
 * PROTOTYPE — FAKED DENSITY. Declared in this branch's commit message.
 *
 * The local seed holds exactly one published project, so the gallery's real
 * shape is a single recording with a single entry under it. The gallery's
 * whole design is its *grouping* — a recording's canonical title as a heading
 * with its projects beneath — and one group of one shows none of it. Padding
 * the fetched groups with synthetic siblings is what makes the two directions
 * judgeable side by side.
 *
 * Everything here is invented except the first group's first project, which is
 * the real seed row (`Honeck Tchaikovsky 5`). The synthetic projects carry
 * invented ids, so opening one lands on the not-found page rather than a
 * recording — the honest failure for a row that does not exist. Nothing here
 * touches main; the whole file dies with the branch.
 */

interface SyntheticGroup {
  videoId: string;
  recordingTitle: string;
  duration: number;
  projects: { id: string; name: string; markerCount: number }[];
}

/** A fixed stamp: the gallery sorts newest first and these never need to move. */
const SYNTHETIC_CREATED_AT = Date.UTC(2026, 8, 1);

const SYNTHETIC_TAIL: readonly SyntheticGroup[] = [
  {
    videoId: 'synthetic-beethoven-7',
    recordingTitle: 'Beethoven: Symphony No. 7 — Kammerorchester Basel, Giovanni Antonini',
    duration: 2380,
    projects: [
      { id: 'synthetic-beethoven-7-1', name: 'Antonini 7 — cello part', markerCount: 18 },
      { id: 'synthetic-beethoven-7-2', name: 'Second movement, slow practice', markerCount: 9 },
    ],
  },
  {
    videoId: 'synthetic-brahms-2',
    recordingTitle: 'Brahms: Symphony No. 2 — Gewandhausorchester, Riccardo Chailly',
    duration: 2510,
    projects: [
      { id: 'synthetic-brahms-2-1', name: 'Brahms 2 — tutti', markerCount: 27 },
      { id: 'synthetic-brahms-2-2', name: 'Brahms 2 — horn cues', markerCount: 14 },
      { id: 'synthetic-brahms-2-3', name: 'Brahms 2 — wind entries', markerCount: 6 },
    ],
  },
  {
    videoId: 'synthetic-mahler-5',
    recordingTitle:
      'Mahler: Symphony No. 5 — Symphonieorchester des Bayerischen Rundfunks, Simon Rattle',
    duration: 4260,
    projects: [
      { id: 'synthetic-mahler-5-1', name: 'Adagietto only', markerCount: 12 },
      { id: 'synthetic-mahler-5-2', name: 'Mahler 5 — full run', markerCount: 41 },
    ],
  },
];

/** The seeded recordings' invented siblings, for gallery density only. */
export function withSyntheticDensity(groups: readonly GalleryGroup[]): GalleryGroup[] {
  const padding: GalleryGroup[] = SYNTHETIC_TAIL.map((group) => {
    const projects: PublicProjectSummary[] = group.projects.map((project) => ({
      ...project,
      recordingTitle: group.recordingTitle,
      videoId: group.videoId,
      duration: group.duration,
      createdAt: SYNTHETIC_CREATED_AT,
    }));
    return {
      videoId: group.videoId,
      recordingTitle: group.recordingTitle,
      duration: group.duration,
      projects,
    };
  });
  return [...groups, ...padding];
}
