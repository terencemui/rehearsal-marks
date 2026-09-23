import { useEffect } from 'react';
import { useBlocker } from 'react-router';
import type { Blocker } from 'react-router';

/**
 * The two ways out of a page, and the two different questions they ask (T60,
 * amended for #136; ADR-0007: "Unsaved changes block the exit").
 *
 * They are two hooks because they are two questions, and answering one from
 * the other's answer asks the wrong thing of one of them:
 *
 * - **In-app navigation** asks *"will anything write this on the way out?"* —
 *   a property of the save mode, and true only where nothing will.
 * - **The tab's own exit** asks *"does the server hold this yet?"* — a property
 *   of the record, and true whatever mode wrote it.
 *
 * A page with something uncommitted must arm the second even when the first is
 * honestly disarmed: an autosaving record settles itself on an in-app exit but
 * not on a tab close, where no teardown of the page runs at all.
 */

/**
 * Refuses an in-app navigation while `hasWorkToLose` — the caller's judgement
 * that nothing will write this record on the way out.
 *
 * Navigation goes through the router's own blocker, so a navbar link, a click
 * on any other link, a programmatic navigation and the browser's Back button
 * are all one interception rather than four. The caller reads the returned
 * blocker's state to render its own prompt and answers with `proceed` (leave,
 * discarding) or `reset` (stay put); nothing moves until it does. This is the
 * reason the app is served by a data router — `useBlocker` refuses to run
 * outside one.
 *
 * The flag is the caller's to decide, since only the caller knows what will
 * settle its record. It is named for that judgement rather than for the
 * blocker, whose own `state` is `'blocked'` for the different fact that a
 * navigation is being held right now.
 */
export function useNavigationBlocker(hasWorkToLose: boolean): Blocker {
  return useBlocker(hasWorkToLose);
}

/**
 * Asks the browser's own confirm before `uncommitted` work goes down with the
 * tab — closing it, or reloading it.
 *
 * This exit is the browser's, not the router's: no in-app prompt can reach it,
 * and the browser shows its own generic confirm instead. `preventDefault` is
 * what asks for that prompt, and it is the whole of what a page may do about
 * it: it is enough for every browser that implements the current spec. The
 * legacy `returnValue` assignment is deliberately not set — it is deprecated,
 * browsers no longer honour a custom message, and the boolean flag it once
 * carried is exactly what `preventDefault` sets. Chromium below 119 is the one
 * place that still wants it, and on such a browser the tab closes without
 * asking: a floor the app has never stated, left open knowingly rather than by
 * oversight.
 *
 * The guard asks; it does not write. A tab close runs no teardown, so nothing
 * here can settle the record — a write on the way out would be a
 * `pagehide`/`visibilitychange` flush, which is not what this asks for. So the
 * flag is what the server does *not* hold, whatever wrote the record, and a
 * record the server holds in full takes no guard at all.
 */
export function useTabCloseGuard(uncommitted: boolean): void {
  useEffect(() => {
    if (!uncommitted) return;
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [uncommitted]);
}
