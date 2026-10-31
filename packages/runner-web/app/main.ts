/**
 * The player page (D-11: `runner-web`'s declared `./app` subpath).
 *
 * For the tracer it boots one served game to one captured frame and reports what the core said: the state hash, the draw
 * hash, and what the renderer drew versus deferred. The report is on `window.__report` so a browser lane can assert it
 * without scraping the DOM, and it is printed for a person watching the page.
 */

import { fetchBundled, fetchGame, runScriptedFrame } from "../src/index.ts";

declare global {
  interface Window {
    __report?: unknown;
  }
}

const canvas = document.querySelector<HTMLCanvasElement>("#screen");
const output = document.querySelector<HTMLPreElement>("#report");
if (canvas === null || output === null) throw new Error("player: the page is missing its canvas or report");

const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, antialias: false, alpha: false, preserveDrawingBuffer: true });
if (gl === null) {
  output.textContent = "player: this browser has no WebGL2 context";
  window.__report = { error: "no-webgl2" };
} else {
  void boot(gl, output);
}

async function boot(context: WebGL2RenderingContext, report: HTMLPreElement): Promise<void> {
  try {
    const params = new URLSearchParams(location.search);
    const game = params.get("game") ?? "demo";
    const base = "";
    const planText = await (await fetch(`${base}/golden/closing/plan.json`)).text();
    const files = await fetchGame(base, `fixtures/legacy/${game}`);
    const bundled = await fetchBundled(base, ["media/fonts", "media/cursors"]);
    const result = runScriptedFrame({ planText, game, files, bundled, gl: context });
    window.__report = { game, ...result };
    report.textContent = [
      `${game} tick ${result.tick}`,
      `state ${result.stateHash}`,
      `draw  ${result.drawHash}`,
      `commands ${result.commands}: drawn ${result.render.drawn}, deferred ${result.render.deferred}`,
      ...Object.entries(result.render.deferredByKind).map(([kind, count]) => `  ${kind}: ${count}`),
      ...result.render.diagnostics.map((line) => `diagnostic: ${line}`),
    ].join("\n");
  } catch (error) {
    window.__report = { error: String(error) };
    report.textContent = `player: ${String(error)}`;
  }
}
