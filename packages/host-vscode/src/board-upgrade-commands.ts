import type * as vscode from "vscode";
import { createBoardCoordinateUpgradeCommand, upgradeBoardCopy, type BoardUpgradeOperation } from "@tk-reawakened/editor-model";
import type { DialogService, FileSystemService } from "@tk-reawakened/platform-services";
import type { GameEditorProvider } from "./custom-editor.ts";

type VscodeApi = typeof vscode;

export interface BoardUpgradeCommandHost {
  readonly vscode: VscodeApi;
  readonly activeEditorUri: () => vscode.Uri | undefined;
  readonly fileSystem: (root: vscode.Uri) => Pick<FileSystemService, "readProject" | "listProject" | "statProject" | "writeProject">;
  readonly dialogs: (root: vscode.Uri) => Pick<DialogService, "ask" | "pickSavePath">;
}

interface BoardChoice {
  readonly uri: vscode.Uri;
  readonly path: string;
}

const BOARD_PATH = /^(?:game\/(?:[^/]+\/)+)?boards\/.+\.brd$/i;

function boardChoice(api: VscodeApi, uri: vscode.Uri): BoardChoice | undefined {
  const folder = api.workspace.getWorkspaceFolder(uri);
  if (folder === undefined || folder.uri.scheme !== uri.scheme || folder.uri.authority !== uri.authority) return undefined;
  const root = folder.uri.path.replace(/\/$/, "");
  if (!uri.path.startsWith(`${root}/`)) return undefined;
  const path = uri.path.slice(root.length + 1);
  return BOARD_PATH.test(path) ? { uri, path } : undefined;
}


async function projectBoards(api: VscodeApi, folder: vscode.WorkspaceFolder): Promise<{ readonly boards: BoardChoice[]; readonly failures: string[] }> {
  const found: BoardChoice[] = [];
  const failures: string[] = [];
  const walk = async (segments: readonly string[]): Promise<void> => {
    const directory = segments.length === 0 ? folder.uri : api.Uri.joinPath(folder.uri, ...segments);
    let entries: [string, vscode.FileType][];
    try {
      entries = await api.workspace.fs.readDirectory(directory);
    } catch (error) {
      failures.push(`${segments.join("/") || folder.name}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    const depth = segments.length;
    const root = segments[0]?.toLowerCase();
    const inBoards = segments.some((segment) => segment.toLowerCase() === "boards");
    for (const [name, type] of entries) {
      if ((type & api.FileType.SymbolicLink) !== 0) continue;
      if ((type & api.FileType.Directory) !== 0) {
        const key = name.toLowerCase();
        const leadsToBoards = depth === 0 ? key === "boards" || key === "game"
          : root === "game" && !inBoards;
        if (inBoards || leadsToBoards) await walk([...segments, name]);
      } else if (inBoards && (type & api.FileType.File) !== 0 && /\.brd$/i.test(name)) {
        const path = [...segments, name].join("/");
        found.push({ uri: api.Uri.joinPath(directory, name), path });
      }
    }
  };
  await walk([]);
  return { boards: found.sort((left, right) => left.path.localeCompare(right.path)), failures };
}

async function chooseProjectBoard(api: VscodeApi, folder: vscode.WorkspaceFolder): Promise<BoardChoice | undefined> {
  const found = await projectBoards(api, folder);
  if (found.failures.length > 0) {
    await api.window.showErrorMessage(`Could not list every board folder: ${found.failures.join("; ")}. No upgrade was started.`);
    return undefined;
  }
  if (found.boards.length === 0) {
    await api.window.showInformationMessage("This project has no boards under a Boards folder.");
    return undefined;
  }
  if (found.boards.length === 1) return found.boards[0];
  return (await api.window.showQuickPick(found.boards.map((board) => ({ label: board.path, board })), {
    title: "Choose a board to upgrade", ignoreFocusOut: true,
  }))?.board;
}

async function chooseBoard(api: VscodeApi, operation: BoardUpgradeOperation, activeEditorUri: () => vscode.Uri | undefined, originUri?: vscode.Uri): Promise<BoardChoice | undefined> {
  if (originUri !== undefined) {
    const origin = boardChoice(api, originUri);
    if (origin === undefined) {
      await api.window.showErrorMessage("The requesting board editor is not a board inside an open project folder.");
      return undefined;
    }
    if (operation !== "pre-vector") return origin;
    const folder = api.workspace.getWorkspaceFolder(origin.uri);
    if (folder === undefined) {
      await api.window.showErrorMessage("The requesting board editor is not inside an open project folder.");
      return undefined;
    }
    return chooseProjectBoard(api, folder);
  }
  const active = api.window.activeTextEditor?.document.uri ?? activeEditorUri();
  const activeChoice = active === undefined ? undefined : boardChoice(api, active);
  if (operation !== "pre-vector" && activeChoice !== undefined) return activeChoice;
  const folders = api.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    await api.window.showErrorMessage("Open a project folder first: board upgrades read and create files in that project.");
    return undefined;
  }
  const folder = folders.length === 1
    ? folders[0]!
    : (await api.window.showQuickPick(folders.map((candidate) => ({ label: candidate.name, folder: candidate })), { title: "Choose project", ignoreFocusOut: true }))?.folder;
  if (folder === undefined) return undefined;
  return chooseProjectBoard(api, folder);
}


export function registerBoardUpgradeCommands(
  context: vscode.ExtensionContext,
  provider: GameEditorProvider<vscode.Uri>,
  hasDirtyTextDocument: (uri: vscode.Uri) => boolean,
  host: BoardUpgradeCommandHost,
): void {
  const { vscode: api, activeEditorUri, fileSystem, dialogs } = host;
  const register = (id: string, operation: BoardUpgradeOperation): void => {
    context.subscriptions.push(api.commands.registerCommand(id, async (originUri?: vscode.Uri) => {
      const choice = await chooseBoard(api, operation, activeEditorUri, originUri);
      if (choice === undefined) return;
      const folder = api.workspace.getWorkspaceFolder(choice.uri);
      if (folder === undefined) {
        await api.window.showErrorMessage(`${choice.path} is outside an open project folder.`);
        return;
      }
      const live = provider.openDocument(choice.uri);
      if (live !== undefined) {
        const unsettled = await live.settleViews();
        if (unsettled !== null) {
          await api.window.showErrorMessage(`Could not confirm the board's pending edits: ${unsettled}. Nothing was written.`);
          return;
        }
      }
      const fs = fileSystem(folder.uri);
      const projectId = folder.uri.toString();
      const result = await upgradeBoardCopy({
        fs,
        dialogs: dialogs(folder.uri),
        projectId,
        boardPath: choice.path,
        operation,
        hasPendingEdits: async () => {
          const dirtyText = hasDirtyTextDocument(choice.uri);
          const currentLive = provider.openDocument(choice.uri);
          if (currentLive === undefined) return dirtyText;
          if (await currentLive.settleViews() !== null) return true;
          const snapshot = currentLive.model.getSnapshot();
          return dirtyText || snapshot.dirty || snapshot.saving || snapshot.conflict !== null;
        },
        hasPendingEditsNow: () => {
          const dirtyText = hasDirtyTextDocument(choice.uri);
          const currentLive = provider.openDocument(choice.uri);
          if (currentLive === undefined) return dirtyText;
          const snapshot = currentLive.model.getSnapshot();
          return dirtyText || snapshot.dirty || snapshot.saving || snapshot.conflict !== null;
        },
        isDestinationOpen: (destination) => provider.openDocument(api.Uri.joinPath(folder.uri, ...destination.split("/"))) !== undefined,
        createExclusive: null,
      });
      if (!result.ok) {
        await api.window.showErrorMessage(result.error.message);
        return;
      }
      if (result.value === null) return;
      const { destination, bytes } = result.value;
      const copyUri = api.Uri.joinPath(folder.uri, ...destination.split("/"));
      await api.commands.executeCommand("vscode.openWith", copyUri, "tkr.board");
      const copy = provider.openDocument(copyUri);
      if (copy === undefined || copy.model.kind !== "board") {
        await api.window.showErrorMessage(`${destination} was created but could not be reopened as a board; its coordinate conversion was not applied.`);
        return;
      }
      const reopened = copy.model.serialize();
      const state = copy.model.getSnapshot();
      if (reopened.length !== bytes.length || reopened.some((value, index) => value !== bytes[index])
        || state.dirty || state.saving || state.conflict !== null) {
        await api.window.showErrorMessage(`${destination} did not reopen as the reviewed, clean copy. No conversion was applied.`);
        return;
      }
      if (operation === "pre-vector") return;
      const command = createBoardCoordinateUpgradeCommand(reopened, operation);
      if (!command.ok) {
        await api.window.showErrorMessage(`${destination} was opened but its coordinate conversion was refused: ${command.message}`);
        return;
      }
      const applied = copy.model.apply(command.value);
      if (!applied.ok) {
        await api.window.showErrorMessage(`${destination} was opened but its coordinate conversion was refused: ${applied.rejection.message}`);
        return;
      }
      copy.didEdit(applied.editId);
      const saved = await copy.saveThroughWorkbench();
      if (!saved.ok) await api.window.showErrorMessage(saved.failure.message);
    }));
  };
  register("tkr.upgradeBoardStackedToRotated", "stacked-to-rotated");
  register("tkr.upgradeBoardTileToPixel", "tile-to-pixel");
  register("tkr.upgradePreVectorBoard", "pre-vector");
}
