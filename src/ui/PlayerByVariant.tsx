import { Player } from './Player';
import type { PlayerProps } from './Player';
import { PlayerConsolePrototype } from './PlayerConsolePrototype';
import { PlayerPartPrototype } from './PlayerPartPrototype';
import { usePrototypeVariant } from './prototypeVariant';

/**
 * PROTOTYPE — the practice surface, rendered in whichever direction the URL
 * asks for.
 *
 * Both player pages (`/projects/:id` and the read-only `/gallery/:id`) go
 * through this one seam, so the two directions are always judged against the
 * same session: the same read, the same controller, the same keying. The
 * variants are handed the identical props the shipped `Player` takes, which is
 * what makes the comparison fair — a direction given a different session would
 * be a different app, not a different design.
 *
 * It exists as a component rather than as a hook call in each page so the
 * switch sits after the pages' own early returns (not-found, in-flight read)
 * without either page having to hoist a hook above them.
 *
 * Throwaway; it dies with the branch. The fold deletes it along with the
 * losing direction.
 */
export function PlayerByVariant(props: PlayerProps) {
  const variant = usePrototypeVariant();
  if (variant === 'part') return <PlayerPartPrototype {...props} />;
  if (variant === 'console') return <PlayerConsolePrototype {...props} />;
  // `hybrid` is today's player with the Part's styling laid over it, so it
  // renders the shipped component with the difference in
  // `prototypeHybrid.css`, keyed on the direction attribute the shell sets.
  //
  // `prototypeStave` is the one exception: the Part's clock is a stave, and
  // its marks-per-position elements are structure, not style. The flag is
  // decided *here* rather than inside `Player` because this seam is the one
  // guaranteed to be inside a router — `Player` is rendered bare by its own
  // tests, where `useSearchParams` would throw.
  if (variant === 'hybrid') return <Player {...props} prototypeStave />;
  return <Player {...props} />;
}
