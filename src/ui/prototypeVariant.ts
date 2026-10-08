import { useEffect } from 'react';
import { matchPath, useSearchParams } from 'react-router';
// The Part's stylesheet is imported here, not only by the Part's own
// components, because `hybrid` renders no Part component — it is the shipped
// player restyled — yet it wears the Part's *navbar*, and those shell rules
// live at the end of this file. Loading it from the one module the shell
// always imports is what keeps `?variant=hybrid` from painting today's navbar
// on the Part's paper. The `.part-root` rules it also carries are inert
// without a `.part-root` in the tree.
import './prototypePart.css';
import './prototypeHybrid.css';

/**
 * PROTOTYPE — the visual redesign's two directions, switchable in place.
 *
 * The question: **is this app a document or an instrument?** The site has no
 * design system at all — the CSS is placeholder, buttons are styled ad hoc per
 * file, and there is no token. This branch is the first design of one, judged
 * as two whole directions rather than as a component library.
 *
 * Both directions keep one constant: a rehearsal mark in a printed score is a
 * **letter in a ruled box**. That object is what the app is named after and
 * there is currently no trace of it in the UI, so both directions make it the
 * signature element and spend their boldness there; everything around it stays
 * quiet.
 *
 *   `part`    — The Part.    The app is a document you read: a performer's own
 *                            marked-up part. Cool score-white, a serif for
 *                            content and a grotesque for chrome, and a
 *                            timeline drawn as a five-line staff with the
 *                            movement's marks sitting above it in boxes.
 *   `console` — The Console. The app is an instrument you play: a device on
 *                            the music stand. Graphite, one grotesque, the
 *                            recording owning the screen, and a deck of marks
 *                            that lifts over the video.
 *   `hybrid`  — The Part's style over today's layout. Not a third proposal:
 *                            it is the split verdict made viewable — the
 *                            Part's paper, faces, hairlines and boxed mark
 *                            over the shipped player's structure, which is
 *                            what the fold would ship.
 *
 * Variants are gated by `?variant=` on the routes the app already has (the
 * gallery and the two player pages), so the real data fetching, the real
 * playback controller and the real routing all stay — only the rendered
 * subtree swaps. `current` is today's placeholder UI, kept in the cycle so the
 * delta is visible beside the two proposals; it is also the default, so a URL
 * without the param renders exactly what main renders.
 *
 * Throwaway. `docs/prototypes.md` governs it: never merged, never imported,
 * and this file dies with the branch.
 */

/** The prototype's variant keys. `current` is today's UI, not a proposal. */
export type PrototypeVariantKey = 'current' | 'part' | 'hybrid' | 'console';

export interface PrototypeVariant {
  key: PrototypeVariantKey;
  /** The switcher's label for the variant. */
  name: string;
}

// `hybrid` sits next to `part` on purpose: one arrow key apart is how the
// comparison gets made — the same paper and faces, the layout swapped.
export const PROTOTYPE_VARIANTS: readonly PrototypeVariant[] = [
  { key: 'current', name: 'Today' },
  { key: 'part', name: 'The Part' },
  { key: 'hybrid', name: "The Part's style, today's layout" },
  { key: 'console', name: 'The Console' },
];

/**
 * The routes that carry a variant switch: the gallery, and the two player
 * pages (the practice surface and the read-only public view of it). Matched as
 * patterns so a project id never has to be enumerated.
 */
const VARIANT_PATHS = ['/', '/projects/:id', '/gallery/:id'];

/** Whether the current path is one the variant switch governs. */
export function isVariantPath(pathname: string): boolean {
  return VARIANT_PATHS.some((pattern) => matchPath(pattern, pathname) !== null);
}

/**
 * The variant the URL asks for, or `current` when it asks for nothing (or for
 * a key this branch doesn't know).
 */
export function usePrototypeVariant(): PrototypeVariantKey {
  const [params] = useSearchParams();
  // A production build renders the app it always rendered, whatever the URL
  // says: the prototype never reaches a reader, and a stray merge cannot put
  // one of these directions in front of anyone.
  if (!import.meta.env.DEV) return 'current';
  const requested = params.get('variant');
  const known = PROTOTYPE_VARIANTS.find((variant) => variant.key === requested);
  return known?.key ?? 'current';
}

/**
 * Marks the document with the direction in play, so the prototype's chrome
 * rules can restyle the shell the variants don't own — the page ground and the
 * navbar. A direction that only repaints its own subtree can't be judged: the
 * Console's graphite surface under today's light navbar reads as a bug rather
 * than as a proposal.
 *
 * `current` clears the attribute, so leaving the prototype restores the app.
 */
export function usePrototypeDirection(variant: PrototypeVariantKey): void {
  useEffect(() => {
    const root = document.documentElement;
    if (variant === 'current') {
      delete root.dataset.direction;
    } else {
      root.dataset.direction = variant;
    }
    return () => {
      delete root.dataset.direction;
    };
  }, [variant]);
}
