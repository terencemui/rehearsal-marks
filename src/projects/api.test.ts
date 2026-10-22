import { describe, expect, it } from 'vitest';
import { filterGalleryGroups, groupGalleryProjects } from './api';
import type { PublicProjectSummary } from './api';

/** A gallery entry builder — a recording's project, defaults so tests name only what varies. */
function summary(overrides: Partial<PublicProjectSummary>): PublicProjectSummary {
  return {
    id: 'p1',
    name: 'Honeck Tchaikovsky 5',
    recordingTitle: 'Tschaikowsky: 5. Sinfonie — hr-Sinfonieorchester, Manfred Honeck',
    videoId: 'a_B02BZp-5Y',
    duration: 3036,
    markerCount: 21,
    createdAt: 3_000_000_000,
    ...overrides,
  };
}

describe('groupGalleryProjects', () => {
  it('returns an empty list for no projects', () => {
    expect(groupGalleryProjects([])).toEqual([]);
  });

  it('groups one recording into one group holding every project, newest first', () => {
    const older = summary({ id: 'p1', createdAt: 1_000 });
    const newer = summary({ id: 'p2', createdAt: 2_000 });

    expect(groupGalleryProjects([newer, older])).toEqual([
      {
        videoId: 'a_B02BZp-5Y',
        recordingTitle: older.recordingTitle,
        duration: older.duration,
        projects: [newer, older],
      },
    ]);
  });

  it('places each recording\'s group at its newest project\'s position in the flat list', () => {
    // The server returns a newest-first flat list; interleaving a recording's
    // projects across others must still land each group where its newest
    // project sits, and keep the projects inside the group newest-first.
    const rec1Newest = summary({ id: 'p1', videoId: 'aaa', recordingTitle: 'First', createdAt: 3000 });
    const rec2Newest = summary({ id: 'p2', videoId: 'bbb', recordingTitle: 'Second', createdAt: 2000 });
    const rec1Older = summary({ id: 'p3', videoId: 'aaa', recordingTitle: 'First', createdAt: 1000 });

    const groups = groupGalleryProjects([rec1Newest, rec2Newest, rec1Older]);

    expect(groups.map((g) => g.videoId)).toEqual(['aaa', 'bbb']);
    expect(groups[0].projects.map((p) => p.id)).toEqual(['p1', 'p3']);
    expect(groups[1].projects.map((p) => p.id)).toEqual(['p2']);
  });

  it('keeps a lone project as its own single-entry group', () => {
    const alone = summary({ id: 'p1', videoId: 'ccc', recordingTitle: 'Third' });

    expect(groupGalleryProjects([alone])).toEqual([
      {
        videoId: 'ccc',
        recordingTitle: 'Third',
        duration: alone.duration,
        projects: [alone],
      },
    ]);
  });
});

describe('filterGalleryGroups', () => {
  const tchaikovsky = summary({ id: 'p1', name: 'Honeck Tchaikovsky 5', videoId: 'aaa' });
  const tchaikovskyAgain = summary({
    id: 'p2',
    name: 'First read',
    videoId: 'aaa',
  });
  const bruckner = summary({
    id: 'p3',
    name: 'Bruckner 7, first read',
    recordingTitle: 'Bruckner: 7. Sinfonie — hr-Sinfonieorchester, Daniel Harding',
    videoId: 'bbb',
  });
  const groups = groupGalleryProjects([tchaikovsky, bruckner, tchaikovskyAgain]);

  it('keeps every group for an empty or whitespace query', () => {
    expect(filterGalleryGroups(groups, '')).toEqual(groups);
    expect(filterGalleryGroups(groups, '   ')).toEqual(groups);
  });

  it('keeps the whole group on a recording-title match, case-insensitively after trimming', () => {
    const filtered = filterGalleryGroups(groups, '  BRUCKNER ');

    expect(filtered.map((group) => group.videoId)).toEqual(['bbb']);
    expect(filtered[0].projects).toEqual([bruckner]);
  });

  it('matches any member’s recording title, not only the newest’s', () => {
    // A recording retitled on YouTube leaves older rows carrying the old
    // title; the group's own title is the newest row's.
    const retitled = summary({ id: 'p4', videoId: 'ccc', recordingTitle: 'New title', name: 'x' });
    const older = summary({ id: 'p5', videoId: 'ccc', recordingTitle: 'Old title', name: 'y' });

    const filtered = filterGalleryGroups(groupGalleryProjects([retitled, older]), 'old title');

    expect(filtered.map((group) => group.videoId)).toEqual(['ccc']);
    expect(filtered[0].projects).toHaveLength(2);
  });

  it('keeps the whole group unchanged on a project-name match', () => {
    // The search finds recordings, not project subsets: a name match keeps the
    // card's thumbnail, title, duration and oldest-project link intact.
    const filtered = filterGalleryGroups(groups, 'first read');

    expect(filtered.map((group) => group.videoId)).toEqual(['aaa', 'bbb']);
    expect(filtered[0]).toEqual(groups[0]);
    expect(filtered[0].projects).toEqual([tchaikovsky, tchaikovskyAgain]);
    expect(filtered[1]).toEqual(groups[1]);
  });

  it('drops a group no row and no title matches', () => {
    expect(filterGalleryGroups(groups, 'nothing like this')).toEqual([]);
  });
});
