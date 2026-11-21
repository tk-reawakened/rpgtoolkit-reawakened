import { mountTerrainScene, type ViewHandle } from "@tk-reawakened/editor-ui";
import type { Scene, SceneTerrainCellTile } from "@tk-reawakened/editor-model";

declare function acquireVsCodeApi(): { postMessage(value: unknown): void };
const api = acquireVsCodeApi();
const root = document.getElementById("root");
if (root === null) throw new Error("The terrain editor has no root element.");
const status = document.createElement("p");
status.setAttribute("role", "status");
const content = document.createElement("main");
content.setAttribute("aria-label", "Native scene");
root.append(status, content);
let view: ViewHandle | undefined;
let snapshot: { readonly scene: Scene } | undefined;
let tilesets: readonly { readonly path: string; readonly terrains: readonly { readonly id: string; readonly label?: string }[] }[] = [];
let assetTiles: readonly { readonly label: string; readonly tile: SceneTerrainCellTile }[] = [];
const listeners = new Set<() => void>();
function mount(): void {
  if (snapshot === undefined) return;
  view?.dispose();
  view = mountTerrainScene(content, {
    document: {
      getSnapshot: () => snapshot!,
      subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    },
    tilesets,
    assetTiles,
    onChange: (scene) => api.postMessage({ type: "edit", terrain: { terrainRegions: scene.terrainRegions, tileOverrides: scene.tileOverrides } }),
    onSave: () => api.postMessage({ type: "save" }),
    onRun: () => api.postMessage({ type: "play" }),
  });
}
window.addEventListener("message", (event: MessageEvent) => {
  const message = event.data;
  if (message.type === "status") { status.textContent = message.message; return; }
  if (message.type === "snapshot") {
    snapshot = { scene: message.scene };
    if (view === undefined) mount();
    else for (const listener of listeners) listener();
    return;
  }
  if (message.type !== "initialize") return;
  snapshot = message.snapshot as { readonly scene: Scene };
  tilesets = message.tilesets as typeof tilesets;
  assetTiles = message.assetTiles as typeof assetTiles;
  mount();
});
api.postMessage({ type: "ready" });
