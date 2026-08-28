import { DomainError } from './errors';
import { deriveLabels } from './labels';
import type { Marker } from './marker';
import { setAliases } from './markers';
import type { Movement } from './movement';
import { parseYouTubeLink } from './youtube';

/** The only schema version this app reads and writes. */
export const SCHEMA_VERSION = 1;

/** Where a project's recording comes from; absent in a file means upload. */
export type ProjectSource = 'upload' | 'youtube';

/** The `project` section of a project file. */
export interface ProjectInfo {
  id: string;
  name: string;
  /** Epoch ms. */
  createdAt: number;
  /** Epoch ms. */
  updatedAt: number;
  /**
   * The recording's origin. Optional on disk — absent means upload, so files
   * from before the field existed read exactly as they always did — and
   * normalized by parsing, so consumers never see a missing discriminator.
   */
  source: ProjectSource;
}

/**
 * Recording identity — the facts that make a label set applicable to exactly
 * one recording. `sha256` is the hard check; `duration` is a soft check.
 */
export interface AudioMeta {
  sha256: string;
  /** Seconds, float. */
  duration: number;
  mimeType: string;
  filename: string;
  sizeBytes: number;
  source: string;
  license: string;
  attribution: string;
}

/** Domain data carried by a project file, in both serialize and parse directions. */
export interface ProjectFileData {
  project: ProjectInfo;
  markers: Marker[];
  /** The recording's movements, optional (ADR-0005): absent or empty is today's behaviour. */
  movements: Movement[];
  audioMeta: AudioMeta;
}

/**
 * The audioMeta a YouTube project file carries: the identity that applies —
 * canonical URL, known duration, title — and nothing that describes stored
 * bytes. Export and import both pass through this one function, so the two
 * directions can never drift apart on which fields are empty.
 */
export function youtubeAudioMeta(meta: AudioMeta): AudioMeta {
  return {
    ...meta,
    sha256: '',
    mimeType: '',
    sizeBytes: 0,
    license: '',
    attribution: '',
  };
}

/**
 * Serializes a project to the versioned `project.json` format — the zip
 * export's data file and the community label-set format. Markers are written
 * in time order with their derived `label` for human review only: labels are
 * re-derived by time rank within each movement on import, never trusted from
 * the file. Movements are written only when present — absent means none, so
 * files that never carried them stay byte-for-byte the files this app always
 * wrote, and older app versions reading a movement-carrying file ignore the
 * unknown field rather than break on it.
 */
export function serializeProjectFile(data: ProjectFileData): string {
  // Uploads omit the discriminator — absent means upload, so upload files
  // stay byte-for-byte the files this app always wrote, and older app
  // versions reading a YouTube file ignore the unknown field (their honest
  // failure is on the missing audio, not on this).
  const project = {
    id: data.project.id,
    name: data.project.name,
    createdAt: data.project.createdAt,
    updatedAt: data.project.updatedAt,
    ...(data.project.source === 'youtube' ? { source: data.project.source } : {}),
  };
  const file = {
    schemaVersion: SCHEMA_VERSION,
    project,
    markers: deriveLabels(data.markers, data.movements).map((m) => ({
      id: m.id,
      time: m.time,
      label: m.label,
      aliases: m.aliases,
      createdAt: m.createdAt,
    })),
    ...(data.movements.length > 0 ? { movements: data.movements } : {}),
    audioMeta: data.audioMeta,
  };

  // Pretty-printed: label-set files are reviewed by humans in PRs.
  return JSON.stringify(file, null, 2);
}

/**
 * Parses a `project.json` file. Tolerates unknown fields within a known
 * version (forward compatibility), rejects newer schema versions with a clear
 * error, and validates the structure it does know — so a malformed or
 * hand-edited file fails loudly instead of corrupting state.
 *
 * Marker `label`s in the file are ignored: labels are informational and
 * re-derived by time rank on import, so a hand-edited file cannot break the
 * no-holes invariant. The other domain invariants — unique marker ids and the
 * alias rules — are enforced here too, so a hand-edited file cannot corrupt
 * state that every later operation assumes.
 */
export function parseProjectFile(text: string): ProjectFileData {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw invalidFile('The file is not valid JSON.');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw invalidFile('the file root must be an object.');
  }
  const root = raw as JsonObject;

  const schemaVersion = root.schemaVersion;
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw invalidFile('"schemaVersion" must be a positive integer.');
  }
  if (schemaVersion > SCHEMA_VERSION) {
    throw new DomainError(
      `This file uses schema version ${schemaVersion}, but this app supports version ${SCHEMA_VERSION}. Update the app to import it.`,
      'unsupported-schema-version',
    );
  }

  // The section readers throw neutral DomainErrors; rebrand those as file
  // errors so every malformed section reads as one boundary. Anything else
  // is a semantic error and keeps its own code.
  try {
    const project = readProject(root.project);
    let audioMeta = readAudioMeta(root.audioMeta);
    // A YouTube file's recording identity is its canonical URL. A string that
    // names no video would import a project that can never point at one, so
    // refuse it here — and normalize every accepted link form to the canonical
    // URL, so any file that parses carries one recording identity.
    if (project.source === 'youtube') {
      try {
        audioMeta = { ...audioMeta, source: parseYouTubeLink(audioMeta.source).canonicalUrl };
      } catch {
        throw invalidFile('"audioMeta.source" must be a valid YouTube video link for a YouTube project.');
      }
    }
    // Movements are optional (ADR-0005): a file without the field reads as a
    // project with none, exactly as files from before the field existed did.
    const movements = root.movements === undefined ? [] : parseMovements(root.movements);
    return {
      project,
      markers: parseMarkers(root.markers),
      movements,
      audioMeta,
    };
  } catch (error) {
    if (
      error instanceof DomainError &&
      (error.code === 'invalid-value' ||
        error.code === 'invalid-markers' ||
        error.code === 'invalid-movements')
    ) {
      throw invalidFile(error.message);
    }
    throw error;
  }
}

type JsonObject = Record<string, unknown>;

function invalidFile(reason: string): DomainError {
  return new DomainError(`Invalid project file: ${reason}`, 'invalid-project-file');
}

function invalidValue(reason: string): DomainError {
  return new DomainError(reason, 'invalid-value');
}

function invalidMarkers(reason: string): DomainError {
  return new DomainError(reason, 'invalid-markers');
}

function invalidMovements(reason: string): DomainError {
  return new DomainError(reason, 'invalid-movements');
}

// The section readers share these assertion helpers; each throws a neutral
// DomainError that the owning boundary (this file, or the Commons row parser)
// rebrands with its own context.
function assertObject(value: unknown, path: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidValue(`${path} must be an object.`);
  }
  // TS narrows the guard to `object`; a non-null, non-array object is a JsonObject.
  return value as JsonObject;
}

function assertArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw invalidValue(`${path} must be an array.`);
  }
  return value;
}

function assertString(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    throw invalidValue(`${path} must be a string.`);
  }
  return value;
}

function assertNonEmptyString(value: unknown, path: string): string {
  const string = assertString(value, path);
  if (string.trim() === '') {
    throw invalidValue(`${path} must not be blank.`);
  }
  return string;
}

function assertFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalidValue(`${path} must be a finite number.`);
  }
  return value;
}

function assertNonNegativeNumber(value: unknown, path: string): number {
  const number = assertFiniteNumber(value, path);
  if (number < 0) {
    throw invalidValue(`${path} must not be negative.`);
  }
  return number;
}

function readProject(value: unknown): ProjectInfo {
  const raw = assertObject(value, '"project"');
  return {
    id: assertString(raw.id, '"project.id"'),
    name: assertString(raw.name, '"project.name"'),
    createdAt: assertFiniteNumber(raw.createdAt, '"project.createdAt"'),
    updatedAt: assertFiniteNumber(raw.updatedAt, '"project.updatedAt"'),
    source: readSource(raw.source),
  };
}

/** The optional on-disk discriminator, defaulted to upload when absent. */
function readSource(value: unknown): ProjectSource {
  if (value === undefined) return 'upload';
  if (value === 'upload' || value === 'youtube') return value;
  throw invalidFile('"project.source" must be "upload" or "youtube" when present.');
}

/**
 * Parses a markers document — the shared validation for every boundary where
 * markers arrive as JSON: a project file's `"markers"` and a Commons
 * label-set row's markers document. Validates shape, enforces unique marker
 * ids, and routes every marker through the domain's own setAliases (it trims
 * and enforces every alias rule against the final derived label set), so a
 * hand-edited document cannot smuggle in state the app itself could not
 * create. Errors are neutral DomainErrors; the owning boundary rebrands them.
 */
export function parseMarkers(value: unknown): Marker[] {
  const raw = assertArray(value, '"markers"');
  const markers = raw.map((item, index) => {
    const marker = assertObject(item, `"markers[${index}]"`);
    return {
      id: assertString(marker.id, `"markers[${index}].id"`),
      time: assertNonNegativeNumber(marker.time, `"markers[${index}].time"`),
      aliases: assertArray(marker.aliases, `"markers[${index}].aliases"`).map((alias, aliasIndex) =>
        assertString(alias, `"markers[${index}].aliases[${aliasIndex}]"`),
      ),
      createdAt: assertFiniteNumber(marker.createdAt, `"markers[${index}].createdAt"`),
    };
  });

  // Marker ids are stable identity for aliases, undo, and export; two markers
  // sharing one would make later operations target the wrong marker.
  const seenIds = new Set<string>();
  for (const m of markers) {
    if (seenIds.has(m.id)) {
      throw invalidMarkers(`"markers" contain duplicate id "${m.id}".`);
    }
    seenIds.add(m.id);
  }

  let validated = markers;
  for (const m of markers) {
    try {
      validated = setAliases(validated, m.id, m.aliases);
    } catch (error) {
      if (error instanceof DomainError) {
        throw invalidMarkers(`marker "${m.id}": ${error.message}`);
      }
      throw error;
    }
  }
  return validated;
}

/**
 * Parses a movements document — the shared validation for every boundary
 * where movements arrive as JSON: a project file's `"movements"` and a
 * Commons label-set row's movements document. Validates shape, enforces
 * unique ids and strictly increasing starts (ADR-0005), so a hand-edited
 * document cannot smuggle in state the surface cannot draw. Errors are
 * neutral DomainErrors; the owning boundary rebrands them.
 */
export function parseMovements(value: unknown): Movement[] {
  const raw = assertArray(value, '"movements"');
  const movements = raw.map((item, index) => {
    const movement = assertObject(item, `"movements[${index}]"`);
    return {
      id: assertString(movement.id, `"movements[${index}].id"`),
      name: assertNonEmptyString(movement.name, `"movements[${index}].name"`),
      start: assertNonNegativeNumber(movement.start, `"movements[${index}].start"`),
    };
  });

  // Movement ids are identity; two sharing one would make membership
  // derivation ambiguous.
  const seenIds = new Set<string>();
  for (const movement of movements) {
    if (seenIds.has(movement.id)) {
      throw invalidMovements(`"movements" contain duplicate id "${movement.id}".`);
    }
    seenIds.add(movement.id);
  }

  // Starts are strictly increasing: a boundary that moves backwards makes the
  // latest-start-≤-time rule point two movements at the same stretch.
  for (let i = 1; i < movements.length; i += 1) {
    if (movements[i].start <= movements[i - 1].start) {
      throw invalidMovements('"movements" starts must be strictly increasing.');
    }
  }

  return movements;
}

function readAudioMeta(value: unknown): AudioMeta {
  const raw = assertObject(value, '"audioMeta"');
  return {
    sha256: assertString(raw.sha256, '"audioMeta.sha256"'),
    duration: assertNonNegativeNumber(raw.duration, '"audioMeta.duration"'),
    mimeType: assertString(raw.mimeType, '"audioMeta.mimeType"'),
    filename: assertString(raw.filename, '"audioMeta.filename"'),
    sizeBytes: assertNonNegativeNumber(raw.sizeBytes, '"audioMeta.sizeBytes"'),
    source: assertString(raw.source, '"audioMeta.source"'),
    license: assertString(raw.license, '"audioMeta.license"'),
    attribution: assertString(raw.attribution, '"audioMeta.attribution"'),
  };
}
