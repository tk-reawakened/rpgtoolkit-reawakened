import { mountTerrainScene, type ViewHandle } from "@tk-reawakened/editor-ui";
import type { BoardPicture, Scene, SceneTerrainCellTile } from "@tk-reawakened/editor-model";

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
let generation = 0;
let previewsMade = 0;
const previews = new Map<string, { readonly at: number; readonly resolve: (picture: BoardPicture) => void }>();
function previewPicture(): Promise<BoardPicture> {
  const requestId = `terrain-preview-${++previewsMade}`;
  return new Promise((resolve) => {
    previews.set(requestId, { at: generation, resolve });
    api.postMessage({ type: "preview", requestId });
  });
}
function advanceGeneration(): void {
  generation += 1;
  for (const [requestId, pending] of previews) {
    previews.delete(requestId);
    pending.resolve({ ok: false, message: "The scene changed while previewing. Preview again." });
  }
}
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
    onPreview: previewPicture,
    onSave: () => api.postMessage({ type: "save" }),
    onRun: () => api.postMessage({ type: "play" }),
  });
}
window.addEventListener("message", (event: MessageEvent) => {
  const message = event.data;
  if (message.type === "status") { status.textContent = message.message; return; }
  if (message.type === "preview-result") {
    const pending = previews.get(message.requestId);
    if (pending === undefined) return;
    previews.delete(message.requestId);
    if (pending.at !== generation) { pending.resolve({ ok: false, message: "The scene changed while previewing. Preview again." }); return; }
    pending.resolve(message.picture as BoardPicture);
    return;
  }
  if (message.type === "snapshot") {
    advanceGeneration();
    snapshot = { scene: message.scene };
    if (view === undefined) mount();
    else for (const listener of listeners) listener();
    return;
  }
  if (message.type !== "initialize") return;
  advanceGeneration();
  snapshot = message.snapshot as { readonly scene: Scene };
  tilesets = message.tilesets as typeof tilesets;
  assetTiles = message.assetTiles as typeof assetTiles;
  mount();
});
api.postMessage({ type: "ready" });
