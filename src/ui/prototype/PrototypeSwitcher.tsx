/**
 * PROTOTYPE — throwaway. The floating bottom-center bar that flips between
 * the UI prototype's three layouts. It renders in dev mode even before a
 * `?variant=` is set — `current` is null then and the label says so — so
 * there is always an entry point into the prototype. Clicks cycle the URL
 * param; once a variant is active, Alt+←/→ cycle it too — the plain ←/→
 * already belong to the player's ±5s seek, and in the current player (no
 * variant) Alt+←/→ are the marker nudge, so the keyboard shortcut only exists
 * inside the prototype to avoid corrupting the experience being judged.
 */
import { useEffect } from 'react';
import type { VariantKey } from './useVariant';

const LABELS: Record<VariantKey, string> = {
  A: 'Split rail',
  B: 'Floating deck',
  C: 'Metro console',
};

export interface PrototypeSwitcherProps {
  /** The active layout, or null while the player is still the current one. */
  current: VariantKey | null;
  onCycle(direction: 1 | -1): void;
}

export function PrototypeSwitcher({ current, onCycle }: PrototypeSwitcherProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      const inTextInput =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      if (inTextInput) return;
      if (event.altKey && !event.ctrlKey && !event.metaKey) {
        // In the current player (current === null) Alt+←/→ are the marker
        // nudge — the bar's own arrows are the entry into the prototype.
        if (current === null) return;
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          onCycle(-1);
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          onCycle(1);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCycle, current]);

  const label = current === null ? 'Current player' : `${current} — ${LABELS[current]}`;

  return (
    <div className="proto-switcher" role="group" aria-label="Prototype variants">
      <button type="button" aria-label="Previous variant" onClick={() => onCycle(-1)}>
        ←
      </button>
      <span className={current === null ? 'proto-switcher-label is-default' : 'proto-switcher-label'}>
        {label}
      </span>
      <button type="button" aria-label="Next variant" onClick={() => onCycle(1)}>
        →
      </button>
    </div>
  );
}
