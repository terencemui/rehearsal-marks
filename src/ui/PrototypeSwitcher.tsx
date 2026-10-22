/**
 * PROTOTYPE — throwaway. Lives on `prototype/markings-direction` and is never
 * merged to main (docs/prototypes.md).
 *
 * Three variants of the markings page's authoring column, switchable on the
 * real `/projects/:id/markings` route via `?variant=a|b|c`. The page's data,
 * params, session and keys all stay as they are; only the column's drawing
 * changes, which is what makes the comparison worth anything — the variants are
 * judged against a real recording, real marks and the real side-column width.
 *
 * The question: where the exact time lives, how a movement is banded, and what
 * yields when the column is at its 280px floor.
 */
import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router';
import './markingsPrototype.css';

export const PROTOTYPE_VARIANTS = ['a', 'b', 'c'] as const;

export type PrototypeVariant = (typeof PROTOTYPE_VARIANTS)[number];

/** Each variant's name, as the bar reads it out. */
const VARIANT_NAMES: Record<PrototypeVariant, string> = {
  a: 'The list',
  b: 'The worksheet',
  c: 'The part',
};

function isVariant(value: string | null): value is PrototypeVariant {
  return value !== null && (PROTOTYPE_VARIANTS as readonly string[]).includes(value);
}

/**
 * The variant in the URL, and the way to change it. Reload-stable and
 * shareable, because it is the URL; `replace` so flipping through does not
 * stack history entries between the page and wherever the student came from.
 */
export function usePrototypeVariant(): [PrototypeVariant, (next: PrototypeVariant) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get('variant');
  const variant = isVariant(raw) ? raw : 'a';
  const pick = useCallback(
    (next: PrototypeVariant): void => {
      const updated = new URLSearchParams(params);
      updated.set('variant', next);
      setParams(updated, { replace: true });
    },
    [params, setParams],
  );
  return [variant, pick];
}

export interface PrototypeSwitcherProps {
  current: PrototypeVariant;
  onPick(next: PrototypeVariant): void;
}

/**
 * The floating bar: previous, the variant's name, next. High-contrast ink on
 * purpose — it must read as scaffolding rather than as part of the drawing
 * being judged — and it is gone from a production build.
 *
 * `Shift` + the arrows cycle as well. The plain arrows are the page's own (they
 * seek the recording by five seconds, and walk the marks), and `Shift` is the
 * one modifier `usePlayerKeys` deliberately leaves alone.
 */
export function PrototypeSwitcher({ current, onPick }: PrototypeSwitcherProps) {
  const step = useCallback(
    (delta: number): void => {
      const at = PROTOTYPE_VARIANTS.indexOf(current);
      const next = (at + delta + PROTOTYPE_VARIANTS.length) % PROTOTYPE_VARIANTS.length;
      onPick(PROTOTYPE_VARIANTS[next]);
    },
    [current, onPick],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
      // A caret in a field is typing, not switching: the column is full of
      // fields, and one of them is always under the playhead. The target is not
      // always an element — a key dispatched at the document has none — so it
      // is asked what it is before it is asked what it is inside, the same way
      // `usePlayerKeys` asks.
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('input, textarea, select, [contenteditable]') !== null
      ) {
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        step(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        step(1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [step]);

  if (!import.meta.env.DEV) return null;

  return (
    <div className="proto-switcher" role="group" aria-label="Prototype variant">
      <button type="button" onClick={() => step(-1)} aria-label="Previous variant">
        ←
      </button>
      <span className="proto-switcher-label">
        {current.toUpperCase()} — {VARIANT_NAMES[current]}
      </span>
      <button type="button" onClick={() => step(1)} aria-label="Next variant">
        →
      </button>
      <span className="proto-switcher-hint">shift ←/→</span>
    </div>
  );
}
