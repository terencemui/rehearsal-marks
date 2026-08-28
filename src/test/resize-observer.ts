/**
 * jsdom implements no ResizeObserver, but the player's markers-height
 * measurement (T38) observes the split through one. This seam installs a
 * minimal stub for the test environment and hands tests a `fireResizeObservers`
 * hook — the analog of the `Object.defineProperty` geometry stubs, which only
 * observe layout, never compute it.
 */

const pending = new Set<ResizeObserverCallback>();
const observedTargets = new Set<Element>();

/** Installs the stub on the global, unless a real implementation is present. */
export function installResizeObserverStub(): void {
  if (typeof globalThis.ResizeObserver !== 'undefined') return;
  class ResizeObserverStub implements ResizeObserver {
    private readonly callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }

    observe(target: Element): void {
      pending.add(this.callback);
      observedTargets.add(target);
    }

    unobserve(target: Element): void {
      pending.delete(this.callback);
      observedTargets.delete(target);
    }

    disconnect(): void {
      pending.delete(this.callback);
      observedTargets.clear();
    }

    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds: ReadonlyArray<number> = [];
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

/** Fires every live observer once, with empty entries — the resize test hook. */
export function fireResizeObservers(): void {
  for (const callback of [...pending]) {
    callback([] as never, null as never);
  }
}

/**
 * The elements every live stub is currently observing. The player's measure
 * watches the split *and* the video column (the column grows as the embed
 * renders, which the split's own size doesn't announce) — a test pins the
 * video column's presence here.
 */
export function getObservedTargets(): Element[] {
  return [...observedTargets];
}
