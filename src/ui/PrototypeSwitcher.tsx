import { useEffect } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { PROTOTYPE_VARIANTS, isVariantPath } from './prototypeVariant';
import type { PrototypeVariant } from './prototypeVariant';
import './prototypeSwitcher.css';

export interface PrototypeSwitcherProps {
  variants?: readonly PrototypeVariant[];
}

/**
 * The prototype's floating switcher bar (UI-prototype skill): fixed
 * bottom-centre, cycles the `?variant=` search param, ←/→ arrow keys too.
 * High-contrast and obviously not part of the design being evaluated.
 *
 * It renders on the routes the switch governs and nowhere else, so the
 * markings page and Help are not offered a variant they don't have. Throwaway
 * — it ships only on this branch and dies with it.
 */
export function PrototypeSwitcher({ variants = PROTOTYPE_VARIANTS }: PrototypeSwitcherProps) {
  const { pathname } = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const requested = searchParams.get('variant') ?? variants[0].key;
  const index = Math.max(
    0,
    variants.findIndex((variant) => variant.key === requested),
  );
  const variant = variants[index] ?? variants[0];

  function cycle(delta: number): void {
    const next = variants[(index + delta + variants.length) % variants.length];
    const params = new URLSearchParams(searchParams);
    params.set('variant', next.key);
    setSearchParams(params, { replace: true });
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const inTextInput =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      if (inTextInput) return;
      const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
      if (delta === 0) return;
      event.preventDefault();
      const next = variants[(index + delta + variants.length) % variants.length];
      const params = new URLSearchParams(searchParams);
      params.set('variant', next.key);
      setSearchParams(params, { replace: true });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [index, searchParams, variants, setSearchParams]);

  if (!isVariantPath(pathname)) return null;

  return (
    <div className="prototype-switcher">
      <button type="button" onClick={() => cycle(-1)} aria-label="Previous variant">
        ←
      </button>
      <span className="prototype-switcher-label">
        {variant.key} — {variant.name}
      </span>
      <button type="button" onClick={() => cycle(1)} aria-label="Next variant">
        →
      </button>
    </div>
  );
}
