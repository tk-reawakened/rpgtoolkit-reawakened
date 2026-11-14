import { listGame, type GameGroup } from "@tk-reawakened/editor-model";
import * as vscode from "vscode";
import { createVscodeFileSystem } from "./filesystem.ts";

/** One row of the Game view: a group (a reserved folder) or a file in it. */
type GameNode =
  | { readonly kind: "group"; readonly group: GameGroup; readonly folder: vscode.Uri }
  | { readonly kind: "file"; readonly path: string; readonly name: string; readonly openable: boolean; readonly folder: vscode.Uri };

/** The command the Game view's files run: open the file in the editor registered for it, the same as Explorer's open. */
export const OPEN_GAME_FILE = "tkr.openGameFile";

/**
 * The Game view (T-02) in VS Code: the project grouped by what each file is, beside the Explorer that is VS Code's own
 * Files (T-03). A file opens through `vscode.open`, so a file reached from here and from the Explorer is one custom
 * document (VS Code opens one per URI, ADR 0022 D1.2). A file with no editor yet is shown as such and does nothing.
 */
export function registerGameView(context: vscode.ExtensionContext): void {
  const changed = new vscode.EventEmitter<void>();
  const provider: vscode.TreeDataProvider<GameNode> = {
    onDidChangeTreeData: changed.event,
    async getChildren(element) {
      if (element?.kind === "file") return [];
      if (element?.kind === "group") {
        return element.group.files.map((file): GameNode => ({ kind: "file", path: file.path, name: file.path.slice(element.group.folder.length + 1), openable: file.openable, folder: element.folder }));
      }
      const folders = vscode.workspace.workspaceFolders ?? [];
      // One workspace folder is one project (ADR 0022 D1.1); a multi-root workspace lists each project's groups under its name.
      const nodes: GameNode[] = [];
      for (const folder of folders) {
        const listed = await listGame(createVscodeFileSystem(folder.uri), { projectFolder: "" });
        for (const group of listed.groups) nodes.push({ kind: "group", group, folder: folder.uri });
      }
      return nodes;
    },
    getTreeItem(node) {
      if (node.kind === "group") {
        const item = new vscode.TreeItem(node.group.label, vscode.TreeItemCollapsibleState.Expanded);
        item.description = `${node.group.files.length}`;
        item.contextValue = "tkr.gameGroup";
        return item;
      }
      const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.None);
      const uri = vscode.Uri.joinPath(node.folder, ...node.path.split("/"));
      item.resourceUri = uri;
      if (node.openable) {
        item.command = { command: OPEN_GAME_FILE, title: "Open", arguments: [uri] };
      } else {
        item.description = "no editor for this file yet";
        item.tooltip = `${node.path} has no editor yet.`;
      }
      return item;
    },
  };
  context.subscriptions.push(
    changed,
    vscode.window.registerTreeDataProvider("tkr.game", provider),
    vscode.commands.registerCommand(OPEN_GAME_FILE, async (uri: vscode.Uri) => { await vscode.commands.executeCommand("vscode.open", uri); }),
    vscode.commands.registerCommand("tkr.refreshGame", () => changed.fire()),
  );
  // The list follows the project: a file made, deleted or renamed by any program shows up without a manual refresh.
  const watcher = vscode.workspace.createFileSystemWatcher("**/*");
  context.subscriptions.push(watcher, watcher.onDidCreate(() => changed.fire()), watcher.onDidDelete(() => changed.fire()));
}
