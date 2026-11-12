import type { BrowserWindow, Rectangle } from "electron";

type PlayerWindow = Pick<BrowserWindow, "getBounds" | "getNormalBounds" | "isDestroyed" | "isFullScreen" | "setBounds" | "setFullScreen"> & {
  on(event: "move" | "resized" | "enter-full-screen" | "leave-full-screen", callback: () => void): unknown;
};
type PlayerDisplays = {
  getAllDisplays(): readonly { id: number }[];
  getDisplayMatching(bounds: Rectangle): { id: number };
};

/** Preserve the last windowed display through the native fullscreen transition. */
export function trackPlayerFullscreen(window: PlayerWindow, screen: PlayerDisplays, retryWrongDisplay: boolean): void {
  let windowedBounds = window.getBounds();
  let windowedDisplay = screen.getDisplayMatching(windowedBounds).id;
  let retryBounds: Rectangle | null = null;
  let retriedFullscreen = false;
  const rememberWindowedBounds = (): void => {
    if (window.isFullScreen() || retriedFullscreen) return;
    const bounds = window.getBounds();
    const display = screen.getDisplayMatching(bounds).id;
    windowedBounds = bounds;
    if (display === windowedDisplay) return;
    console.info(`player window: display changed ${JSON.stringify({ from: windowedDisplay, to: display, bounds })}`);
    windowedDisplay = display;
  };
  window.on("move", rememberWindowedBounds);
  window.on("resized", rememberWindowedBounds);
  const reportFullscreen = (event: "enter-full-screen" | "leave-full-screen"): number => {
    const bounds = window.getBounds();
    const display = screen.getDisplayMatching(bounds).id;
    const normalBounds = window.getNormalBounds();
    console.info(`player window: ${event} ${JSON.stringify({
      display,
      bounds,
      windowedDisplay,
      normalDisplay: screen.getDisplayMatching(normalBounds).id,
      normalBounds,
    })}`);
    return display;
  };
  window.on("enter-full-screen", () => {
    const display = reportFullscreen("enter-full-screen");
    if (!retryWrongDisplay || retriedFullscreen || display === windowedDisplay ||
        !screen.getAllDisplays().some((candidate) => candidate.id === windowedDisplay)) return;
    retryBounds = windowedBounds;
    retriedFullscreen = true;
    console.info(`player window: retrying fullscreen on display ${windowedDisplay}`);
    setImmediate(() => {
      if (!window.isDestroyed() && window.isFullScreen()) window.setFullScreen(false);
    });
  });
  window.on("leave-full-screen", () => {
    reportFullscreen("leave-full-screen");
    const bounds = retryBounds;
    retryBounds = null;
    if (bounds === null) {
      retriedFullscreen = false;
      rememberWindowedBounds();
      return;
    }
    // AppKit may still be completing the exit while Electron emits the event.
    setImmediate(() => {
      if (window.isDestroyed() || !screen.getAllDisplays().some((candidate) => candidate.id === windowedDisplay)) {
        retriedFullscreen = false;
        return;
      }
      window.setBounds(bounds);
      window.setFullScreen(true);
    });
  });
}
