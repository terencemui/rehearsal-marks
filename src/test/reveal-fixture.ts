/**
 * The geometry the markers panel's reveal is measured against, stubbed for
 * tests. jsdom computes no layout — every rect is zero, `clientHeight` and
 * `scrollHeight` are prototype getters returning 0, `scrollTop` never moves and
 * nothing scrolls — so a test that wants the reveal to have an answer it can
 * assert owns the numbers itself and hands them to the panel through these
 * stubs.
 *
 * Shared by both surfaces that carry the panel: the practice surface's reveal
 * tests (T55) and the markings page's, where a correction can move the row the
 * reveal is following (T57).
 */

/** A generic box stub — jsdom has no layout, so tests own the geometry. */
export function boxRect(overrides: Partial<DOMRect> = {}): DOMRect {
  return {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
    ...overrides,
  } as DOMRect;
}

/** The geometry a reveal test gives the markers list and the row it reveals. */
export interface RevealStub {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  listTop: number;
  listBottom: number;
  rowTop: number;
  rowBottom: number;
}

/**
 * Gives the markers list and one row a known box, so a reveal test owns the
 * geometry jsdom refuses to compute. `getBoundingClientRect` returns zeros,
 * `clientHeight` and `scrollHeight` are prototype getters returning 0, and
 * `scrollTop` is an own writable property. All four get stubbed on the
 * instances under test — `scrollTop` as an accessor, so the position the
 * component writes is the one the assertion reads back.
 *
 * The stubs survive the click's re-render because the `<ol>` and its `<li>`s
 * are the same DOM nodes before and after (stable keys): only their class
 * names change.
 */
export function stubRevealGeometry(list: HTMLElement, row: HTMLElement, stub: RevealStub): void {
  let scrollTop = stub.scrollTop;
  Object.defineProperty(list, 'scrollTop', {
    get: () => scrollTop,
    set: (next: number) => {
      scrollTop = next;
    },
    configurable: true,
  });
  Object.defineProperty(list, 'clientHeight', { value: stub.clientHeight, configurable: true });
  Object.defineProperty(list, 'scrollHeight', { value: stub.scrollHeight, configurable: true });
  // `configurable`, like the three above it: a test that needs two rows placed
  // calls this once per row, and each call reads the same list.
  Object.defineProperty(list, 'getBoundingClientRect', {
    configurable: true,
    value: () =>
      boxRect({
        top: stub.listTop,
        bottom: stub.listBottom,
        height: stub.listBottom - stub.listTop,
      }),
  });
  Object.defineProperty(row, 'getBoundingClientRect', {
    configurable: true,
    value: () =>
      boxRect({
        top: stub.rowTop,
        bottom: stub.rowBottom,
        height: stub.rowBottom - stub.rowTop,
      }),
  });
}
