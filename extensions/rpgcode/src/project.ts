import * as vscode from "vscode";
import { encodeBase64, isHookAssetPath, isProgramPath, projectRootUri, PROJECT_NOTIFICATION, type ProjectSnapshot, type ProjectSnapshotFile } from "@tk-reawakened/lsp/protocol";

/**
 * The running project, on the client side (docs/spec/engine/rpgcode-tooling.md#tool-1-project).
 *
 * The author selects one `.gam` with "RPGCode: Select Running Project"; the
 * selection is the workspace setting `rpgcode.project` and the status bar shows
 * it. Nothing here picks a main file on the author's behalf. The project is
 * read through `workspace.fs`, so the desktop (stdio) and web (worker) hosts
 * send the language server the same snapshot, virtual workspaces included.
 */

const SECTION = "rpgcode";
const SETTING = "project";
const SELECT_COMMAND = "rpgcode.selectProject";
const SKIPPED_FOLDERS = new Set(["node_modules", ".git"]);
/** A bound on the inventory, so a mis-selected folder (a whole drive) is reported instead of read. */
const MAX_FILES = 20_000;
const MAX_SEARCH_DEPTH = 4;

/** The part of the language client this module needs. */
export type ProjectClient = {
  sendNotification(method: string, params: unknown): Promise<void>;
};

function isFileNotFound(error: unknown): boolean {
  return error instanceof vscode.FileSystemError && error.code === "FileNotFound";
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The selected main file: a URI, or a path relative to the first workspace folder. */
export function selectedMain(): vscode.Uri | undefined {
  const value = vscode.workspace.getConfiguration(SECTION).get<string>(SETTING, "").trim();
  if (value === "") return undefined;
  if (/^[A-Za-z][A-Za-z0-9+.-]+:/.test(value) && !/^[A-Za-z]:[\\/]/.test(value)) return vscode.Uri.parse(value, true);
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder === undefined) return undefined;
  return vscode.Uri.joinPath(folder.uri, ...value.split(/[\\/]/).filter((part) => part !== ""));
}

/** How the setting records `main`: relative to the first workspace folder when inside it, else its URI. */
function settingValue(main: vscode.Uri): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder !== undefined) {
    const base = folder.uri.toString().replace(/\/?$/, "/");
    const full = main.toString();
    if (full.startsWith(base)) return decodeURIComponent(full.slice(base.length));
  }
  return main.toString();
}

async function inventory(root: vscode.Uri, prefix: string, files: ProjectSnapshotFile[]): Promise<void> {
  const entries = await vscode.workspace.fs.readDirectory(root);
  entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  for (const [name, type] of entries) {
    const child = vscode.Uri.joinPath(root, name);
    const path = prefix === "" ? name : `${prefix}/${name}`;
    // A link is never followed (docs/spec/formats/packaging-and-paths.md, loose folder).
    if ((type & vscode.FileType.SymbolicLink) !== 0) continue;
    if ((type & vscode.FileType.Directory) !== 0) {
      if (!SKIPPED_FOLDERS.has(name)) await inventory(child, path, files);
      continue;
    }
    if ((type & vscode.FileType.File) === 0 || (!isProgramPath(name) && !isHookAssetPath(path))) continue;
    if (files.length >= MAX_FILES) throw new Error(`the project root holds more than ${MAX_FILES} program and script-hook files`);
    files.push({ path, uri: child.toString(), bytes: encodeBase64(await vscode.workspace.fs.readFile(child)) });
  }
}

/** Read the selected project into one snapshot; a failure is reported in the snapshot, never guessed around. */
export async function readSnapshot(revision: number): Promise<ProjectSnapshot> {
  const main = selectedMain();
  if (main === undefined) return { revision, main: null };
  try {
    const mainBytes = await vscode.workspace.fs.readFile(main);
    const rootUri = projectRootUri(main.toString());
    const root = vscode.Uri.parse(rootUri, true);
    const files: ProjectSnapshotFile[] = [];
    await inventory(root, "", files);
    const lintUri = vscode.Uri.joinPath(root, "tkr-lint.json");
    let lintConfig: ProjectSnapshot["lintConfig"] = null;
    try {
      lintConfig = { uri: lintUri.toString(), text: new TextDecoder().decode(await vscode.workspace.fs.readFile(lintUri)) };
    } catch (error) {
      if (!isFileNotFound(error)) throw error;
    }
    return { revision, main: { uri: main.toString(), bytes: encodeBase64(mainBytes) }, rootUri, files, lintConfig, hookInventoryComplete: true };
  } catch (error) {
    return { revision, main: null, problem: `${main.toString()}: ${message(error)}` };
  }
}

async function findMainFiles(): Promise<vscode.Uri[]> {
  const found: vscode.Uri[] = [];
  const visit = async (folder: vscode.Uri, depth: number): Promise<void> => {
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(folder);
    } catch {
      return;
    }
    for (const [name, type] of entries) {
      const child = vscode.Uri.joinPath(folder, name);
      if ((type & vscode.FileType.SymbolicLink) !== 0) continue;
      if ((type & vscode.FileType.Directory) !== 0 && depth < MAX_SEARCH_DEPTH && !SKIPPED_FOLDERS.has(name)) await visit(child, depth + 1);
      else if ((type & vscode.FileType.File) !== 0 && name.toLowerCase().endsWith(".gam")) found.push(child);
    }
  };
  for (const folder of vscode.workspace.workspaceFolders ?? []) await visit(folder.uri, 0);
  return found.sort((left, right) => (left.toString() < right.toString() ? -1 : 1));
}

/**
 * Register the selection command, the status-bar marker and the snapshot
 * delivery. `client` is the started language client; a snapshot is sent now,
 * on every selection change and on every change under the project root.
 */
export function registerRunningProject(context: vscode.ExtensionContext, client: ProjectClient): { resend(): void } {
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  status.command = SELECT_COMMAND;
  status.name = "RPGCode running project";
  let revision = 0;
  let pending: Promise<void> = Promise.resolve();
  let watcher: vscode.FileSystemWatcher | undefined;

  const showStatus = (): void => {
    const main = selectedMain();
    const name = main?.path.slice(main.path.lastIndexOf("/") + 1);
    status.text = main === undefined ? "$(circle-slash) RPGCode: no running project" : `$(play-circle) ${name}`;
    status.tooltip = main === undefined
      ? "No running project is selected, so RPGCode files are unassessed. Click to select the .gam the game runs from."
      : `Running project: ${main.toString(true)}. Click to change.`;
    status.show();
  };

  const watch = (): void => {
    watcher?.dispose();
    watcher = undefined;
    const main = selectedMain();
    if (main === undefined) return;
    const root = vscode.Uri.parse(projectRootUri(main.toString()), true);
    watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, "**/*"));
    const relevant = (uri: vscode.Uri): boolean => {
      const name = uri.path.slice(uri.path.lastIndexOf("/") + 1).toLowerCase();
      return isProgramPath(name) || isHookAssetPath(uri.path.slice(root.path.replace(/\/?$/, "/").length)) || name.endsWith(".gam") || name === "tkr-lint.json";
    };
    const changed = (uri: vscode.Uri): void => {
      if (relevant(uri)) send();
    };
    watcher.onDidCreate(changed);
    watcher.onDidChange(changed);
    watcher.onDidDelete(changed);
  };

  // Snapshots are read one at a time, and each carries a higher revision than the last.
  const send = (): void => {
    pending = pending.then(async () => {
      revision += 1;
      const snapshot = await readSnapshot(revision);
      await client.sendNotification(PROJECT_NOTIFICATION, snapshot);
    }).catch((error: unknown) => {
      void vscode.window.showErrorMessage(`RPGCode could not send the running project: ${message(error)}`);
    });
  };

  context.subscriptions.push(
    status,
    { dispose: () => watcher?.dispose() },
    vscode.commands.registerCommand(SELECT_COMMAND, async () => {
      const candidates = await findMainFiles();
      const none = { label: "$(circle-slash) No running project", main: undefined as vscode.Uri | undefined };
      const items = [
        ...candidates.map((uri) => ({ label: uri.path.slice(uri.path.lastIndexOf("/") + 1), description: vscode.workspace.asRelativePath(uri), main: uri as vscode.Uri | undefined })),
        none,
      ];
      const picked = await vscode.window.showQuickPick(items, {
        title: "Select the running project",
        placeHolder: candidates.length === 0 ? "No .gam file in the workspace" : "The .gam the game runs from: its dialect, includes and lint configuration apply",
      });
      if (picked === undefined) return;
      await vscode.workspace.getConfiguration(SECTION).update(SETTING, picked.main === undefined ? undefined : settingValue(picked.main), vscode.ConfigurationTarget.Workspace);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration(`${SECTION}.${SETTING}`)) return;
      showStatus();
      watch();
      send();
    }),
  );
  showStatus();
  watch();
  send();
  return { resend: send };
}
