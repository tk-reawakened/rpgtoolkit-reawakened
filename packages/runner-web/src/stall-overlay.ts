/**
 * The loading spinner's rule (docs/spec/engine/runners.md, plan AC5): while the engine is blocked on an asset the page
 * keeps the last presented frame and shows a spinner over it, but only once the wait has lasted **more than** 300 ms, so
 * a fast read never flickers. The decision is a pure function of the session's load state and an injected clock, and the
 * page calls `update` from its own timers, never from the session's pending `advance`.
 */

import { stallIsVisible, type AssetLoadState } from "./session-assets.ts";

/** How long a wait must last, strictly, before the spinner appears. */
export const SPINNER_DELAY_MS = 300;

/** The one property of a DOM element the overlay drives, so a test needs no DOM. */
export interface OverlayElement {
  hidden: boolean | string;
}

export type StallOverlayOptions = {
  readonly element: OverlayElement;
  readonly state: () => AssetLoadState;
  readonly clock: () => number;
  readonly delayMs?: number;
};

export interface StallOverlay {
  /** Show or hide the spinner for the state and clock as they are now; returns whether it is visible. */
  update(): boolean;
}

export function createStallOverlay(options: StallOverlayOptions): StallOverlay {
  const delay = options.delayMs ?? SPINNER_DELAY_MS;
  return {
    update() {
      const visible = stallIsVisible(options.state().blocking, options.clock(), delay);
      options.element.hidden = !visible;
      return visible;
    },
  };
}
