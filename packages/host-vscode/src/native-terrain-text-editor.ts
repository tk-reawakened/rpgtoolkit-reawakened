import * as vscode from "vscode";
import { applyTerrainSceneEdit, createSceneBuildOwnership, createSceneBuildOwnershipStorage, loadTerrainSceneProjectInventory, prepareTerrainSceneProject, previewTerrainSceneProject, readScene, reviewTerrainSceneConflicts, terrainSceneTilesets, writePreparedTerrainSceneProject, type BoardPicture, type Scene, type TerrainSceneConflictDialogs, type DocumentHistoryStore } from "@tk-reawakened/editor-model";
import type { RunService } from "@tk-reawakened/platform-services";
import { createVscodeFileSystem } from "./filesystem.ts";
import { playVscodeTerrainScene } from "./terrain-scene-host.ts";
import { relativeToWorkspace } from "./launch-prompts.ts";
import { applyNativeTextEdit } from "./native-text-edit.ts";
import { createTilesetRefreshTrigger } from "./terrain-assets-trigger.ts";

type Panel = { readonly panel: vscode.WebviewPanel; initialized: boolean };

/** A scene's TextDocument is authoritative; every save builds derived board outputs through ownership review. */
export function createNativeTerrainTextEditorProvider(context: vscode.ExtensionContext, html: (webview: vscode.Webview, context: vscode.ExtensionContext) => string, historyFor: (folder: vscode.WorkspaceFolder) => DocumentHistoryStore, runForProject: (root: vscode.Uri) => RunService): vscode.CustomTextEditorProvider {
  const panels = new Map<string, Set<Panel>>();
  /** Each open scene's asset re-read, called when a tileset document changes; a scene's own edits are not asset changes. */
  const assetReloads = new Set<() => Promise<void>>();
  /** A debounced read must not beat a save: saving is when the new bytes reach disk, so a save reads at once. */
  const tilesetRefresh = createTilesetRefreshTrigger(() => { for (const reload of [...assetReloads]) void reload(); });
  const builds = new Map<string, { readonly version: number; readonly promise: Promise<string | null> }>();
  const buildSavedRevision = (document: vscode.TextDocument): Promise<string | null> => {
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (folder === undefined) return Promise.resolve("Open the scene inside a workspace folder before building it.");
    const key = document.uri.toString();
    const existing = builds.get(key);
    if (existing !== undefined && existing.version === document.version) return existing.promise;
    const scenePath = relativeToWorkspace(folder.uri, document.uri);
    if (scenePath === undefined) return Promise.resolve("The scene is outside its workspace folder.");
    const fs = createVscodeFileSystem(folder.uri);
    const owner = createSceneBuildOwnership({ fs, history: historyFor(folder), storage: createSceneBuildOwnershipStorage(fs), projectId: folder.uri.toString() });
    const revision = document.version;
    const task = (existing?.promise ?? Promise.resolve(null)).then(async (): Promise<string | null> => {
      if (document.version !== revision || document.isDirty) return "Scene changed during build; save again.";
      const prepared = await prepareTerrainSceneProject({ fs, scenePath, ownership: owner });
      if (!prepared.ok) return prepared.problems.map(({ path, message }) => `${path}: ${message}`).join("; ");
      let authorizedPaths: readonly string[] | null = [];
      if (prepared.check.conflicts.length > 0) {
        const dialogs: TerrainSceneConflictDialogs = {
          async reviewRecovery(proposal) {
            const findings = proposal.findings.map((finding) => `${finding.severity}: ${finding.field} (${finding.path}) — ${finding.message}`).join("\n");
            const choice = await vscode.window.showWarningMessage(
              `Outside changes were found in ${proposal.boardPath}. Review the proposed scene at ${proposal.path}.`,
              { modal: true, detail: `This writes a separate scene and leaves the current scene and board unchanged.\n\n${findings}` },
              "Write recovery scene",
            );
            return choice === "Write recovery scene";
          },
          async reviewOutputs(conflicts) {
            const detail = conflicts.map(({ path, kind, plannedHash, currentHash }) => `${path} (${kind}): planned ${plannedHash}; on disk ${currentHash ?? "absent"}.`).join("\n");
            return await vscode.window.showWarningMessage("Generated outputs conflict with existing project files.", { modal: true, detail }, "Authorize listed outputs") === "Authorize listed outputs";
          },
          report: (message) => vscode.window.showInformationMessage(message),
        };
        authorizedPaths = await reviewTerrainSceneConflicts(fs, prepared.check, dialogs, folder.uri.toString());
        if (authorizedPaths === null) return "Build cancelled or recovery scene created; the original board was not rebuilt.";
      }
      if (document.version !== revision || document.isDirty) return "Scene changed during review; save again.";
      const written = await writePreparedTerrainSceneProject(prepared, owner, authorizedPaths);
      return written.ok ? null : `Scene was saved, but generated outputs were not all written: ${written.message} ${written.outcomes.map(({ path, status, message }) => `${path} (${status}): ${message}`).join("; ")}`;
    }).catch((error: unknown) => `Scene was saved, but building failed: ${error instanceof Error ? error.message : String(error)}`);
    builds.set(key, { version: revision, promise: task });
    void task.then(() => { if (builds.get(key)?.promise === task) builds.delete(key); });
    return task;
  };
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async (document) => {
    if (!document.uri.path.toLowerCase().endsWith(".tkrscn")) return;
    const result = await buildSavedRevision(document);
    if (result !== null) for (const target of panels.get(document.uri.toString()) ?? []) sendStatus(target, result);
    else for (const target of panels.get(document.uri.toString()) ?? []) sendStatus(target, "Scene saved and board built.");
  }));

  const sendStatus = (target: Panel, message: string): void => { void target.panel.webview.postMessage({ type: "status", message }); };
  const refresh = (document: vscode.TextDocument): void => {
    const targets = panels.get(document.uri.toString());
    if (targets === undefined) return;
    const parsed = readScene(document.getText());
    for (const target of targets) if (target.initialized) {
      if (parsed.ok) void target.panel.webview.postMessage({ type: "snapshot", scene: parsed.scene });
      else sendStatus(target, `The native scene is invalid; repair it in the text editor before terrain editing. ${parsed.problems.map(({ message }) => message).join("; ")}`);
    }
  };
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(({ document }) => {
    refresh(document);
    // A recipe update changes the roles the scene view reports, so re-read the tilesets (bounded, once per burst).
    tilesetRefresh.edited(document.uri.path);
  }));
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => tilesetRefresh.saved(document.uri.path)));
  context.subscriptions.push({ dispose: () => tilesetRefresh.dispose() });
  return {
    async resolveCustomTextEditor(document, panel): Promise<void> {
      const folder = vscode.workspace.getWorkspaceFolder(document.uri);
      const key = document.uri.toString();
      const target: Panel = { panel, initialized: false };
      let disposed = false;
      const set = panels.get(key) ?? new Set<Panel>(); set.add(target); panels.set(key, set);
      panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")] };
      const projectPath = folder === undefined ? undefined : relativeToWorkspace(folder.uri, document.uri);
      const inventory = folder === undefined || projectPath === undefined ? null : await loadTerrainSceneProjectInventory(createVscodeFileSystem(folder.uri), projectPath, document.getText());
      const tilesets = inventory?.ok ? terrainSceneTilesets(inventory.tilesets) : [];
      const assetTiles = inventory?.ok ? inventory.tiles.map((tile) => ({ label: tile, tile: { tile } })) : [];
      const packs = inventory?.ok ? inventory.packs : [];
      let ownerPaths = new Set([...(inventory?.ok === true ? inventory.tiles : []), ...packs.map(({ path }) => path)]);
      /** Reads in flight are numbered per panel: a slower, older read never replaces the tilesets a newer one showed. */
      let reads = 0;
      const postAssets = async (): Promise<void> => {
        if (disposed || folder === undefined || projectPath === undefined) return;
        const mine = ++reads;
        const fresh = await loadTerrainSceneProjectInventory(createVscodeFileSystem(folder.uri), projectPath, document.getText());
        if (disposed || mine !== reads) return;
        if (!fresh.ok) {
          // Never leave the last good roles looking current: say the read failed and keep the tilesets but not as advice.
          await panel.webview.postMessage({ type: "assets", assets: {
            tilesets: [], assetTiles: [], packs: [],
            problems: fresh.problems.map(({ path, message }) => `${path}: ${message}`),
          } });
          sendStatus(target, `Terrain roles could not be re-read: ${fresh.problems.map(({ path, message }) => `${path}: ${message}`).join("; ")}`);
          return;
        }
        ownerPaths = new Set([...fresh.tiles, ...fresh.packs.map(({ path }) => path)]);
        await panel.webview.postMessage({ type: "assets", assets: {
          tilesets: terrainSceneTilesets(fresh.tilesets),
          assetTiles: fresh.tiles.map((tile) => ({ label: tile, tile: { tile } })),
          packs: fresh.packs,
          problems: [],
        } });
      };
      assetReloads.add(postAssets);
      panel.webview.onDidReceiveMessage(async (value: unknown) => {
        if (typeof value !== "object" || value === null || !("type" in value)) return;
        if (value.type === "ready") {
          target.initialized = true;
          if (inventory?.ok === false) sendStatus(target, inventory.problems.map(({ path, message }) => `${path}: ${message}`).join("; "));
          else if (inventory === null) sendStatus(target, "Open this scene inside a workspace folder to load terrain assets.");
          else if (inventory.packProblems.length > 0) sendStatus(target, inventory.packProblems.map(({ path, message }) => `${path}: ${message}`).join("; "));
          const current = readScene(document.getText());
          if (!current.ok) { sendStatus(target, `The native scene is invalid; repair it in the text editor before terrain editing. ${current.problems.map(({ message }) => message).join("; ")}`); return; }
          void panel.webview.postMessage({ type: "initialize", snapshot: { scene: current.scene }, assets: { tilesets, assetTiles, packs } });
        } else if (value.type === "reload-assets") {
          await postAssets();
        } else if (value.type === "edit" && "terrain" in value) {
          const currentText = document.getText();
          const result = applyTerrainSceneEdit(currentText, {
            terrain: value.terrain as Pick<Scene, "terrainRegions" | "tileOverrides">,
            ...("placements" in value && Array.isArray(value.placements) ? { placements: value.placements as NonNullable<Scene["placedPacks"]> } : {}),
          });
          if (!result.ok) { sendStatus(target, result.problems.map(({ message }) => message).join("; ")); return; }
          if (await applyNativeTextEdit(document, currentText, result.text) === "refused") sendStatus(target, "VS Code could not apply the scene edit.");
        } else if (value.type === "open-owner" && "path" in value && typeof value.path === "string") {
          if (folder === undefined) { sendStatus(target, "Open this scene inside a workspace folder to open its native sources."); return; }
          if (!ownerPaths.has(value.path)) { sendStatus(target, `${value.path} is not a native tile or pack in this project's scene inventory.`); return; }
          try { await vscode.commands.executeCommand("vscode.open", vscode.Uri.joinPath(folder.uri, value.path)); }
          catch (error) { sendStatus(target, `Could not open ${value.path}: ${error instanceof Error ? error.message : String(error)}`); }
        } else if (value.type === "preview" && "requestId" in value && typeof value.requestId === "string") {
          const requestId = value.requestId;
          const reply = async (picture: BoardPicture): Promise<void> => {
            if (disposed) return;
            await panel.webview.postMessage({ type: "preview-result", requestId, picture });
          };
          if (folder === undefined) { await reply({ ok: false, message: "Open this scene inside a workspace folder to preview it." }); return; }
          const scenePath = relativeToWorkspace(folder.uri, document.uri);
          if (scenePath === undefined) { await reply({ ok: false, message: "The scene is outside its workspace folder." }); return; }
          const revision = document.version;
          try {
            const preview = await previewTerrainSceneProject({
              fs: createVscodeFileSystem(folder.uri),
              projectId: folder.uri.toString(),
              scenePath,
              sceneText: document.getText(),
            });
            if (document.version !== revision) { await reply({ ok: false, message: "The scene changed while previewing. Preview again." }); return; }
            await reply(preview.ok ? {
              ok: true, width: preview.preview.width, height: preview.preview.height, rgba: preview.preview.rgba,
              warnings: preview.preview.warnings, objectBounds: preview.preview.objectBounds,
            } : { ok: false, message: preview.problems.map(({ path, message }) => `${path}: ${message}`).join("; ") });
          } catch (error) {
            await reply({ ok: false, message: error instanceof Error ? error.message : String(error) });
          }
        } else if (value.type === "save") {
          try {
            if (document.isDirty && await vscode.workspace.save(document.uri) === undefined) { sendStatus(target, "The scene was not saved."); return; }
            const buildResult = await buildSavedRevision(document);
            sendStatus(target, buildResult ?? "Scene saved and board built.");
          } catch (error) { sendStatus(target, `Save failed: ${String(error)}`); }
        } else if (value.type === "play") {
          try {
            if (document.isDirty && await vscode.workspace.save(document.uri) === undefined) { sendStatus(target, "The scene was not saved; play was cancelled."); return; }
            const buildResult = await buildSavedRevision(document);
            if (buildResult !== null) { sendStatus(target, buildResult); return; }
            await playVscodeTerrainScene(document, runForProject, (message) => sendStatus(target, message));
          } catch (error) { sendStatus(target, `Play failed: ${String(error)}`); }
        }
      });
      panel.onDidDispose(() => { disposed = true; assetReloads.delete(postAssets); set.delete(target); if (set.size === 0) panels.delete(key); });
      panel.webview.html = html(panel.webview, context);
    },
  };
}