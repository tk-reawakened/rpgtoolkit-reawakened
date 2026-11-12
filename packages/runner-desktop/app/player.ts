/**
 * The desktop player page (entry 9.11; the frame capture is entry 9.10's parity check): the shared page from `runner-web`,
 * run against the preload bridge.
 *
 * `?capture` asks the page to keep the presented frame's pixels, which the PWA-vs-player parity test compares channel by
 * channel in the browser lane. Without it the report stays small, because a 640×480 frame is 1.6 MB of base64.
 *
 * `?closing` runs the closing suite in Electron instead (entry 9.14): every game of the plan, against the committed
 * baseline, with the packaged demo re-run from its `.tpk`.
 */

import { bootPlayerPage, type PlayerReport } from "@tk-reawakened/runner-web";
import type { DesktopHost } from "../src/preload.ts";

declare global {
  interface Window {
    __desktop?: PlayerReport;
    __frame?: { readonly width: number; readonly height: number; readonly worst: number; readonly rgba: string } | null;
    __closing?: PlayerReport["closing"];
    desktop?: DesktopHost;
  }
}

void (async () => {
  const params = new URLSearchParams(location.search);
  const capture = params.has("capture");
  const report = await bootPlayerPage(window.desktop, { captureFrame: capture, closing: params.has("closing") });
  window.__closing = report.closing;
  window.__desktop = report;
  const frame = report.frame;
  // Nothing was measured when no game opened: the report carries the reason and there are no pixels to publish.
  window.__frame = frame?.rgba === undefined ? null : { width: frame.width, height: frame.height, worst: frame.worst, rgba: frame.rgba };
  document.title = `desktop: ${report.error ?? report.stateHash}`;
  await window.desktop?.report(report);
})();
