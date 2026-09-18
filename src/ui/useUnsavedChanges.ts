import { useEffect } from 'react';
import { useBlocker } from 'react-router';
import type { Blocker } from 'react-router';

/**
 * Refuses to be left while `blocked`, on both ways out of a page (T60,
 * ADR-0007: "Unsaved changes block the exit").
 *
 * **In-app navigation** goes through the router's own blocker, so a navbar
 * link, a click on any other link, a programmatic navigation and the browser's
 * Back button are all one interception rather than four. The caller reads the
 * returned blocker's state to render its own prompt and answers with
 * `proceed` (leave, discarding) or `reset` (stay put); nothing moves until it
 * does. This is the reason the app is served by a data router — `useBlocker`
 * refuses to run outside one.
 *
 * **The tab itself** — closing it, or reloading it — is the browser's, not the
 * router's: no in-app prompt can reach it, and the browser shows its own
 * generic confirm instead. `preventDefault` is what asks for that prompt on
 * every browser the app supports, and it is the whole of what a page may do
 * about it. The legacy `returnValue` assignment is deliberately not set: it is
 * deprecated, browsers no longer honour a custom message, and the boolean flag
 * it once carried is exactly what `preventDefault` now sets.
 *
 * Both exits rest on the same `blocked` flag, so a page with nothing
 * uncommitted is left by either without a word — and the flag is the caller's
 * to decide, since only the caller knows what "uncommitted" means for it.
 */
export function useUnsavedChanges(blocked: boolean): Blocker {
  const blocker = useBlocker(blocked);

  useEffect(() => {
    if (!blocked) return;
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [blocked]);

  return blocker;
}
