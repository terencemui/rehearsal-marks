import { describe, expect, it } from 'vitest';
import { parseProjectFile, serializeProjectFile } from '../domain';
import type { ProjectFileData } from '../domain';
import { marker } from '../test/marker-fixture';
import {
  labelSetValuesFromProjectFile,
  parseLabelSetRow,
  projectFileFromLabelSetRow,
} from './labelSet';

const VIDEO_ID = 'dQw4w9WgXcQ';
const CANONICAL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const CREATED_MS = 1_700_000_000_000;
const UPDATED_MS = 1_700_001_000_000;

/** A YouTube project's label set in the project-file shape. */
function youtubeFileData(): ProjectFileData {
  return {
    project: {
      id: PROJECT_ID,
      name: 'Brahms Symphony No. 4, mov. I',
      createdAt: CREATED_MS,
      updatedAt: UPDATED_MS,
    },
    markers: [marker('m1', 10, ['Recap']), marker('m2', 20)],
    audioMeta: {
      sha256: '',
      duration: 754.2,
      mimeType: '',
      filename: 'Brahms Symphony No. 4, mov. I',
      sizeBytes: 0,
      source: CANONICAL,
      license: '',
      attribution: '',
    },
  };
}

/** A `label_sets` row whose stamps match the file fixture, so round trips compare exactly. */
function validRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PROJECT_ID,
    video_id: VIDEO_ID,
    contributor_id: 'contributor-1',
    title: 'Brahms Symphony No. 4, mov. I',
    duration: 754.2,
    markers: [marker('m1', 10, ['Recap']), marker('m2', 20)],
    publication_status: 'published',
    created_at: new Date(CREATED_MS).toISOString(),
    updated_at: new Date(UPDATED_MS).toISOString(),
    ...overrides,
  };
}

function expectRowError(value: unknown, pattern: RegExp): void {
  expect(() => parseLabelSetRow(value)).toThrowError(pattern);
}

describe('parseLabelSetRow', () => {
  it('parses a published row with every field', () => {
    const parsed = parseLabelSetRow(validRow());

    expect(parsed).toEqual({
      id: PROJECT_ID,
      video_id: VIDEO_ID,
      contributor_id: 'contributor-1',
      title: 'Brahms Symphony No. 4, mov. I',
      duration: 754.2,
      markers: [marker('m1', 10, ['Recap']), marker('m2', 20)],
      publication_status: 'published',
      created_at: new Date(CREATED_MS).toISOString(),
      updated_at: new Date(UPDATED_MS).toISOString(),
    });
  });

  it('parses a pending row, preserving its status', () => {
    const parsed = parseLabelSetRow(validRow({ publication_status: 'pending' }));

    expect(parsed.publication_status).toBe('pending');
  });

  it('tolerates unknown fields on the row', () => {
    const parsed = parseLabelSetRow(validRow({ somethingNew: 42 }));

    expect(parsed.id).toBe(PROJECT_ID);
  });

  it('rejects a value that is not an object', () => {
    for (const value of ['"hello"', 'null', '[1, 2]']) {
      expectRowError(JSON.parse(value), /must be an object/);
    }
  });

  it('rejects a missing or blank id, contributor, or title', () => {
    for (const field of ['id', 'contributor_id', 'title']) {
      const missing: Record<string, unknown> = { ...validRow() };
      delete missing[field];
      expectRowError(missing, new RegExp(`"${field}" must be a non-empty string`));

      expectRowError(validRow({ [field]: '  ' }), new RegExp(`"${field}" must be a non-empty string`));
    }
  });

  it('rejects a video_id that is not 11 URL-safe characters', () => {
    expectRowError(validRow({ video_id: 'short' }), /"video_id" must be an 11-character video ID/);
    expectRowError(validRow({ video_id: '123456789012' }), /11-character/);
    expectRowError(validRow({ video_id: 'dQw4w9WgXc!' }), /11-character/);
  });

  it('rejects a non-finite or negative duration', () => {
    expectRowError(validRow({ duration: '4:00' }), /"duration" must be a finite number/);
    expectRowError(validRow({ duration: -1 }), /must not be negative/);
  });

  it('rejects a malformed markers document', () => {
    expectRowError(validRow({ markers: {} }), /"markers" must be an array/);
    expectRowError(validRow({ markers: [{ id: 'm1', time: '10', aliases: [], createdAt: 0 }] }), /"markers\[0\]\.time" must be a finite number/);
    expectRowError(validRow({ markers: [{ id: 'm1', time: -5, aliases: [], createdAt: 0 }] }), /must not be negative/);
    expectRowError(validRow({ markers: [{ id: 'm1', time: 10, aliases: 'Recap', createdAt: 0 }] }), /"markers\[0\]\.aliases" must be an array/);
    expectRowError(validRow({ markers: [{ id: 'm1', time: 10, aliases: [], createdAt: 0 }, { id: 'm1', time: 20, aliases: [], createdAt: 0 }] }), /duplicate id "m1"/);
  });

  it('rejects an alias that the domain rules would not allow', () => {
    expectRowError(validRow({ markers: [marker('m1', 10, ['  ']), marker('m2', 20)] }), /marker "m1"/);
  });

  it('rejects an unknown publication status', () => {
    expectRowError(validRow({ publication_status: 'archived' }), /"publication_status" must be "pending" or "published"/);
  });

  it('rejects a missing or unparseable created_at or updated_at', () => {
    const missingCreated: Record<string, unknown> = { ...validRow() };
    delete missingCreated.created_at;
    expectRowError(missingCreated, /"created_at" must be a non-empty string/);

    expectRowError(validRow({ created_at: 'yesterday' }), /"created_at" must be a parseable timestamp/);
    expectRowError(validRow({ updated_at: 123 }), /"updated_at" must be a non-empty string/);
  });
});

describe('labelSetValuesFromProjectFile', () => {
  it('extracts the row values from a YouTube label set', () => {
    const values = labelSetValuesFromProjectFile(youtubeFileData());

    expect(values).toEqual({
      id: PROJECT_ID,
      video_id: VIDEO_ID,
      title: 'Brahms Symphony No. 4, mov. I',
      duration: 754.2,
      markers: [marker('m1', 10, ['Recap']), marker('m2', 20)],
    });
  });

  it('collapses any accepted link form to the same video ID', () => {
    const short = youtubeFileData();
    short.audioMeta.source = `https://youtu.be/${VIDEO_ID}?t=30`;

    expect(labelSetValuesFromProjectFile(short).video_id).toBe(VIDEO_ID);
  });

  it('rejects an uploaded recording with its own guidance', () => {
    const upload = youtubeFileData();
    upload.audioMeta.source = '';

    expect(() => labelSetValuesFromProjectFile(upload)).toThrowError(
      /for an uploaded recording, and the Commons holds YouTube label sets only/,
    );
  });

  it('keeps the domain guidance for a playlist or malformed link', () => {
    const playlist = youtubeFileData();
    playlist.audioMeta.source = 'https://www.youtube.com/playlist?list=PL1234567890';

    expect(() => labelSetValuesFromProjectFile(playlist)).toThrowError(
      /points at a playlist, not a single video/,
    );

    const otherUrl = youtubeFileData();
    otherUrl.audioMeta.source = 'https://example.com/audio.mp3';
    expect(() => labelSetValuesFromProjectFile(otherUrl)).toThrowError(
      /doesn.t look like a YouTube video link/,
    );
  });

  it('rejects a project with a blank name', () => {
    for (const name of ['', '   ']) {
      const unnamed = youtubeFileData();
      unnamed.project.name = name;

      expect(() => labelSetValuesFromProjectFile(unnamed)).toThrowError(/no name to publish/);
    }
  });

  it('rejects a project id that cannot key a row', () => {
    const badId = youtubeFileData();
    badId.project.id = 'project-1';

    expect(() => labelSetValuesFromProjectFile(badId)).toThrowError(/must be a uuid/);
  });

  it('rejects markers the row parser would reject', () => {
    const duplicates = youtubeFileData();
    duplicates.markers = [marker('m1', 10), marker('m1', 20)];

    expect(() => labelSetValuesFromProjectFile(duplicates)).toThrowError(
      /Invalid label set: "markers" contain duplicate id "m1"/,
    );
  });
});

describe('projectFileFromLabelSetRow', () => {
  it('rebuilds the project file from a row', () => {
    const file = projectFileFromLabelSetRow(parseLabelSetRow(validRow()));

    expect(file).toEqual(youtubeFileData());
  });

  it('derives the canonical URL from the video ID and leaves upload facts empty', () => {
    const file = projectFileFromLabelSetRow(parseLabelSetRow(validRow()));

    expect(file.audioMeta.source).toBe(CANONICAL);
    expect(file.audioMeta.sha256).toBe('');
    expect(file.audioMeta.mimeType).toBe('');
    expect(file.audioMeta.sizeBytes).toBe(0);
    expect(file.audioMeta.license).toBe('');
    expect(file.audioMeta.attribution).toBe('');
  });
});

describe('the Commons round trip', () => {
  it('round-trips a label set between the store and the project-file format', () => {
    const file = youtubeFileData();

    const values = labelSetValuesFromProjectFile(file);
    const stored = parseLabelSetRow(validRow({ ...values }));
    const back = projectFileFromLabelSetRow(stored);

    expect(back.markers).toEqual(file.markers);
    expect(back.project.id).toBe(file.project.id);
    expect(back.project.name).toBe(file.project.name);
    expect(back.audioMeta.duration).toBe(file.audioMeta.duration);
    expect(back.audioMeta.source).toBe(file.audioMeta.source);
  });

  it('round-trips through the serialized file format unchanged', () => {
    const original = youtubeFileData();
    const stored = parseLabelSetRow(
      validRow({ ...labelSetValuesFromProjectFile(original) }),
    );

    const reimported = parseProjectFile(
      serializeProjectFile(projectFileFromLabelSetRow(stored)),
    );

    expect(reimported).toEqual(parseProjectFile(serializeProjectFile(original)));
  });
});
