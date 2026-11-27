import { buildTerrainSceneLaunch, loadTerrainSceneProjectInventory, previewTerrainSceneProject, registerTerrainSceneConflictReview, reviewTerrainSceneConflicts, terrainSceneAssets, type BoardPicture, type TerrainSceneDocument, type TerrainSceneConflictDialogs } from "@tk-reawakened/editor-model";
import { createTerrainSceneAssets, mountTerrainScene, type ViewHandle } from "@tk-reawakened/editor-ui";
import { createTerrainSceneMount } from "./terrain-scene-mount.ts";
import type { WebProject } from "./index.ts";

/**
 * Mount the native scene editor. The fifth argument is the game's asset folder; the sixth is the
 * browser's ordinary source opener, which opens a project-relative path in a tab and returns a
 * message when it could not. Owner links use only the paths the scene inventory supplied.
 */
export function mountWebTerrainScene(container: HTMLElement, project: WebProject, document: TerrainSceneDocument, main: string | null, projectFolder: string, openSource?: (path: string) => Promise<string | null>): ViewHandle {
  const status = container.ownerDocument.createElement("p");
  status.setAttribute("role", "status");
  status.textContent = "Loading terrain assets…";
  const retry = container.ownerDocument.createElement("button");
  retry.type = "button";
  retry.textContent = "Retry loading terrain assets";
  retry.hidden = true;
  const content = container.ownerDocument.createElement("div");
  container.append(status, retry, content);
  let mounted: ViewHandle | null = null;
  let disposed = false;
  let busy = false;
  let refreshInventory = (): void => {};
  retry.addEventListener("click", () => {
    retry.hidden = true;
    status.textContent = "Retrying terrain assets…";
    refreshInventory();
  });
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
  const assets = createTerrainSceneAssets({ tilesets: [], assetTiles: [], packs: [] });
  let owners = new Set<string>();
  /** Reads in flight are numbered: a slower, older read never replaces the tilesets a newer one already showed. */
  let read = 0;
  const load = async (): Promise<boolean> => {
    const mine = ++read;
    let inventory: Awaited<ReturnType<typeof loadTerrainSceneProjectInventory>>;
    try { inventory = await loadTerrainSceneProjectInventory(fs, document.identity.path, document.getSnapshot().text); }
    catch (error) { inventory = { ok: false, problems: [{ path: document.identity.path, message: String(error) }] }; }
    if (disposed || mine !== read) return false;
    // A failed read clears the roles instead of leaving the last good ones on screen as current.
    assets.set(terrainSceneAssets(inventory));
    if (!inventory.ok) {
      retry.hidden = false;
      report(`Terrain asset inventory failed: ${inventory.problems.map(({ path, message }) => `${path}: ${message}`).join("; ")}`);
      return false;
    }
    retry.hidden = true;
    report(inventory.packProblems.map(({ path, message }) => `${path}: ${message}`).join("; "));
    owners = new Set([...inventory.tiles, ...inventory.packs.map((pack) => pack.path)]);
    return true;
  };
  const mount = (): void => {
    mounted = mountTerrainScene(content, {
      document,
      assets: assets.source,
      onRefreshAssets: () => { void load(); },
      ...(openSource === undefined ? {} : { onOpenAsset: (path: string) => {
        if (!owners.has(path)) { report(`${path} is not a native tile or pack in this project's scene inventory.`); return; }
        void openSource(path).then((message) => { if (message !== null) report(message); }).catch((error: unknown) => report(String(error)));
      } }),
      onChange: (scene) => {
        const result = document.apply({
          type: "edit-scene-terrain",
          terrain: {
            ...(scene.terrainRegions === undefined ? {} : { terrainRegions: scene.terrainRegions }),
            ...(scene.tileOverrides === undefined ? {} : { tileOverrides: scene.tileOverrides }),
          },
          placements: scene.placedPacks ?? [],
        });
        if (!result.ok) report(result.rejection.message);
        else report("Unsaved scene changes.");
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
  };
  const lifecycle = createTerrainSceneMount(load, mount);
  refreshInventory = () => { void lifecycle.refresh().catch((error: unknown) => report(String(error))); };
  void lifecycle.start().catch((error: unknown) => {
    if (disposed) return;
    retry.hidden = false;
    report(`Terrain asset inventory failed: ${String(error)}`);
  });
  return {
    dispose() { disposed = true; lifecycle.dispose(); unregisterConflictReview(); mounted?.dispose(); status.remove(); retry.remove(); content.remove(); },
    /** The workbench re-shows a retained view here: re-read the tilesets so its rules are never the ones from before a recipe edit. */
    refreshAssets() { void lifecycle.refresh(); },
  };
}
