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
    // The create lands on a boundary that is already there, which is the same
    // refusal a re-time earns for the same reason — so it is the same sentence.
    throw boundaryRefusal(clash, true);
  }
  const name = validateName(movement.name);
  return [...movements, { ...movement, name }].sort((a, b) => a.start - b.start);
}

/**
 * Re-times one movement — moves its boundary to `start`. The movement twin of
 * `moveMarker`, and the one movement operation with a rule of its own: starts
 * stay strictly increasing (ADR-0005), so a boundary may not be moved onto or
 * past either of its neighbours. A re-time that would is refused, naming the
 * movement in the way; the set is never silently rearranged behind the
 * student's back.
 *
 * Assumes the set is in start order, as `addMovement` produces it and
 * `parseMovements` enforces — a movement's neighbours are the ones either side
 * of it in the list, which is what its own extent is derived from.
 */
export function moveMovement(
  movements: readonly Movement[],
  id: string,
  start: number,
): Movement[] {
  assertValidStart(start);
  const index = findIndex(movements, id);
  assertFitsBetweenNeighbours(movements, index, start);
  return updateAt(movements, index, { start }).sort((a, b) => a.start - b.start);
}

/**
 * Refuses a start that does not fit where the movement currently sits. A
 * movement's neighbours are the two boundaries its own extent is drawn
 * between, so a re-time must land strictly inside them — reaching one and
 * passing one are both out, and the guidance says which happened and names the
 * movement in the way.
 *
 * Both edges are judged to a media frame, the same tolerance `addMovement`
 * judges a create by, and for the same reason: a boundary set at the playhead
 * reads back off the media element, so it lands a frame or so from the time
 * that was asked for, and two boundaries inside one frame render the same
 * MM:SS with nothing between them.
 *
 * The window subsumes the create's rule for a movement already in the set: no
 * movement lies strictly between its neighbours, so keeping inside them is
 * exactly keeping off every other start.
 */
function assertFitsBetweenNeighbours(
  movements: readonly Movement[],
  index: number,
  start: number,
): void {
  const previous = movements[index - 1];
  const next = movements[index + 1];
  if (previous !== undefined && start <= previous.start + FRAME_EPSILON) {
    throw boundaryRefusal(previous, Math.abs(start - previous.start) <= FRAME_EPSILON);
  }
  if (next !== undefined && start >= next.start - FRAME_EPSILON) {
    throw boundaryRefusal(next, Math.abs(start - next.start) <= FRAME_EPSILON);
  }
}

/**
 * The refusal a boundary earns for landing where it may not, in the words for
 * what actually happened: landing on a boundary that is already there is one
 * thing, and putting this movement on the far side of one is another — and the
 * second is the one the ordering rule exists for, since it is the one that
 * would leave two extents overlapping.
 *
 * One refusal for a create and for a re-time both, because it is one rule: a
 * create that lands on an existing start breaks the strict ordering exactly as
 * a re-time that lands on a neighbour does, and says so in the same words.
 */
function boundaryRefusal(movement: Movement, onIt: boolean): DomainError {
  const guidance =
    'A movement must start strictly after the one before it and strictly before the one after ' +
    'it, so pick a moment between them.';
  return new DomainError(
    onIt
      ? `A movement already starts there — "${movement.name}". ${guidance}`
      : `That would cross "${movement.name}". ${guidance}`,
    onIt ? 'movement-start-taken' : 'movement-start-crossed',
  );
}

/**
 * Removes one movement. The twin of `removeMarker`, and — deliberately — no
 * more than a removal: the set alone is written, and what the recording holds
 * outside it is not this function's to touch.
 *
 * What that leaves is the whole of ADR-0007's rule about deleting a movement:
 * **the markers inside it are not deleted with it.** They are never attached to
 * a movement in the first place — membership is derived from the starts
 * (ADR-0005) and labels are derived from membership — so removing a boundary
 * re-derives both, and a mark that stood inside it simply falls into whatever
 * movement now runs over its time: the one before it, or the leading,
 * movement-less group if it was the first.
 */
export function removeMovement(movements: readonly Movement[], id: string): Movement[] {
  const index = findIndex(movements, id);
  return movements.filter((_, i) => i !== index);
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
  const index = findIndex(movements, id);
  const validated = validateName(name);
  return updateAt(movements, index, { name: validated });
}

function findIndex(movements: readonly Movement[], id: string): number {
  const index = movements.findIndex((m) => m.id === id);
  if (index === -1) {
    throw new DomainError(`No movement with id "${id}".`, 'movement-not-found');
  }
  return index;
}

function updateAt(
  movements: readonly Movement[],
  index: number,
  patch: Partial<Movement>,
): Movement[] {
  return movements.map((m, i) => (i === index ? { ...m, ...patch } : m));
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
