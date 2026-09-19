import { describe, expect, it } from 'vitest';
import { DomainError } from './errors';
import type { Movement } from './movement';
import { addMovement, createMovement, renameMovement } from './movements';

/** The ADR-0005 boundary model: start-only, strictly increasing starts. */
function movements(): Movement[] {
  return [
    { id: 'm1', name: 'I. Allegro', start: 0 },
    { id: 'm2', name: 'II. Adagio', start: 831 },
  ];
}

describe('addMovement', () => {
  it('places a movement among the others by its start, keeping them in time order', () => {
    const added = addMovement(movements(), { id: 'm3', name: 'III. Finale', start: 1620 });
    expect(added.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);

    // A boundary set at the playhead lands in the middle as often as at the
    // end — the list is ordered by start, never by when it was authored.
    const between = addMovement(movements(), { id: 'm4', name: 'I½', start: 400 });
    expect(between.map((m) => m.id)).toEqual(['m1', 'm4', 'm2']);
  });

  it('refuses a start another movement already holds, naming the one in the way', () => {
    // The playhead can be parked exactly on a boundary — clicking a movement
    // header seeks there — so adding a movement "where the recording is" lands
    // on a start that is taken as readily as on one that is free.
    let refusal: DomainError | null = null;
    try {
      addMovement(movements(), { id: 'm3', name: 'III. Finale', start: 831 });
    } catch (error) {
      refusal = error as DomainError;
    }

    expect(refusal?.code).toBe('movement-start-taken');
    // The guidance names the movement in the way, and states the rule it broke:
    // a boundary must sit strictly between its neighbours.
    expect(refusal?.message).toContain('II. Adagio');
    expect(refusal?.message).toMatch(/strictly after .* strictly before/);
  });

  it('counts a start within a media frame of another as the same start', () => {
    // The gesture this refusal exists for is "jump to a movement's header, then
    // set a boundary where the recording is" — and the playhead reads back off
    // the media element, which snaps a seek to a frame. So the playhead is
    // standing *near* 831, not on it, and `===` would wave through a second
    // boundary a few milliseconds away: same MM:SS, nothing between them, the
    // letters restarting for nothing.
    const codeAt = (start: number): string | undefined => {
      try {
        addMovement(movements(), { id: 'm3', name: 'III. Finale', start });
        return undefined;
      } catch (error) {
        return (error as DomainError).code;
      }
    };

    expect(codeAt(831.02)).toBe('movement-start-taken');
    // And the tolerance is a frame, not a fudge: a boundary the student really
    // did set somewhere else is still theirs to set.
    expect(codeAt(831.06)).toBeUndefined();
  });

  it('trims the name it is given, and refuses one that is blank', () => {
    // A movement is a *named* subdivision — the name is the whole of what a
    // boundary says — so blank is not a movement the surface could draw, and
    // the document parser would refuse the row back.
    expect(addMovement([], { id: 'm1', name: '  I. Allegro  ', start: 0 })[0].name).toBe(
      'I. Allegro',
    );

    let refusal: DomainError | null = null;
    try {
      addMovement([], { id: 'm1', name: '   ', start: 0 });
    } catch (error) {
      refusal = error as DomainError;
    }
    expect(refusal?.code).toBe('movement-name-empty');
  });

  it('refuses a start that is not a real time, and an id the set already holds', () => {
    // Both would come back out of the document parser as an unreadable row —
    // the same two facts about one movement that `parseMovements` checks.
    const codes = [{ id: 'm9', name: 'IV', start: -1 }, { id: 'm9', name: 'IV', start: NaN }].map(
      (movement) => {
        try {
          addMovement([], movement);
          return null;
        } catch (error) {
          return (error as DomainError).code;
        }
      },
    );
    expect(codes).toEqual(['invalid-time', 'invalid-time']);

    let idRefusal: DomainError | null = null;
    try {
      addMovement(movements(), { id: 'm1', name: 'IV', start: 400 });
    } catch (error) {
      idRefusal = error as DomainError;
    }
    expect(idRefusal?.code).toBe('duplicate-movement-id');
  });
});

describe('createMovement', () => {
  it('mints a movement at a name and a time, with an identity of its own', () => {
    const finale = createMovement('III. Finale', 1620);
    expect(finale.name).toBe('III. Finale');
    expect(finale.start).toBe(1620);

    // Identity follows the movement, never its name or its start: two
    // boundaries can share either without being the same boundary.
    const another = createMovement('III. Finale', 1620);
    expect(another.id).not.toBe(finale.id);
  });

  it('mints nothing the movement set would refuse back', () => {
    // A constructor that can hand back what its own set rejects is a trap: the
    // caller has to know the rules too. `createMarker` returns a marker that is
    // already valid, and so does this — a blank name is refused at the mint,
    // and the name that comes back is the trimmed one the set will keep.
    expect(createMovement('  III. Finale  ', 1620).name).toBe('III. Finale');

    let refusal: DomainError | null = null;
    try {
      createMovement('   ', 1620);
    } catch (error) {
      refusal = error as DomainError;
    }
    expect(refusal?.code).toBe('movement-name-empty');
  });
});

describe('renameMovement', () => {
  it('renames the movement it names, and moves nothing else', () => {
    const renamed = renameMovement(movements(), 'm2', 'II. Andante con moto');

    expect(renamed.map((m) => m.name)).toEqual(['I. Allegro', 'II. Andante con moto']);
    // A rename is not a re-timing: the boundaries stay exactly where they were.
    expect(renamed.map((m) => m.start)).toEqual([0, 831]);
  });

  it('refuses a blank name, and an id the set does not hold', () => {
    const codeOf = (run: () => void): string | undefined => {
      try {
        run();
        return undefined;
      } catch (error) {
        return (error as DomainError).code;
      }
    };

    // The field is emptied before it is retyped; the record keeps the name it
    // has until a real one arrives, so a half-typed rename never lands.
    expect(codeOf(() => renameMovement(movements(), 'm1', '  '))).toBe('movement-name-empty');
    expect(codeOf(() => renameMovement(movements(), 'nope', 'IV'))).toBe('movement-not-found');
  });
});
