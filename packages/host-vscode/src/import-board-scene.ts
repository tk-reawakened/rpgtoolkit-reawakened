import * as vscode from "vscode";
import type { GameEditorProvider } from "./custom-editor.ts";
import { importBoardScene } from "./custom-editor.ts";
import { createVscodeDialogs } from "./dialogs.ts";
import { createVscodeFileSystem } from "./filesystem.ts";

/**
 * The command-palette route of **Import as Scene** (docs/spec/formats/native-scene.md#import-from-a-board-to-a-scene).
 * It exists beside the board view because a supported older board (minor 2 or 3) can be imported even when the legacy
 * board editor refuses to open it for editing: only the saved bytes are read, and the review, refusals and write are the
 * one shared service. A live copy of the board, if the workbench has one open, contributes its settled state first.
 */

interface BoardChoice {
  readonly uri: vscode.Uri;
  readonly path: string;
}

/** A board the import contract accepts: a `.brd` under `Boards/` or `Game/<game>/Boards/`. */
const IMPORTABLE_BOARD = /^(?:game\/[^/]+\/)?boards\/.+\.brd$/i;

function boardChoice(uri: vscode.Uri): BoardChoice | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (folder === undefined) return undefined;
  const root = folder.uri.path.replace(/\/$/, "");
  if (folder.uri.scheme !== uri.scheme || folder.uri.authority !== uri.authority) return undefined;
  if (uri.path !== root && !uri.path.startsWith(`${root}/`)) return undefined;
  const path = uri.path === root ? "" : uri.path.slice(root.length + 1);
  return IMPORTABLE_BOARD.test(path) ? { uri, path } : undefined;
}

/** The custom editor's document, when the active tab is one (a board opened in its own editor has no `TextEditor`). */
function activeCustomEditorUri(): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  return input instanceof vscode.TabInputCustom ? input.uri : undefined;
}

/**
 * Every board the project folder holds, read through the workspace's own file system so the scan needs no search
 * provider (the browser workbench has none for a test or virtual folder). Only the import contract's folders are offered.
 */
async function projectBoards(folder: vscode.WorkspaceFolder): Promise<BoardChoice[]> {
  const found: BoardChoice[] = [];
  const walk = async (segments: readonly string[]): Promise<void> => {
    const directory = segments.length === 0 ? folder.uri : vscode.Uri.joinPath(folder.uri, ...segments);
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(directory);
    } catch {
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
  return found.sort((left, right) => left.path.localeCompare(right.path));
}

/** The active board tab, or the author's pick from the project's boards. */
async function chooseBoard(): Promise<BoardChoice | undefined> {
  const active = vscode.window.activeTextEditor?.document.uri ?? activeCustomEditorUri();
  const activeChoice = active === undefined ? undefined : boardChoice(active);
  if (activeChoice !== undefined) return activeChoice;
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    await vscode.window.showErrorMessage("Open a project folder first: importing a board reads it from that project.");
    return undefined;
  }
  const folder = folders.length === 1
    ? folders[0]!
    : (await vscode.window.showQuickPick(folders.map((candidate) => ({ label: candidate.name, folder: candidate })), { title: "Import board as scene: project", ignoreFocusOut: true }))?.folder;
  if (folder === undefined) return undefined;
  const boards = await projectBoards(folder);
  if (boards.length === 0) {
    await vscode.window.showInformationMessage("This project folder has no boards in a Boards folder to import.");
    return undefined;
  }
  if (boards.length === 1) return boards[0];
  return (await vscode.window.showQuickPick(
    boards.map((board) => ({ label: board.path, board })),
    { title: "Import board as scene: choose a board", ignoreFocusOut: true, matchOnDescription: false },
  ))?.board;
}

/** Register the palette command, including saved boards that cannot open in the legacy editor. */
export function registerImportBoardAsScene(context: vscode.ExtensionContext, provider: GameEditorProvider<vscode.Uri>, hasDirtyTextDocument: (uri: vscode.Uri) => boolean): void {
  context.subscriptions.push(vscode.commands.registerCommand("tkr.importBoardAsScene", async () => {
    const board = await chooseBoard();
    if (board === undefined) return;
    const report = async (message: string): Promise<void> => { await vscode.window.showErrorMessage(message); };
    const live = provider.openDocument(board.uri);
    if (live !== undefined) {
      const result = await live.importAsScene();
      if (!result.ok) await report(result.error.message);
      return;
    }
    const folder = vscode.workspace.getWorkspaceFolder(board.uri);
    if (folder === undefined) {
      await report("The board is outside an open project folder, so its project cannot be resolved.");
      return;
    }
    const result = await importBoardScene({
      fs: createVscodeFileSystem(folder.uri),
      dialogs: createVscodeDialogs(folder.uri),
      projectId: folder.uri.toString(),
      boardPath: board.path,
      // The board was closed when the command started. Refuse if it becomes editable while its review is open.
      settle: async () => null,
      pendingEdits: () => hasDirtyTextDocument(board.uri) || provider.openDocument(board.uri) !== undefined,
      openScene: async (path) => { await vscode.commands.executeCommand("vscode.open", vscode.Uri.joinPath(folder.uri, ...path.split("/"))); },
    });
    if (!result.ok) await report(result.error.message);
  }));
}
