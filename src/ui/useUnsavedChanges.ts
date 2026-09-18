import { useEffect } from 'react';
import { useBlocker } from 'react-router';
import type { Blocker } from 'react-router';

/**
 * Refuses to be left while `hasWorkToLose`, on both ways out of a page (T60,
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
 * generic confirm instead. `preventDefault` is what asks for that prompt, and
 * it is the whole of what a page may do about it: it is enough for every
 * browser that implements the current spec. The legacy `returnValue`
 * assignment is deliberately not set — it is deprecated, browsers no longer
 * honour a custom message, and the boolean flag it once carried is exactly
 * what `preventDefault` sets. Chromium below 119 is the one place that still
 * wants it, and on such a browser the tab closes without asking: a floor the
 * app has never stated, left open knowingly rather than by oversight.
 *
 * Both exits rest on the same flag, so a page with nothing uncommitted is left
 * by either without a word — and the flag is the caller's to decide, since only
 * the caller knows what "uncommitted" means for it. It is named for that
 * judgement rather than for the blocker, whose own `state` is `'blocked'` for
 * the different fact that a navigation is being held right now.
 */
export function useUnsavedChanges(hasWorkToLose: boolean): Blocker {
  const blocker = useBlocker(hasWorkToLose);

  useEffect(() => {
    if (!hasWorkToLose) return;
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasWorkToLose]);

  return blocker;
}
