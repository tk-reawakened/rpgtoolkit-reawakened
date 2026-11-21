import { buildTerrainSceneLaunch, loadTerrainSceneProjectInventory, previewTerrainSceneProject, registerTerrainSceneConflictReview, reviewTerrainSceneConflicts, type BoardPicture, type TerrainSceneDocument, type TerrainSceneConflictDialogs } from "@tk-reawakened/editor-model";
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
  let recoveryNotice: string | null = null;
  const report = (message: string): void => {
    if (disposed) return;
    status.textContent = message;
    if (message.startsWith("Recovery scene written")) recoveryNotice = message;
  };
  const conflictDialogs: TerrainSceneConflictDialogs = {
    async reviewRecovery(proposal) {
      const findings = proposal.findings.map((finding) => `${finding.severity}: ${finding.field} (${finding.path}) — ${finding.message}`).join("; ");
      return await project.services.dialogs.ask({
        message: `Outside changes were found in ${proposal.boardPath}. Review the proposed scene at ${proposal.path}.`,
        detail: `This creates a separate scene and leaves the current scene and board unchanged. ${findings}`,
        choices: [{ id: "accept", label: "Write recovery scene" }, { id: "cancel", label: "Cancel" }],
        cancel: "cancel",
      }) === "accept";
    },
    async reviewOutputs(conflicts) {
      return await project.services.dialogs.ask({
        message: "Generated outputs conflict with existing project files.",
        detail: conflicts.map(({ path, kind, plannedHash, currentHash }) => `${path} (${kind}): planned ${plannedHash}; on disk ${currentHash ?? "absent"}.`).join(" "),
        choices: [{ id: "replace", label: "Authorize listed outputs" }, { id: "cancel", label: "Cancel" }],
        cancel: "cancel",
      }) === "replace";
    },
    report,
  };
  const unregisterConflictReview = registerTerrainSceneConflictReview(document, (check) => reviewTerrainSceneConflicts(fs, check, conflictDialogs, project.project.id));
  const save = async (): Promise<boolean> => {
    if (busy || disposed) return false;
    busy = true;
    try {
      const saved = await document.save();
      if (!saved.ok) {
        report(recoveryNotice === null ? saved.failure.message : `${recoveryNotice} ${saved.failure.message}`);
        recoveryNotice = null;
        return false;
      }
      report("Scene saved and board built.");
      recoveryNotice = null;
      return true;
    } catch (error) { report(String(error)); return false; }
    finally { busy = false; }
  };
  const run = project.services.run;
  void loadTerrainSceneProjectInventory(fs, document.identity.path).then((inventory) => {
    if (disposed) return;
    if (!inventory.ok) { report(inventory.problems.map(({ path, message }) => `${path}: ${message}`).join("; ")); return; }
    report("");
    mounted = mountTerrainScene(content, {
      document,
      tilesets: [...inventory.tilesets].map(([path, tileset]) => ({ path, terrains: (tileset.terrains ?? []).map(({ id, name }) => ({ id, label: name })) })),
      assetTiles: inventory.tiles.map((tile) => ({ label: tile, tile: { tile } })),
      onChange: (scene) => {
        const result = document.apply({ type: "edit-scene-terrain", terrain: scene });
        if (!result.ok) report(result.rejection.message);
        else report("Unsaved terrain changes.");
      },
      onSave: () => { void save(); },
      onPreview: async (): Promise<BoardPicture> => {
        try {
          const preview = await previewTerrainSceneProject({
            fs,
            projectId: project.project.id,
            scenePath: document.identity.path,
            sceneText: document.getSnapshot().text,
          });
          if (!preview.ok) return { ok: false, message: preview.problems.map(({ path, message }) => `${path}: ${message}`).join("; ") };
          const { preview: picture } = preview;
          return { ok: true, width: picture.width, height: picture.height, rgba: picture.rgba, warnings: picture.warnings, objectBounds: picture.objectBounds };
        } catch (error) {
          return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
      },
      ...(main === null || run === undefined ? {} : { onRun: () => {
        void (async () => {
          if (!await save() || disposed) return;
          const launch = await buildTerrainSceneLaunch({ fs, main, projectFolder, scenePath: document.identity.path });
          if (disposed) return;
          if (!launch.ok) { report(launch.error.message); return; }
          const started = await run.startGame(launch.value);
          if (!started.ok) report(started.error.message);
        })().catch((error: unknown) => report(String(error)));
      } }),
    });
  }).catch((error: unknown) => report(String(error)));
  return { dispose() { disposed = true; unregisterConflictReview(); mounted?.dispose(); status.remove(); content.remove(); } };
}
