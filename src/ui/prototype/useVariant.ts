/**
 * PROTOTYPE — throwaway. The `?variant=` URL hook that powers the UI
 * prototype's switcher. There is no router in this app (the player is a
 * state surface), so the search param is the only stable home for the choice.
 * Reads A/B/C on mount, writes back via replaceState so a variant is
 * shareable and reload-stable, and tracks the browser's back/forward.
 */
import { useCallback, useEffect, useState } from 'react';

/** The prototype's three switchable layouts. */
export const VARIANTS = ['A', 'B', 'C'] as const;
export type VariantKey = (typeof VARIANTS)[number];

function readVariant(): VariantKey | null {
  const value = new URLSearchParams(window.location.search).get('variant');
  return (VARIANTS as readonly string[]).includes(value ?? '') ? (value as VariantKey) : null;
}

function writeVariant(next: VariantKey | null): void {
  const url = new URL(window.location.href);
  if (next === null) url.searchParams.delete('variant');
  else url.searchParams.set('variant', next);
  window.history.replaceState({}, '', url);
}

export function useVariant(): {
  variant: VariantKey | null;
  setVariant: (next: VariantKey | null) => void;
} {
  const [variant, setVariantState] = useState<VariantKey | null>(readVariant);

  useEffect(() => {
    const onPop = () => setVariantState(readVariant());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const setVariant = useCallback((next: VariantKey | null) => {
    writeVariant(next);
    setVariantState(next);
  }, []);

  return { variant, setVariant };
}
