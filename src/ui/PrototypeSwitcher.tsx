import { useEffect } from 'react';
import { useSearchParams } from 'react-router';

export interface PrototypeVariant {
  key: string;
  name: string;
}

export interface PrototypeSwitcherProps {
  variants: PrototypeVariant[];
}

/**
 * The prototype's floating switcher bar (UI-prototype skill): fixed bottom-
 * centre, cycles the `?variant=` search param, ←/→ arrow keys too. High-
 * contrast and obviously not part of the design being evaluated. Throwaway —
 * it ships only with the prototype route and dies with it.
 */
export function PrototypeSwitcher({ variants }: PrototypeSwitcherProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('variant') ?? variants[0].key;
  const index = Math.max(0, variants.findIndex((v) => v.key === requested));
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
