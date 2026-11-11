/**
 * The PWA's parity page (entry 9.10): the same closing board frame the desktop measurement replays, rendered through
 * `render-webgl2` in the browser build and published as pixels.
 *
 * The browser lane compares this frame with the one the Electron player presents for the same draw list, so "the same
 * draw list renders the same frame in the PWA build and in the player" is a measurement with a worst-channel number,
 * not a claim. Nothing here is a player: it renders once and stops.
 */

import { fontProvider, frameBase64, packageFiles, renderClosingDemoFrame } from "@tk-reawakened/runner-web";

declare global {
  interface Window {
    __parity?: {
      readonly width: number;
      readonly height: number;
      readonly tick: number;
      readonly stateHash: string;
      readonly drawHash: string;
      readonly commands: number;
      readonly worst: number;
      readonly rgba: string;
      readonly error?: string;
    };
  }
}

/** The bundled assets the frame's text needs, listed by the build beside the bundle. */
async function bundledAssets(): Promise<Map<string, Uint8Array>> {
  const listed = (await (await fetch("/apps/bundled.json")).json()) as { readonly files: readonly string[] };
  const bundled = new Map<string, Uint8Array>();
  for (const name of listed.files) {
    const response = await fetch(`/${name}`);
    if (response.ok) bundled.set(name, new Uint8Array(await response.arrayBuffer()));
  }
  return bundled;
}

void (async () => {
  try {
    const planText = await (await fetch("/golden/closing/plan.json")).text();
    const packageName = "demo.tpk";
    const bytes = new Uint8Array(await (await fetch(`/fixtures/packages/${packageName}`)).arrayBuffer());
    const files = packageFiles(packageName, bytes);
    const bundled = await bundledAssets();
    const rendered = renderClosingDemoFrame({ files, bundled, fonts: fontProvider(bundled), planText });
    window.__parity = {
      width: rendered.width,
      height: rendered.height,
      tick: rendered.tick,
      stateHash: rendered.stateHash,
      drawHash: rendered.drawHash,
      commands: rendered.commands,
      worst: rendered.worst,
      rgba: frameBase64(rendered.topFirst),
    };
  } catch (error) {
    window.__parity = {
      width: 0,
      height: 0,
      tick: 0,
      stateHash: "",
      drawHash: "",
      commands: 0,
      worst: 0,
      rgba: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
})();
