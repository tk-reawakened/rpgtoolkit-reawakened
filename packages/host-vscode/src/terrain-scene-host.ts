import * as vscode from "vscode";
import { buildTerrainSceneLaunch, resolveDocumentPath } from "@tk-reawakened/editor-model";
import { platformError, platformOk, type RunService } from "@tk-reawakened/platform-services";
import { createVscodeFileSystem } from "./filesystem.ts";
import { projectFolderChoices, relativeToWorkspace } from "./launch-prompts.ts";

export async function playVscodeTerrainScene(document: vscode.TextDocument, runForProject: (root: vscode.Uri) => RunService, report: (message: string) => void): Promise<void> {
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (folder === undefined) { report("Open the scene inside a workspace folder before playing it."); return; }
  const revision = document.version;
  const fs = createVscodeFileSystem(folder.uri);
  const mainDirectory = await resolveDocumentPath(fs, "Main");
  if (!mainDirectory.ok) {
    report(mainDirectory.kind === "read" ? mainDirectory.error.message : mainDirectory.message);
    return;
  }
  if (!mainDirectory.exists) { report("No Main folder was found in this workspace."); return; }
  const entries = await fs.list(mainDirectory.path);
  if (!entries.ok) { report(entries.error.message); return; }
  const mains = entries.value.filter(({ kind, name }) => kind === "file" && /\.gam$/i.test(name))
    .map(({ name }) => `${mainDirectory.path}/${name}`).sort();
  if (mains.length === 0) { report("No game .gam file was found in Main."); return; }
  const main = mains.length === 1 ? mains[0] : await vscode.window.showQuickPick(mains, { title: "Choose the game to play with this scene" });
  if (main === undefined) return;
  const scenePath = relativeToWorkspace(folder.uri, document.uri);
  if (scenePath === undefined) { report("The scene is outside the workspace folder."); return; }
  const projectFolder = (await vscode.window.showQuickPick(await projectFolderChoices(folder.uri), { title: "Choose the game's asset folder" }))?.folder;
  if (projectFolder === undefined) return;
  const prepared = await buildTerrainSceneLaunch({ fs, main, projectFolder, scenePath });
  if (!prepared.ok) { report(prepared.error.message); return; }
  const started = await runForProject(folder.uri).startGame(prepared.value, () => document.version === revision && !document.isDirty
    ? platformOk(undefined) : platformError("unavailable", "The scene changed while Play was preparing. Play again."));
  if (!started.ok) report(started.error.message);
}
