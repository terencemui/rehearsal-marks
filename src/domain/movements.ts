import { DomainError } from './errors';
import { newId } from './id';
import type { Movement } from './movement';
import { FRAME_EPSILON } from './navigation';

/**
 * Movement set operations — the writes the markings page makes to a recording's
 * boundaries. Movements are markers' peers (ADR-0007), so these are the
 * movement twin of `markers.ts`: the same shape of pure operation over the
 * whole set, refusing what the model cannot hold and throwing the domain's own
 * guidance when it does.
 *
 * Membership and labels are not here and never will be: a movement's extent and
 * the markers inside it are derived from the starts (ADR-0005), so the only
 * facts to write are the boundaries themselves.
 */

/**
 * Mints a movement, as the surface does when a boundary is set at the playhead:
 * a fresh identity, the name the student gave it (or the provisional one the
 * surface supplies), and the moment the recording was at.
 */
export function createMovement(name: string, start: number): Movement {
  assertValidStart(start);
  // The name is checked here as well as on the way in (see `addMovement`), so
  // that what this mints is a movement the set would accept — as `createMarker`
  // returns a marker the set would accept. The surface never relies on that,
  // having no unnamed movement to offer, but a constructor that can hand back
  // something its own set refuses is a trap for the next caller.
  return { id: newId(), name: validateName(name), start };
}

/**
 * Adds a movement to the set, in time order. Starts stay strictly increasing
 * (ADR-0005), so a boundary must fall strictly after the movement before it and
 * strictly before the one after it — which, over an ordered set, is exactly the
 * rule that no two movements may share a start. A create that would violate it
 * is refused, naming the movement already there.
 *
 * "The same start" is judged to a media frame, not exactly. The surface places
 * a boundary at the playhead, and the playhead after a seek reads back off the
 * media element, which lands on a frame boundary up to ~26ms from the time that
 * was asked for — so a student who jumps to a movement's header and presses for
 * a boundary there is standing on that movement to within a frame, and an exact
 * comparison would wave through a second boundary a few milliseconds away. That
 * pair renders the same `MM:SS`, holds nothing between them, and restarts the
 * letters with nothing to restart — a boundary the student cannot see they
 * made. The domain's one notion of "the same instant" is the right one here,
 * and it is the same constant the marker walk already tolerates seeks with.
 */
export function addMovement(movements: readonly Movement[], movement: Movement): Movement[] {
  assertValidStart(movement.start);
  if (movements.some((m) => m.id === movement.id)) {
    throw new DomainError(
      `A movement with id "${movement.id}" already exists.`,
      'duplicate-movement-id',
    );
  }
  const clash = movements.find((m) => Math.abs(m.start - movement.start) <= FRAME_EPSILON);
  if (clash !== undefined) {
    throw new DomainError(
      `A movement already starts there — "${clash.name}". A movement must start strictly after ` +
        'the one before it and strictly before the one after it, so pick a moment between them.',
      'movement-start-taken',
    );
  }
  const name = validateName(movement.name);
  return [...movements, { ...movement, name }].sort((a, b) => a.start - b.start);
}

/**
 * Renames one movement, leaving its identity, its start, and every other
 * movement untouched. A rename is not a re-timing: the boundary stays where it
 * is, and so does every marker's membership of it.
 */
export function renameMovement(
  movements: readonly Movement[],
  id: string,
  name: string,
): Movement[] {
  if (!movements.some((m) => m.id === id)) {
    throw new DomainError(`No movement with id "${id}".`, 'movement-not-found');
  }
  const validated = validateName(name);
  return movements.map((m) => (m.id === id ? { ...m, name: validated } : m));
}

function assertValidStart(start: number): void {
  if (!Number.isFinite(start) || start < 0) {
    throw new DomainError(
      `Movement start must be a finite, non-negative number of seconds; got ${start}.`,
      'invalid-time',
    );
  }
}

/**
 * Trims a movement's name and refuses a blank one. A movement *is* a named
 * subdivision, so a boundary with nothing to call it is not one the surface
 * could draw — and the document parser refuses it back out of a row.
 */
function validateName(raw: string): string {
  const name = raw.trim();
  if (name === '') {
    throw new DomainError('A movement must be named.', 'movement-name-empty');
  }
  return name;
}
