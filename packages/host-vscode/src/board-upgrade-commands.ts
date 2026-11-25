import * as vscode from "vscode";
import { upgradeBoardCopy, type BoardUpgradeOperation } from "@tk-reawakened/editor-model";
import type { GameEditorProvider } from "./custom-editor.ts";
import { createVscodeDialogs } from "./dialogs.ts";
import { createVscodeFileSystem } from "./filesystem.ts";

interface BoardChoice {
  readonly uri: vscode.Uri;
  readonly path: string;
}

const BOARD_PATH = /^(?:game\/[^/]+\/)?boards\/.+\.brd$/i;

function boardChoice(uri: vscode.Uri): BoardChoice | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (folder === undefined || folder.uri.scheme !== uri.scheme || folder.uri.authority !== uri.authority) return undefined;
  const root = folder.uri.path.replace(/\/$/, "");
  if (!uri.path.startsWith(`${root}/`)) return undefined;
  const path = uri.path.slice(root.length + 1);
  return BOARD_PATH.test(path) ? { uri, path } : undefined;
}

async function projectBoards(folder: vscode.WorkspaceFolder): Promise<{ readonly boards: BoardChoice[]; readonly failures: string[] }> {
  const found: BoardChoice[] = [];
  const failures: string[] = [];
  const walk = async (segments: readonly string[]): Promise<void> => {
    const directory = segments.length === 0 ? folder.uri : vscode.Uri.joinPath(folder.uri, ...segments);
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(directory);
    } catch (error) {
      failures.push(`${segments.join("/") || folder.name}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    const depth = segments.length;
    const root = segments[0]?.toLowerCase();
    const inBoards = root === "boards" || (depth >= 3 && segments[2]?.toLowerCase() === "boards");
    for (const [name, type] of entries) {
      if ((type & vscode.FileType.SymbolicLink) !== 0) continue;
      if ((type & vscode.FileType.Directory) !== 0) {
        const key = name.toLowerCase();
        const leadsToBoards = depth === 0 ? key === "boards" || key === "game"
          : root === "game" && (depth === 1 || (depth === 2 && key === "boards"));
        if (inBoards || leadsToBoards) await walk([...segments, name]);
      } else if (inBoards && (type & vscode.FileType.File) !== 0 && /\.brd$/i.test(name)) {
        const path = [...segments, name].join("/");
        found.push({ uri: vscode.Uri.joinPath(directory, name), path });
      }
    }
  };
  await walk([]);
  return { boards: found.sort((left, right) => left.path.localeCompare(right.path)), failures };
}

async function chooseBoard(operation: BoardUpgradeOperation): Promise<BoardChoice | undefined> {
  const active = vscode.window.activeTextEditor?.document.uri
    ?? (vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputCustom
      ? vscode.window.tabGroups.activeTabGroup.activeTab.input.uri : undefined);
  const activeChoice = active === undefined ? undefined : boardChoice(active);
  if (operation !== "pre-vector" && activeChoice !== undefined) return activeChoice;
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    await vscode.window.showErrorMessage("Open a project folder first: board upgrades read and create files in that project.");
    return undefined;
  }
  const folder = folders.length === 1
    ? folders[0]!
    : (await vscode.window.showQuickPick(folders.map((candidate) => ({ label: candidate.name, folder: candidate })), { title: "Choose project", ignoreFocusOut: true }))?.folder;
  if (folder === undefined) return undefined;
  const found = await projectBoards(folder);
  if (found.failures.length > 0) {
    await vscode.window.showErrorMessage(`Could not list every board folder: ${found.failures.join("; ")}. No upgrade was started.`);
    return undefined;
  }
  if (found.boards.length === 0) {
    await vscode.window.showInformationMessage("This project has no boards under a Boards folder.");
    return undefined;
  }
  if (found.boards.length === 1) return found.boards[0];
  return (await vscode.window.showQuickPick(found.boards.map((board) => ({ label: board.path, board })), {
    title: "Choose a board to upgrade", ignoreFocusOut: true,
  }))?.board;
}


export function registerBoardUpgradeCommands(
  context: vscode.ExtensionContext,
  provider: GameEditorProvider<vscode.Uri>,
  hasDirtyTextDocument: (uri: vscode.Uri) => boolean,
): void {
  const register = (id: string, operation: BoardUpgradeOperation): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, async () => {
      const choice = await chooseBoard(operation);
      if (choice === undefined) return;
      const folder = vscode.workspace.getWorkspaceFolder(choice.uri);
      if (folder === undefined) {
        await vscode.window.showErrorMessage(`${choice.path} is outside an open project folder.`);
        return;
      }
      const live = provider.openDocument(choice.uri);
      if (live !== undefined) {
        const unsettled = await live.settleViews();
        if (unsettled !== null) {
          await vscode.window.showErrorMessage(`Could not confirm the board's pending edits: ${unsettled}. Nothing was written.`);
          return;
        }
      }
      const result = await upgradeBoardCopy({
        fs: createVscodeFileSystem(folder.uri),
        dialogs: createVscodeDialogs(folder.uri),
        projectId: folder.uri.toString(),
        boardPath: choice.path,
        operation,
        hasPendingEdits: () => hasDirtyTextDocument(choice.uri)
          || live !== undefined && (live.model.getSnapshot().dirty || live.model.getSnapshot().saving || live.model.getSnapshot().conflict !== null),
      });
      if (!result.ok) {
        await vscode.window.showErrorMessage(result.error.message);
        return;
      }
      if (result.value !== null) {
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.joinPath(folder.uri, ...result.value.split("/")));
      }
    }));
  };
  register("tkr.upgradeBoardStackedToRotated", "stacked-to-rotated");
  register("tkr.upgradeBoardTileToPixel", "tile-to-pixel");
  register("tkr.upgradePreVectorBoard", "pre-vector");
}
