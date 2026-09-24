import { useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
import './prototype.css';

/**
 * PROTOTYPE — throwaway chrome, shared by every prototype route.
 *
 * The floating variant switcher: left and right cycle the variants, wrapping
 * at both ends, and the label names the one on screen. `←` and `→` do the same
 * from the keyboard, except while a caret is in a field — a prototype of an
 * editing surface is mostly text fields, and stealing the arrows from them
 * would make the variants unrunnable rather than switchable.
 *
 * It owns no URL state: the route it sits on decides what a variant means and
 * where the choice is written, so this stays reusable by the next prototype.
 */
export interface PrototypeVariant {
  /** The short key, as it reads in `?variant=` — "A", "B", "C". */
  key: string;
  /** What this variant does differently, in a few words. */
  name: string;
}

export interface PrototypeBarProps {
  variants: PrototypeVariant[];
  /** The variant on screen — one of `variants`' keys. */
  current: string;
  onSelect(key: string): void;
  /** Prototype-only controls for this particular prototype, if it has any. */
  children?: ReactNode;
}

export function PrototypeBar({ variants, current, onSelect, children }: PrototypeBarProps) {
  const index = Math.max(
    0,
    variants.findIndex((variant) => variant.key === current),
  );

  // A prototype whose question has been answered down to one shape keeps the
  // label — it names what is on screen — and drops the arrows, which would have
  // nowhere to go.
  const many = variants.length > 1;

  const step = useCallback(
    (delta: number) => {
      const next = variants[(index + delta + variants.length) % variants.length];
      onSelect(next.key);
    },
    [index, onSelect, variants],
  );

  useEffect(() => {
    if (!many) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (
        target !== null &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        step(1);
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        step(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [many, step]);

  const shown = variants[index];
  return (
    <div className="prototype-bar" role="group" aria-label="Prototype variant">
      {many && (
        <button type="button" onClick={() => step(-1)} aria-label="Previous variant">
          ←
        </button>
      )}
      <span className="prototype-bar-name">
        {shown.key} — {shown.name}
      </span>
      {many && (
        <button type="button" onClick={() => step(1)} aria-label="Next variant">
          →
        </button>
      )}
      {children !== undefined && <span className="prototype-bar-extra">{children}</span>}
    </div>
  );
}
