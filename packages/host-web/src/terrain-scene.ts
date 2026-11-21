import { createSceneBuildOwnership, createSceneBuildOwnershipStorage, loadTerrainSceneProjectInventory, prepareTerrainSceneProject, writePreparedTerrainSceneProject, type TerrainSceneDocument } from "@tk-reawakened/editor-model";
import { mountTerrainScene, type ViewHandle } from "@tk-reawakened/editor-ui";
import type { WebProject } from "./index.ts";

export function mountWebTerrainScene(container: HTMLElement, project: WebProject, document: TerrainSceneDocument, main: string | null, projectFolder: string): ViewHandle {
  const status = container.ownerDocument.createElement("p");
  status.setAttribute("role", "status");
  status.textContent = "Loading terrain assets…";
  const content = container.ownerDocument.createElement("div");
  container.append(status, content);
  let mounted: ViewHandle | null = null;
  let disposed = false;
  let busy = false;
  const fs = project.services.fs;
  const ownership = createSceneBuildOwnership({ fs, history: project.workspace.history, storage: createSceneBuildOwnershipStorage(fs) });
  const report = (message: string): void => { if (!disposed) status.textContent = message; };
  const save = async (): Promise<boolean> => {
    if (busy || disposed) return false;
    busy = true;
    const snapshot = document.getSnapshot();
    try {
      const prepared = await prepareTerrainSceneProject({ fs, scenePath: document.identity.path, sceneText: snapshot.text, ownership });
      if (!prepared.ok) { report(prepared.problems.map(({ path, message }) => `${path}: ${message}`).join("; ")); return false; }
      if (prepared.check.conflicts.length > 0) {
        report(`Build refused: generated output changed or already exists: ${prepared.check.conflicts.map(({ path }) => path).join(", ")}.`);
        return false;
      }
      if (disposed || document.getSnapshot().text !== snapshot.text) { report("Scene changed during build; save again."); return false; }
      const saved = await document.save();
      if (!saved.ok) { report(saved.failure.message); return false; }
      const wrote = await writePreparedTerrainSceneProject(prepared, ownership);
      if (!wrote.ok) { report("Scene saved, but generated outputs were not all written."); return false; }
      report("Scene saved and board built.");
      return true;
    } catch (error) { report(String(error)); return false; }
    finally { busy = false; }
  };
  const run = project.services.run;
  void loadTerrainSceneProjectInventory(fs).then((inventory) => {
    if (disposed) return;
    if (!inventory.ok) { report(inventory.problems.map(({ path, message }) => `${path}: ${message}`).join("; ")); return; }
    report("");
    mounted = mountTerrainScene(content, {
      document,
      tilesets: [...inventory.tilesets].map(([path, tileset]) => ({ path, terrains: (tileset.terrains ?? []).map(({ id, name }) => ({ id, label: name })) })),
      assetTiles: inventory.tiles.map((tile) => ({ label: tile, tile: { tile } })),
      onChange: (scene) => {
        if (busy) return;
        const result = document.apply({ type: "edit-scene-terrain", terrain: scene });
        if (!result.ok) report(result.rejection.message);
        else report("Unsaved terrain changes.");
      },
      onSave: () => { void save(); },
      ...(main === null || run === undefined ? {} : { onRun: () => {
        void (async () => {
          if (!await save() || disposed) return;
          const started = await run.startGame({ kind: "game", main, projectFolder });
          if (!started.ok) report(started.error.message);
        })().catch((error: unknown) => report(String(error)));
      } }),
    });
  }).catch((error: unknown) => report(String(error)));
  return { dispose() { disposed = true; mounted?.dispose(); status.remove(); content.remove(); } };
}
