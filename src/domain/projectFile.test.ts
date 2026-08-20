import { describe, expect, it } from 'vitest';
import { marker } from '../test/marker-fixture';
import { DomainError, type DomainErrorCode } from './errors';
import { newId } from './id';
import { deriveLabels } from './labels';
import { parseProjectFile, serializeProjectFile, type AudioMeta, type ProjectFileData } from './projectFile';

function expectDomainError(fn: () => unknown, code: DomainErrorCode, message?: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    if (message !== undefined) {
      expect((error as DomainError).message).toContain(message);
    }
    return;
  }
  expect.unreachable(`expected a DomainError with code "${code}"`);
}

const audioMeta: AudioMeta = {
  sha256: 'a'.repeat(64),
  duration: 1234.5,
  mimeType: 'audio/mpeg',
  filename: 'mozart-k466-iii.mp3',
  sizeBytes: 10_000_000,
  source: 'https://example.com/recording',
  license: 'CC0',
  attribution: 'Example Ensemble',
};

/** A project file's worth of domain data: markers deliberately out of time order. */
function fileData(): ProjectFileData {
  return {
    project: { id: newId(), name: 'Mozart K. 466, iii', createdAt: 1000, updatedAt: 2000, source: 'upload' },
    markers: [marker('a', 30, ['Recap']), marker('b', 10), marker('c', 20, ['Coda'])],
    audioMeta,
  };
}

describe('serializeProjectFile', () => {
  it('writes schemaVersion 1 with project, markers, and every audioMeta field', () => {
    const data = fileData();

    const parsed = JSON.parse(serializeProjectFile(data)) as Record<string, unknown>;

    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.project).toEqual(data.project);
    expect(parsed.audioMeta).toEqual(data.audioMeta);
    expect(parsed.markers).toHaveLength(3);
  });

  it('writes the project source for both sources', () => {
    expect(
      (JSON.parse(serializeProjectFile(fileData())) as { project: { source: string } }).project
        .source,
    ).toBe('upload');

    const data = fileData();
    data.project.source = 'youtube';
    expect(
      (JSON.parse(serializeProjectFile(data)) as { project: { source: string } }).project.source,
    ).toBe('youtube');
  });

  it('writes each marker with id, time, label, aliases, createdAt — label informational, by time rank', () => {
    const data = fileData();

    const parsed = JSON.parse(serializeProjectFile(data)) as {
      markers: Array<{ id: string; time: number; label: string; aliases: string[]; createdAt: number }>;
    };

    // Input order was a(30), b(10), c(20); labels follow time rank, not input order.
    expect(parsed.markers).toEqual([
      { id: 'b', time: 10, label: 'A', aliases: [], createdAt: 0 },
      { id: 'c', time: 20, label: 'B', aliases: ['Coda'], createdAt: 0 },
      { id: 'a', time: 30, label: 'C', aliases: ['Recap'], createdAt: 0 },
    ]);
  });
});

/** Field-level equality — marker array order is not a field (time rank is what matters). */
function expectProjectFileEquals(actual: ProjectFileData, expected: ProjectFileData): void {
  const byId = (ms: ProjectFileData['markers']) => [...ms].sort((a, b) => (a.id < b.id ? -1 : 1));

  expect(actual.project).toEqual(expected.project);
  expect(actual.audioMeta).toEqual(expected.audioMeta);
  expect(byId(actual.markers)).toEqual(byId(expected.markers));
}

describe('parseProjectFile', () => {
  it('round-trips: parse(serialize(data)) preserves every field', () => {
    const data = fileData();

    expectProjectFileEquals(parseProjectFile(serializeProjectFile(data)), data);
  });

  it('round-trips a YouTube project: source youtube, empty identity fields, zero size', () => {
    const data = fileData();
    data.project.source = 'youtube';
    data.audioMeta = {
      sha256: '',
      duration: 604.2,
      mimeType: '',
      filename: 'A performance on YouTube',
      sizeBytes: 0,
      source: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      license: '',
      attribution: '',
    };

    expectProjectFileEquals(parseProjectFile(serializeProjectFile(data)), data);
  });

  it('reads a file without project.source as an upload (the field is optional; absent means upload)', () => {
    const data = fileData();
    const parsed = JSON.parse(serializeProjectFile(data)) as Record<string, unknown>;
    delete (parsed.project as Record<string, unknown>).source;

    const imported = parseProjectFile(JSON.stringify(parsed));

    expect(imported.project.source).toBe('upload');
  });

  it('rejects a project.source that is not upload or youtube', () => {
    for (const source of ['spotify', '', 3, null]) {
      const data = fileData();
      const parsed = JSON.parse(serializeProjectFile(data)) as Record<string, unknown>;
      (parsed.project as Record<string, unknown>).source = source;

      expectDomainError(() => parseProjectFile(JSON.stringify(parsed)), 'invalid-project-file');
    }
  });

  it('rejects a newer schemaVersion with a clear error naming both versions', () => {
    expectDomainError(
      () => parseProjectFile(JSON.stringify({ schemaVersion: 2 })),
      'unsupported-schema-version',
      'schema version 2, but this app supports version 1',
    );
  });

  it('rejects a missing, non-numeric, fractional, or non-positive schemaVersion', () => {
    const cases: unknown[] = [{}, { schemaVersion: 0 }, { schemaVersion: -1 }, { schemaVersion: 1.5 }, { schemaVersion: '1' }];

    for (const root of cases) {
      expectDomainError(() => parseProjectFile(JSON.stringify(root)), 'invalid-project-file');
    }
  });

  it('rejects text that is not JSON', () => {
    expectDomainError(() => parseProjectFile('not json {'), 'invalid-project-file');
  });

  it('ignores unknown fields at every level of a known version', () => {
    const data = fileData();
    const text = serializeProjectFile(data);
    const parsed = JSON.parse(text) as Record<string, unknown>;
    parsed.futureField = { anything: true };
    (parsed.project as Record<string, unknown>).color = 'blue';
    ((parsed.markers as Array<Record<string, unknown>>)[0]).note = 'hand-added';
    (parsed.audioMeta as Record<string, unknown>).bitrate = 128;

    expectProjectFileEquals(parseProjectFile(JSON.stringify(parsed)), data);
  });

  it('re-derives labels by time rank on import — a hand-edited file cannot break the no-holes invariant', () => {
    const data = fileData();
    const parsed = JSON.parse(serializeProjectFile(data)) as {
      markers: Array<Record<string, unknown>>;
    };
    for (const m of parsed.markers) {
      m.label = 'Z'; // hand-edit every label to the same letter
    }

    const imported = parseProjectFile(JSON.stringify(parsed));

    for (const m of imported.markers) {
      expect(m).not.toHaveProperty('label');
    }
    expect(deriveLabels(imported.markers).map((m) => [m.id, m.label])).toEqual([
      ['b', 'A'],
      ['c', 'B'],
      ['a', 'C'],
    ]);
  });

  it('rejects duplicate marker ids', () => {
    const data = fileData();
    const parsed = JSON.parse(serializeProjectFile(data)) as {
      markers: Array<Record<string, unknown>>;
    };
    (parsed.markers[1] as Record<string, unknown>).id = parsed.markers[0].id;

    expectDomainError(() => parseProjectFile(JSON.stringify(parsed)), 'invalid-project-file');
  });

  it('rejects an alias that collides with any final derived label, including one later in the file', () => {
    const data = fileData();
    const parsed = JSON.parse(serializeProjectFile(data)) as {
      markers: Array<Record<string, unknown>>;
    };
    // Serialized order is b(10), c(20), a(30); "C" only exists once a is in.
    (parsed.markers[0] as Record<string, unknown>).aliases = ['C'];

    expectDomainError(() => parseProjectFile(JSON.stringify(parsed)), 'invalid-project-file');
  });

  it('rejects empty, over-long, duplicate, and already-taken aliases', () => {
    const breakAliases = (aliases: unknown[]): string => {
      const data = fileData();
      const parsed = JSON.parse(serializeProjectFile(data)) as {
        markers: Array<Record<string, unknown>>;
      };
      (parsed.markers[1] as Record<string, unknown>).aliases = aliases;
      return JSON.stringify(parsed);
    };

    expectDomainError(() => parseProjectFile(breakAliases(['  '])), 'invalid-project-file');
    expectDomainError(() => parseProjectFile(breakAliases(['x'.repeat(17)])), 'invalid-project-file');
    expectDomainError(() => parseProjectFile(breakAliases(['Recap', 'recap'])), 'invalid-project-file');
    expectDomainError(() => parseProjectFile(breakAliases(['Recap'])), 'invalid-project-file');
  });

  it('trims aliases on import', () => {
    const data = fileData();
    const parsed = JSON.parse(serializeProjectFile(data)) as {
      markers: Array<Record<string, unknown>>;
    };
    (parsed.markers[1] as Record<string, unknown>).aliases = ['  Coda '];

    const imported = parseProjectFile(JSON.stringify(parsed));

    expect(imported.markers.find((m) => m.id === 'c')?.aliases).toEqual(['Coda']);
  });

  it('rejects a JSON root that is not an object', () => {
    for (const root of ['"hello"', 'null', '[1, 2]']) {
      expectDomainError(() => parseProjectFile(root), 'invalid-project-file');
    }
  });

  it.each([
    ['project is missing', (file: Record<string, unknown>) => delete file.project],
    ['project.name is missing', (file: Record<string, unknown>) => delete (file.project as Record<string, unknown>).name],
    ['markers is missing', (file: Record<string, unknown>) => delete file.markers],
    ['markers is not an array', (file: Record<string, unknown>) => (file.markers = {})],
    ['marker time is a string', (file: Record<string, unknown>) => ((file.markers as Array<Record<string, unknown>>)[0]).time = '10'],
    ['marker time is negative', (file: Record<string, unknown>) => ((file.markers as Array<Record<string, unknown>>)[0]).time = -5],
    ['marker id is not a string', (file: Record<string, unknown>) => ((file.markers as Array<Record<string, unknown>>)[0]).id = 5],
    ['marker createdAt is missing', (file: Record<string, unknown>) => delete (file.markers as Array<Record<string, unknown>>)[0].createdAt],
    ['aliases is not an array', (file: Record<string, unknown>) => ((file.markers as Array<Record<string, unknown>>)[0]).aliases = 'Recap'],
    ['alias is not a string', (file: Record<string, unknown>) => ((file.markers as Array<Record<string, unknown>>)[0]).aliases = [5]],
    ['audioMeta is missing', (file: Record<string, unknown>) => delete file.audioMeta],
    ['duration is negative', (file: Record<string, unknown>) => (file.audioMeta as Record<string, unknown>).duration = -1],
    ['sizeBytes is a string', (file: Record<string, unknown>) => (file.audioMeta as Record<string, unknown>).sizeBytes = 'big'],
  ] as Array<[string, (file: Record<string, unknown>) => void]>)(
    'rejects a file where %s',
    (_name, breakIt) => {
      const data = fileData();
      const parsed = JSON.parse(serializeProjectFile(data)) as Record<string, unknown>;
      breakIt(parsed);

      expectDomainError(() => parseProjectFile(JSON.stringify(parsed)), 'invalid-project-file');
    },
  );
});
