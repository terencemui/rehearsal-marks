import { readFileSync } from 'node:fs';
import { cleanup, render, renderHook, screen } from '@testing-library/react';
import type { Mock } from 'vitest';
import { describe, expect, it, vi } from 'vitest';
import type { LabeledMarker } from '../domain';
import { mockController } from '../test/controller-fixture';
import { marker } from '../test/marker-fixture';
import { HelpTab } from './HelpTab';
import type { PlayerKeysOptions } from './playerKeys';
import { usePlayerKeys } from './playerKeys';

/**
 * The keyboard reference, held against the keyboard itself (T62).
 *
 * The reference is written twice — `docs/keyboard-reference.md`, and the Help
 * tab, which mirrors it — and both are prose, which is to say both can go on
 * naming a key that was taken away, or miss one that arrived. Neither is
 * checked against its own wording here. Each surface's table is held against
 * the hook instead: `usePlayerKeys` is mounted as that surface mounts it, every
 * key in `CANDIDATE_KEYS` is pressed at it, and the table must name precisely
 * what answered. A last check holds the Help tab to the doc, so the two copies
 * cannot drift apart while both stay true to the keyboard.
 *
 * What that does and does not cover. The two configurations below are
 * transcriptions of how the surfaces call the hook — `MarkingsPage.tsx` and
 * `Player.tsx` — not reads of them, so a surface that stopped supplying a
 * callback while these kept supplying it would not be caught here; that the
 * pages are wired as transcribed is theirs to show (MarkingsPage.test.tsx,
 * Player.test.tsx), as is the pointer half of each table, which is no key at
 * all. What is pinned is the part that rots silently: which keys the hook
 * answers to, given a surface's callbacks, and what the tables claim.
 *
 * What the tables are held to is the *keys*; the prose is not. Both documents
 * name things the app deliberately does not answer — `Alt`+arrows, which are the
 * browser's again, and `Enter` in a field, which the field handles rather than
 * the window — and a reference that could not say so would be a poorer one.
 * Only the tables claim to be the list of the app's shortcuts.
 */
const DOC = readFileSync('docs/keyboard-reference.md', 'utf8');

/** The heading each surface's table sits under, in both documents. */
const PRACTICE_HEADING = 'The practice surface';
const MARKINGS_HEADING = 'The Markings page';

/**
 * Every key worth asking about: the named keys a recording's shortcuts would
 * plausibly claim, the printable range, and the bracket keys. A key outside
 * this list cannot come back as answered, which is why the list is generous
 * rather than tailored to what the reference says — a reference is only
 * checked by an audience that was not told the answer.
 */
const CANDIDATE_KEYS = [
  ' ',
  'Enter',
  'Escape',
  'Tab',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  '[',
  ']',
  '{',
  '}',
  ...'abcdefghijklmnopqrstuvwxyz',
  ...'0123456789',
  '-',
  '=',
  ';',
  "'",
  ',',
  '.',
  '/',
  '\\',
  '`',
  '?',
  '!',
  '@',
  '#',
  '$',
  '%',
  '^',
  '&',
  '*',
  '(',
  ')',
  '_',
  '+',
];

/**
 * The two keys a shifted bracket arrives as on most layouts. They are the same
 * key as `[` and `]` — the hook reads them that way, with `Shift` choosing the
 * step rather than the key — so they are folded back before the comparison, and
 * the reference names each key once, by its unshifted spelling.
 */
const SAME_KEY_SPELLED_OTHERWISE: Record<string, string> = { '{': '[', '}': ']' };

/** Two markers for the walk keys to land on, inside the mock controller's duration. */
const MARKERS: LabeledMarker[] = [
  { ...marker('m1', 3), label: 'A' },
  { ...marker('m2', 7), label: 'B' },
];

/** A keypress: the DOM key, and whatever modifiers the press carries. */
type Chord = KeyboardEventInit & { key: string };

/**
 * One surface's configuration of the shared hook. `spies` are the callbacks'
 * own mocks — the ones the probe reads the answering off, since a surface that
 * supplies no callback has no way to answer with it.
 */
interface Surface {
  options: Omit<PlayerKeysOptions, 'controller' | 'markers' | 'settled'>;
  spies: Mock[];
}

/** The markings page's configuration (T56, T57): every key the page offers is wired. */
function markingsPage(): Surface {
  const onAddMarker = vi.fn();
  const onNudge = vi.fn();
  return { options: { onAddMarker, onNudge }, spies: [onAddMarker, onNudge] };
}

/** The practice surface's configuration: playback, and no callback that could author. */
function practiceSurface(): Surface {
  return { options: {}, spies: [] };
}

/**
 * Mounts the hook with one surface's configuration and hands over a way to
 * press keys at it, tearing the mount down again before returning: the hook
 * listens at the window, so a second mount left standing would answer for the
 * first.
 */
function withSurface<T>(surface: Surface, read: (answered: (chord: Chord) => boolean) => T): T {
  const controller = mockController();
  renderHook(() =>
    usePlayerKeys({ controller, markers: MARKERS, settled: true, ...surface.options }),
  );
  const watched: Mock[] = [controller.togglePlay as Mock, controller.seek as Mock, ...surface.spies];
  try {
    return read((chord) => {
      for (const spy of watched) spy.mockClear();
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...chord });
      window.dispatchEvent(event);
      // Answered is either way a shortcut shows itself: the recording moved or
      // a callback ran, or the event was claimed from the browser before it
      // could do something of its own.
      return event.defaultPrevented || watched.some((spy) => spy.mock.calls.length > 0);
    });
  } finally {
    cleanup();
  }
}

/** The keys a surface answers to, each named once, by its unshifted spelling. */
function keysAnsweredTo(surface: Surface): string[] {
  const answered = withSurface(surface, (press) => {
    const keys = new Set<string>();
    for (const key of CANDIDATE_KEYS) {
      if (press({ key })) keys.add(SAME_KEY_SPELLED_OTHERWISE[key] ?? key);
    }
    return [...keys];
  });
  return answered.sort();
}

/** Whether a surface answers one press, modifiers and all. */
function answersTo(surface: Surface, chord: Chord): boolean {
  return withSurface(surface, (press) => press(chord));
}

/** The tables of a markdown document, keyed by the `##` heading above each. */
function documentedTables(markdown: string): Map<string, string[][]> {
  const tables = new Map<string, string[][]>();
  let heading: string | null = null;
  let rows: string[][] | null = null;
  for (const line of markdown.split('\n')) {
    const title = /^##\s+(.*)$/.exec(line);
    if (title !== null) {
      heading = title[1].trim();
      rows = null;
      continue;
    }
    if (!line.startsWith('|')) {
      rows = null;
      continue;
    }
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    // The `|---|---|` line under the header is not a row of the table.
    if (cells.every((cell) => /^:?-+:?$/.test(cell))) continue;
    if (heading === null) continue;
    if (rows === null) {
      rows = [];
      tables.set(heading, rows);
    }
    rows.push(cells);
  }
  return tables;
}

/**
 * A table cell as it reads. Inline code in the document is emphasis — the
 * document says `` `Space` `` where the page says `Space` — so it is stripped
 * before the two are compared.
 */
function readable(cell: string): string {
  return cell.replace(/`/g, '').trim();
}

/** A document table's rows, as written. */
function documentedRows(heading: string): string[][] {
  const rows = documentedTables(DOC).get(heading);
  if (rows === undefined) {
    throw new Error(`The reference has no "${heading}" table.`);
  }
  return rows;
}

/**
 * A document table's rows as they read — inline code stripped — so they can be
 * held against the rows a page renders, where `<kbd>Space</kbd>` is the word
 * and nothing more.
 */
function readableRows(heading: string): string[][] {
  return documentedRows(heading).map((row) => row.map(readable));
}

/**
 * The key each glyph names in the reference, as the DOM spells it. A glyph with
 * no entry here is a key this probe does not know — which is the drift these
 * tests exist to catch, so it is loud rather than ignored.
 */
const GLYPH_KEYS: Record<string, string> = {
  Space: ' ',
  '←': 'ArrowLeft',
  '→': 'ArrowRight',
  '↑': 'ArrowUp',
  '↓': 'ArrowDown',
  M: 'm',
  '[': '[',
  ']': ']',
};

/**
 * The keys one of the reference's tables documents. A row documents a key in
 * its first cell's inline code; the rows naming a click carry none, which is
 * how the pointer affordances beside the shortcuts are left out of the count.
 */
function documentedKeys(heading: string): string[] {
  const keys = new Set<string>();
  for (const [glyphCell] of documentedRows(heading).slice(1)) {
    for (const [, glyph] of glyphCell.matchAll(/`([^`]+)`/g)) {
      const key = GLYPH_KEYS[glyph];
      if (key === undefined) {
        throw new Error(`The reference names "${glyph}", which is no key this app knows.`);
      }
      keys.add(key);
    }
  }
  return [...keys].sort();
}

/** The cells of a rendered Help tab table, by the heading that names it. */
function helpTabRows(heading: string): string[][] {
  const table = screen.getByRole('table', { name: heading });
  return Array.from(table.querySelectorAll('tr')).map((row) =>
    Array.from(row.querySelectorAll('th, td')).map((cell) => cell.textContent?.trim() ?? ''),
  );
}

describe('the keyboard reference describes the keyboard (T62)', () => {
  it('names exactly the keys the markings page answers to', () => {
    expect(keysAnsweredTo(markingsPage())).toEqual(documentedKeys(MARKINGS_HEADING));
  });

  it('names exactly the keys the practice surface answers to', () => {
    expect(keysAnsweredTo(practiceSurface())).toEqual(documentedKeys(PRACTICE_HEADING));
  });

  it('gives the markings page every playback key the practice surface has, and no authoring key to the practice surface', () => {
    // The relation between the two tables is the point of both: one surface's
    // keys are the other's plus the two that change a marker, and the surface
    // that may not author is described as having no key that could.
    const markings = new Set(documentedKeys(MARKINGS_HEADING));
    for (const key of documentedKeys(PRACTICE_HEADING)) {
      expect(markings).toContain(key);
    }
    expect(documentedKeys(MARKINGS_HEADING)).not.toEqual(documentedKeys(PRACTICE_HEADING));
  });

  it('leaves the chords the reference says are the browser’s to the browser', () => {
    const markings = markingsPage();
    for (const arrow of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      // `Alt`+arrows are the browser's again (ADR-0003), and `Shift`+arrows stay
      // the browser's too — scroll and selection.
      expect(answersTo(markings, { key: arrow, altKey: true })).toBe(false);
      expect(answersTo(markings, { key: arrow, shiftKey: true })).toBe(false);
      expect(answersTo(markings, { key: arrow, ctrlKey: true })).toBe(false);
      expect(answersTo(markings, { key: arrow, metaKey: true })).toBe(false);
    }
    // `⌘M` minimises the window on macOS, so the one authoring key is a plain
    // chord — and the plain one is still the key that places a marker.
    expect(answersTo(markings, { key: 'm', metaKey: true })).toBe(false);
    expect(answersTo(markings, { key: 'm' })).toBe(true);
  });

  it('keeps the Help tab’s keyboard reference the document’s', () => {
    render(<HelpTab />);

    for (const heading of [PRACTICE_HEADING, MARKINGS_HEADING]) {
      expect(helpTabRows(heading)).toEqual(readableRows(heading));
    }
  });
});
