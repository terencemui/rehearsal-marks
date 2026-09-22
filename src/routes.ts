/**
 * The app's routes that more than one place has to name (T63).
 *
 * A route can be spelled three ways and they must agree: the pattern the route
 * table matches, the pattern the shell matches to decide which rail a page gets,
 * and the address a link or a navigation builds. The markings page is the one
 * where all three exist — the row's action, the create that lands there, and the
 * player's own way through all build its address — so its pattern is written
 * once here and read from everywhere else.
 *
 * Routes with a single author stay in `App.tsx` beside their element, where the
 * reader can see them whole.
 */

/** The markings page's pattern, as the route table and the rail check spell it. */
export const MARKINGS_ROUTE = '/projects/:id/markings';

/**
 * The markings page's address for one project — the pattern with its id filled
 * in. Written out rather than derived from the pattern: a reader should not have
 * to know that `:id` is the one thing in it that varies.
 */
export function markingsPath(projectId: string): string {
  return `/projects/${projectId}/markings`;
}
