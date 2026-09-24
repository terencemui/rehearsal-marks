import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import { useSearchParams } from 'react-router';
import {
  deriveLabels,
  formatTime,
  formatWholeSeconds,
  movementForTime,
  nudgedTime,
  NUDGE_COARSE_STEP_SECONDS,
  NUDGE_STEP_SECONDS,
  parseTime,
} from '../domain';
import type { LabeledMarker, Marker, Movement } from '../domain';
import { PrototypeBar } from './PrototypeBar';
import './player.css';
import './markings.css';
import './prototype.css';

/**
 * PROTOTYPE — throwaway, dev-only, no tests, no persistence.
 *
 * The question: **where should the correction controls live on the markings
 * page's active row, and does the answer hold up at the panel's real widths?**
 *
 * The grilling settled a shape on paper — the row's own clock becomes the
 * millisecond time field while the row is active, the alias sits beside the
 * letter, and Delete becomes a trash glyph. Paper could not say whether a 280px
 * column survives it, or whether a row that swaps its clock for a field reads
 * at all. So three structural variants of *where the correction lives* were
 * put on one route and looked at. The verdict:
 *
 *   A  **In the row** — KEPT. The row's clock slot becomes the time field while
 *      active; the decks sit below it, minus flush left and plus flush right;
 *      the letter and the time are the row's two jump targets. The movement
 *      header is the same row, one indent step out.
 *   B  **In a block below** — rejected. The row never changes shape, and the
 *      field and decks live in a tinted panel under it. One shape per row, but
 *      the row's time shows twice while active, and the block reads as a second
 *      row of the list rather than as part of the row above.
 *   C  **One inline strip** — rejected. Everything on the row's own line, the
 *      decks flanking the field. At the panel's widths the row has no room for
 *      it: the correction group was wider than the column it had to fit.
 *
 * What the second round changed, all of it in A:
 *
 *   - **One row, twice.** A movement's header and a marker's row are now laid
 *     out by the same `.prototype-row` — same gap, same right padding, same
 *     clock slot, same delete control — so their trash cans stand in one column
 *     and their timestamps cannot drift apart.
 *   - **The alias is text until the row is active**, and a field only then —
 *     the same division the clock makes, in a slot of the same size, so the row
 *     is laid out identically in both states.
 *   - **Shift says what it does.** While Shift is held, the ±0.5s buttons read
 *     ±1s and take a whole second. The label and the click read one piece of
 *     state, so the button always does what it says.
 *   - **The whole row jumps.** A click anywhere on a row moves the playhead to
 *     it, as it does in production. The row's own controls keep their clicks:
 *     the fields take a caret, the trash deletes, and the letter and the clock
 *     jump on their own.
 *
 * `?w=` sets the side column to 280, 340 or 416px — the clamp's floor, its
 * middle and its cap (app.css) — because width is the whole question at the
 * 280px end.
 *
 * What this deliberately fakes, and why: the playhead (a click sets the active
 * row, where production derives it from the recording), the recording (a grey
 * stand-in at 16:9) and the alias field's width (flexible here; pinned at 96px
 * in production, which is 110px on screen and is one of the things being
 * tested). Everything else — the domain's parsing, nudging, labelling and
 * movement grouping, and the app's own stylesheets — is the real thing.
 */

/** A 6:12 recording, so every time reads in `mm:ss`/`mm:ss.mmm` and not `h:mm:ss`. */
const DURATION = 372;

/**
 * The half-second step the grilling asked for. It has no domain constant yet —
 * this is the one the prototype is proposing, beside the two that exist.
 */
const HALF_STEP_SECONDS = 0.5;

const SEED_MARKERS: Marker[] = [
  { id: 'm1', time: 12.4, aliases: ['Opening'], createdAt: 1 },
  { id: 'm2', time: 101.2, aliases: ['Second theme recap'], createdAt: 2 },
  { id: 'm3', time: 128.9, aliases: [], createdAt: 3 },
];

const SEED_MOVEMENTS: Movement[] = [
  { id: 'mv1', name: 'Movement I', start: 0 },
  { id: 'mv2', name: 'Movement II · Allegretto', start: 96.4 },
];

/** One variant, because the other two lost — the bar names what is on screen. */
const VARIANTS = [{ key: 'A', name: 'In the row' }];

const WIDTHS: { key: string; px: number; note: string }[] = [
  { key: '280', px: 280, note: 'the clamp’s floor' },
  { key: '340', px: 340, note: 'mid' },
  { key: '416', px: 416, note: 'the clamp’s cap (26rem)' },
];

export function MarkingsRowsPrototype() {
  const [params, setParams] = useSearchParams();
  const width = WIDTHS.find((option) => option.key === params.get('w')) ?? WIDTHS[1];

  const [markers, setMarkers] = useState<Marker[]>(SEED_MARKERS);
  const [movements, setMovements] = useState<Movement[]>(SEED_MOVEMENTS);
  // The playhead's stand-in: which row carries the correction. Production
  // derives this from the recording, and a click is how the student moves it
  // there too — so clicking a row here means what it means there.
  const [active, setActive] = useState<string | null>('m2');
  const shiftHeld = useShiftHeld();

  const setWidth = useCallback(
    (key: string) => {
      const next = new URLSearchParams(params);
      next.set('w', key);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const onNudge = useCallback((id: string, delta: number) => {
    setMarkers((current) =>
      current.map((marker) =>
        marker.id === id ? { ...marker, time: nudgedTime(marker.time, delta) } : marker,
      ),
    );
    setMovements((current) =>
      current.map((movement) =>
        movement.id === id ? { ...movement, start: nudgedTime(movement.start, delta) } : movement,
      ),
    );
  }, []);

  const onSetTime = useCallback((id: string, text: string) => {
    let written: number;
    try {
      written = parseTime(text);
    } catch {
      // A refused time moves nothing. The field puts the truth back itself: it
      // is keyed on the time it holds, so a time that was taken re-seeds it.
      return;
    }
    setMarkers((current) =>
      current.map((marker) => (marker.id === id ? { ...marker, time: written } : marker)),
    );
    setMovements((current) =>
      current.map((movement) => (movement.id === id ? { ...movement, start: written } : movement)),
    );
  }, []);

  const onSetAlias = useCallback((marker: LabeledMarker, text: string): string => {
    const trimmed = text.trim();
    setMarkers((current) =>
      current.map((m) =>
        m.id === marker.id ? { ...m, aliases: trimmed === '' ? [] : [trimmed] } : m,
      ),
    );
    return trimmed;
  }, []);

  const onSetMovementName = useCallback((id: string, name: string): string => {
    const trimmed = name.trim() === '' ? 'Movement' : name.trim();
    setMovements((current) =>
      current.map((movement) => (movement.id === id ? { ...movement, name: trimmed } : movement)),
    );
    return trimmed;
  }, []);

  const onDelete = useCallback((id: string) => {
    setMarkers((current) => current.filter((marker) => marker.id !== id));
    setMovements((current) => current.filter((movement) => movement.id !== id));
    setActive((current) => (current === id ? null : current));
  }, []);

  const styles = { '--player-side-column': `${width.px}px` } as CSSProperties;

  return (
    <div>
      <p className="prototype-note">Prototype — the active row&rsquo;s correction controls</p>
      <p className="prototype-intro">
        Click anywhere on a row to move the &ldquo;playhead&rdquo; there; the row that has it grows
        its alias and time fields and the four nudges. Hold <kbd>Shift</kbd> and the{' '}
        <code>±0.5s</code> buttons say <code>±1s</code> and take a whole second. Try the width
        selector at 280px.
      </p>
      <div className="player-practice-split" style={styles}>
        <div className="player-video-column">
          <div className="prototype-video">the recording</div>
        </div>
        <div className="player-side-column">
          <section className="player-markers" aria-label="Markers">
            <div className="player-markers-head">
              <h2 className="player-markers-heading">Markers</h2>
              <div className="markings-add-controls">
                <button type="button" className="markings-add">
                  Add marker
                </button>
                <button type="button" className="markings-add-movement">
                  Add movement
                </button>
              </div>
            </div>
            <Rows
              markers={deriveLabels(markers, movements)}
              movements={movements}
              active={active}
              shiftHeld={shiftHeld}
              onActivate={setActive}
              onNudge={onNudge}
              onSetTime={onSetTime}
              onSetAlias={onSetAlias}
              onSetMovementName={onSetMovementName}
              onDelete={onDelete}
            />
          </section>
        </div>
      </div>
      <PrototypeBar variants={VARIANTS} current="A" onSelect={setWidth}>
        <label htmlFor="prototype-width">column</label>
        <select
          id="prototype-width"
          value={width.key}
          onChange={(event) => setWidth(event.target.value)}
        >
          {WIDTHS.map((option) => (
            <option key={option.key} value={option.key}>
              {option.px}px
            </option>
          ))}
        </select>
        <span>{width.note}</span>
      </PrototypeBar>
    </div>
  );
}

/**
 * Whether Shift is down, anywhere on the page. Tracked rather than read off the
 * click event, so the ±0.5s buttons can say what they will do *before* they are
 * clicked — and so the label and the click are the same piece of state rather
 * than two that can disagree.
 *
 * A held modifier outlives the window's focus — alt-tab away mid-press and no
 * keyup ever arrives — so losing focus forgets it.
 */
function useShiftHeld(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => setHeld(event.shiftKey);
    const onKeyUp = (event: KeyboardEvent): void =>
      setHeld(event.key === 'Shift' ? false : event.shiftKey);
    const onBlur = (): void => setHeld(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
  return held;
}

/* ------------------------------------------------------------------ the list */

interface RowsProps {
  markers: LabeledMarker[];
  movements: Movement[];
  active: string | null;
  shiftHeld: boolean;
  onActivate(id: string): void;
  onNudge(id: string, delta: number): void;
  onSetTime(id: string, text: string): void;
  onSetAlias(marker: LabeledMarker, text: string): string;
  onSetMovementName(id: string, name: string): string;
  onDelete(id: string): void;
}

/**
 * The markers list: each movement's header — a row like any other — followed by
 * the markers the movement groups, and a block of decks under whichever row the
 * playhead is on.
 *
 * A movement's decks go in a list item of their own *below* the header rather
 * than inside it: the header is sticky, and a correction block inside it would
 * grow the band it pins over the very markers it is the band for (ADR-0007).
 */
function Rows(props: RowsProps) {
  /**
   * A row is a seek target — a click anywhere on it moves the playhead there,
   * as it does in production — but the row now *contains* controls, so the
   * click has to know which of them already mean something. Anything
   * interactive is left to handle its own: the fields take a caret, the trash
   * deletes, and the letter and the clock jump on their own handlers.
   *
   * `closest` rather than a tag check, because a click on the trash lands on
   * the `<path>` inside its icon and not on the button itself.
   */
  const rowJump = (id: string) => (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('input, button, select, textarea') !== null) return;
    props.onActivate(id);
  };

  return (
    <ol className="player-marker-list">
      {groupMarkers(props.markers, props.movements).flatMap(({ movement, markers }) => [
        movement !== null && (
          <li key={`header-${movement.id}`} className="player-marker-movement">
            <div
              className="prototype-row prototype-row-band"
              onClick={rowJump(movement.id)}
            >
              <MovementNameField movement={movement} onSetMovementName={props.onSetMovementName} />
              {props.active === movement.id ? (
                <TimeField
                  key={movement.start}
                  time={movement.start}
                  label={`Time for movement ${movement.name}`}
                  onCommit={(text) => props.onSetTime(movement.id, text)}
                />
              ) : (
                <Clock
                  name={movement.name}
                  time={movement.start}
                  onJump={() => props.onActivate(movement.id)}
                />
              )}
              <DeleteControl
                label={`Delete movement ${movement.name}`}
                onDelete={() => props.onDelete(movement.id)}
              />
            </div>
          </li>
        ),
        movement !== null &&
          props.active === movement.id && (
            <li key={`decks-${movement.id}`} className="correcting" aria-current="true">
              <Decks id={movement.id} shiftHeld={props.shiftHeld} onNudge={props.onNudge} />
            </li>
          ),
        ...markers.map((marker) => {
          const carrying = props.active === marker.id;
          return (
            <li
              key={marker.id}
              className={carrying ? 'correcting' : undefined}
              aria-current={carrying ? 'true' : undefined}
            >
              <div className="prototype-row" onClick={rowJump(marker.id)}>
                <button
                  type="button"
                  className="prototype-letter"
                  title={`Jump to ${marker.label}`}
                  onClick={() => props.onActivate(marker.id)}
                >
                  {marker.label}
                </button>
                <Alias
                  marker={marker}
                  carrying={carrying}
                  onSetAlias={props.onSetAlias}
                />
                {carrying ? (
                  <TimeField
                    key={marker.time}
                    time={marker.time}
                    label={`Time for marker ${marker.label}`}
                    onCommit={(text) => props.onSetTime(marker.id, text)}
                  />
                ) : (
                  <Clock
                    name={`marker ${marker.label}`}
                    time={marker.time}
                    onJump={() => props.onActivate(marker.id)}
                  />
                )}
                <DeleteControl
                  label={`Delete marker ${marker.label}`}
                  onDelete={() => props.onDelete(marker.id)}
                />
              </div>
              {carrying && (
                <Decks id={marker.id} shiftHeld={props.shiftHeld} onNudge={props.onNudge} />
              )}
            </li>
          );
        }),
      ])}
    </ol>
  );
}

/** The same partition the panel itself makes: markers group under their movement. */
function groupMarkers(
  markers: readonly LabeledMarker[],
  movements: readonly Movement[],
): { movement: Movement | null; markers: LabeledMarker[] }[] {
  const groups = movements.map((movement) => ({
    movement: movement as Movement | null,
    markers: [] as LabeledMarker[],
  }));
  const byId = new Map(groups.map((group) => [group.movement!.id, group]));
  const leading = { movement: null as Movement | null, markers: [] as LabeledMarker[] };
  for (const marker of markers) {
    const movement = movementForTime(movements, marker.time);
    const group = movement !== null ? byId.get(movement.id) : undefined;
    (group ?? leading).markers.push(marker);
  }
  return leading.markers.length > 0 ? [leading, ...groups] : groups;
}

/* ---------------------------------------------------------------- the parts */

/** The trash glyph Delete becomes. `currentColor`, so the control's own ink is the icon's. */
function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M3.2 4.6h9.6M6.4 4.6V3.2h3.2v1.4M4.8 4.6l.55 8.1a1 1 0 0 0 1 .95h3.3a1 1 0 0 0 1-.95l.55-8.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The delete control, one component for both a marker's row and a movement's
 * header — which is most of why their trash cans line up. The accessible name
 * still says "Delete marker B", so the icon costs no one the word.
 */
function DeleteControl({ label, onDelete }: { label: string; onDelete(): void }) {
  return (
    <button
      type="button"
      className="prototype-delete"
      aria-label={label}
      title={label}
      onClick={onDelete}
    >
      <TrashIcon />
    </button>
  );
}

/** The row's time as a reading and a jump. Shared by both rows, so both read the same. */
function Clock({ name, time, onJump }: { name: string; time: number; onJump(): void }) {
  return (
    <button type="button" className="prototype-clock" title={`Jump to ${name}`} onClick={onJump}>
      {formatWholeSeconds(time, DURATION)}
    </button>
  );
}

/**
 * The millisecond field, in the clock's own slot. Uncontrolled and keyed on the
 * time it holds, so a nudge re-seeds it; on leaving, the caller's honest value
 * is written back — the exact time when the domain took the text, the unchanged
 * one when it refused it.
 */
function TimeField({
  time,
  label,
  onCommit,
}: {
  time: number;
  label: string;
  onCommit(text: string): void;
}) {
  const shown = formatTime(time, DURATION);
  return (
    <input
      type="text"
      className="markings-row-time"
      defaultValue={shown}
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
      onBlur={(event) => {
        const field = event.currentTarget;
        if (field.value !== shown) {
          onCommit(field.value.trim() === '' ? shown : field.value);
        }
        // A commit that was taken re-seeds the field through the record on the
        // next render — the element is keyed on the time. One that was refused
        // re-renders nothing, so the truth is put back by hand.
        field.value = shown;
      }}
    />
  );
}

/**
 * The alias: a field while the row is active, and plain text while it is not —
 * the same division the time makes, in a slot of the same size. An empty alias
 * is an empty slot rather than a placeholder: the space between the letter and
 * the clock is inert until the playhead lands on it, and a hint repeated down
 * every unaliased row would read as content. The slot is rendered either way,
 * because it is what holds the clock off the letter.
 */
function Alias({
  marker,
  carrying,
  onSetAlias,
}: {
  marker: LabeledMarker;
  carrying: boolean;
  onSetAlias(marker: LabeledMarker, text: string): string;
}) {
  const stored = marker.aliases[0] ?? '';
  if (!carrying) {
    return <span className="prototype-alias-text">{stored}</span>;
  }
  return (
    <input
      type="text"
      className="markings-row-alias"
      defaultValue={stored}
      placeholder="alias"
      aria-label={`Alias for marker ${marker.label}`}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
      onBlur={(event) => {
        const field = event.currentTarget;
        if (field.value !== stored) field.value = onSetAlias(marker, field.value);
      }}
    />
  );
}

function MovementNameField({
  movement,
  onSetMovementName,
}: {
  movement: Movement;
  onSetMovementName(id: string, name: string): string;
}) {
  return (
    <input
      type="text"
      className="markings-movement-name"
      defaultValue={movement.name}
      placeholder="movement name"
      aria-label={`Name for the movement ${movement.name}`}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
      onBlur={(event) => {
        const field = event.currentTarget;
        if (field.value !== movement.name) {
          field.value = onSetMovementName(movement.id, field.value);
        }
      }}
    />
  );
}

/**
 * One nudge. The four are two kinds: a tenth either way, plain, and a half
 * second either way, which Shift widens to a whole second and which says so —
 * `shiftHeld` decides both the label and the step, so the two cannot disagree.
 */
function Nudge({
  id,
  direction,
  shiftHeld,
  onNudge,
}: {
  id: string;
  direction: -1 | 1;
  shiftHeld: boolean;
  onNudge(id: string, delta: number): void;
}) {
  const sign = direction < 0 ? '−' : '+';
  const half = shiftHeld ? NUDGE_COARSE_STEP_SECONDS : HALF_STEP_SECONDS;
  return (
    <button
      type="button"
      className="markings-nudge prototype-half-nudge"
      title="Hold Shift for a whole second"
      onClick={() => onNudge(id, direction * half)}
    >
      {sign}
      {shiftHeld ? '1' : '0.5'}s
    </button>
  );
}

function Tenth({ id, direction, onNudge }: {
  id: string;
  direction: -1 | 1;
  onNudge(id: string, delta: number): void;
}) {
  return (
    <button
      type="button"
      className="markings-nudge"
      onClick={() => onNudge(id, direction * NUDGE_STEP_SECONDS)}
    >
      {direction < 0 ? '−' : '+'}0.1s
    </button>
  );
}

/** The four nudges under the active row: minus pair left, plus pair right. */
function Decks({
  id,
  shiftHeld,
  onNudge,
}: {
  id: string;
  shiftHeld: boolean;
  onNudge(id: string, delta: number): void;
}) {
  return (
    <div className="markings-decks">
      <span className="markings-deck">
        <Nudge id={id} direction={-1} shiftHeld={shiftHeld} onNudge={onNudge} />
        <Tenth id={id} direction={-1} onNudge={onNudge} />
      </span>
      <span className="markings-deck">
        <Tenth id={id} direction={1} onNudge={onNudge} />
        <Nudge id={id} direction={1} shiftHeld={shiftHeld} onNudge={onNudge} />
      </span>
    </div>
  );
}
