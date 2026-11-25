import { foldPath } from "@tk-reawakened/core";
import type * as vscode from "vscode";
import { createBoardCoordinateUpgradeCommand, projectLayoutOfMainFromBytes, projectLayoutOwnerForDocumentPath, reservedFolder, resolveReservedFolderPath, upgradeBoardCopy, type BoardUpgradeOperation, type ProjectLayout, type ProjectLayoutOwner } from "@tk-reawakened/editor-model";
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
  readonly boardsRoot: string;
  readonly owner: ProjectLayoutOwner;
}

interface VscodeProjectLayoutOwner extends ProjectLayoutOwner {
  readonly prospectiveLayout: ProjectLayout | null;
}

function sameOwner(left: ProjectLayoutOwner | null, right: ProjectLayoutOwner | null): boolean {
  return left !== null && right !== null
    && left.mainPath === right.mainPath
    && foldPath(left.layout.projectFolder) === foldPath(right.layout.projectFolder);
}

function isWithin(path: string, root: string): boolean {
  const candidate = foldPath(path);
  const folder = foldPath(root).replace(/\/+$/g, "");
  return candidate.startsWith(`${folder}/`);
}

async function projectBoardRoots(
  api: VscodeApi,
  folder: vscode.WorkspaceFolder,
  fileSystem: BoardUpgradeCommandHost["fileSystem"],
): Promise<{ readonly roots: string[]; readonly failures: string[]; readonly owners: VscodeProjectLayoutOwner[] }> {
  const fs = fileSystem(folder.uri);
  const projectId = folder.uri.toString();
  const list = (path: string) => fs.listProject(projectId, path);
  const requested = new Map([[foldPath("boards"), "boards"]]);
  const owners: VscodeProjectLayoutOwner[] = [];
  const failures: string[] = [];
  try {
    const rootEntries = await api.workspace.fs.readDirectory(folder.uri);
    const main = rootEntries.find(([name, type]) => name.toLowerCase() === "main" && (type & api.FileType.Directory) !== 0);
    if (main !== undefined) {
      const mainFolder = api.Uri.joinPath(folder.uri, main[0]);
      const mainEntries = await api.workspace.fs.readDirectory(mainFolder);
      for (const [name, type] of mainEntries) {
        if ((type & api.FileType.File) === 0 || !/\.gam$/i.test(name)) continue;
        const mainPath = `${main[0]}/${name}`;
        const readable = await fs.readProject(projectId, mainPath);
        if (!readable.ok) {
          if (readable.error.code === "not-found") continue;
          throw new Error(`Could not read ${mainPath}: ${readable.error.message}`);
        }
        const layout = await projectLayoutOfMainFromBytes({ list }, readable.value, mainPath);
        const prospective = await projectLayoutOfMainFromBytes({ list }, readable.value, mainPath, true);
        owners.push({
          mainPath,
          layout,
          prospectiveLayout: foldPath(prospective.projectFolder) !== foldPath(layout.projectFolder) ? prospective : null,
        });
        const requestedRoot = reservedFolder(layout, "boards");
        requested.set(foldPath(requestedRoot), requestedRoot);
      }
    }
  } catch (error) {
    failures.push(`Main: ${error instanceof Error ? error.message : String(error)}`);
    return { roots: [], failures, owners };
  }
  const roots: string[] = [];
  for (const requestedRoot of requested.values()) {
    const resolved = await resolveReservedFolderPath({ list }, requestedRoot);
    if (resolved.failure !== null) {
      failures.push(`${resolved.failure.path}: ${resolved.failure.error.message}`);
      continue;
    }
    roots.push(resolved.path);
  }
  return { roots, failures, owners };
}

async function boardChoice(
  api: VscodeApi,
  uri: vscode.Uri,
  fileSystem: BoardUpgradeCommandHost["fileSystem"],
): Promise<BoardChoice | undefined> {
  const folder = api.workspace.getWorkspaceFolder(uri);
  if (folder === undefined || folder.uri.scheme !== uri.scheme || folder.uri.authority !== uri.authority) return undefined;
  const root = folder.uri.path.replace(/\/$/, "");
  if (!isWithin(uri.path, root)) return undefined;
  const path = uri.path.slice(root.length + 1);
  if (!/\.brd$/i.test(path)) return undefined;
  const discovered = await projectBoardRoots(api, folder, fileSystem);
  if (discovered.failures.length > 0) return undefined;
  const owner = projectLayoutOwnerForDocumentPath(path, discovered.owners);
  if (owner === null) return undefined;
  const fs = fileSystem(folder.uri);
  const resolved = await resolveReservedFolderPath(
    { list: (candidate) => fs.listProject(folder.uri.toString(), candidate) },
    reservedFolder(owner.layout, "boards"),
  );
  if (resolved.failure !== null || !isWithin(path, resolved.path)) return undefined;
  return { uri, path, boardsRoot: resolved.path, owner };
}

async function projectBoards(
  api: VscodeApi,
  folder: vscode.WorkspaceFolder,
  fileSystem: BoardUpgradeCommandHost["fileSystem"],
): Promise<{ readonly boards: BoardChoice[]; readonly failures: string[]; readonly owners: ProjectLayoutOwner[] }> {
  const discovered = await projectBoardRoots(api, folder, fileSystem);
  const failures = [...discovered.failures];
  if (failures.length > 0) return { boards: [], failures, owners: discovered.owners };
  const fs = fileSystem(folder.uri);
  const byPath = new Map<string, BoardChoice>();
  const ownerRoots = new Map<string, string | null>();
  const collisionKeys = new Set<string>();
  for (const boardsRoot of discovered.roots) {
    const rootListing = await fs.listProject(folder.uri.toString(), boardsRoot);
    if (!rootListing.ok) {
      if (rootListing.error.code !== "not-found") failures.push(`${boardsRoot}: ${rootListing.error.message}`);
      continue;
    }
    const walk = async (segments: readonly string[]): Promise<void> => {
      const path = [...boardsRoot.split("/"), ...segments].filter(Boolean).join("/");
      const entries = await fs.listProject(folder.uri.toString(), path);
      if (!entries.ok) {
        failures.push(`${path}: ${entries.error.message}`);
        return;
      }
      for (const entry of entries.value) {
        const child = [...segments, entry.name];
        const childPath = [...boardsRoot.split("/"), ...child].filter(Boolean).join("/");
        if (entry.kind === "directory") {
          await walk(child);
          continue;
        }
        if (entry.kind !== "file" || !/\.brd$/i.test(entry.name)) continue;
        const owner = projectLayoutOwnerForDocumentPath(childPath, discovered.owners);
        if (owner === null) {
          failures.push(`${childPath}: more than one game claims this board path.`);
          continue;
        }
        const ownerKey = owner.mainPath ?? "<loose>";
        let ownerBoardsRoot = ownerRoots.get(ownerKey);
        if (ownerBoardsRoot === undefined) {
          const resolved = await resolveReservedFolderPath(
            { list: (candidate) => fs.listProject(folder.uri.toString(), candidate) },
            reservedFolder(owner.layout, "boards"),
          );
          if (resolved.failure !== null) {
            failures.push(`${resolved.failure.path}: ${resolved.failure.error.message}`);
            ownerRoots.set(ownerKey, null);
            continue;
          }
          ownerBoardsRoot = resolved.path;
          ownerRoots.set(ownerKey, ownerBoardsRoot);
        }
        if (ownerBoardsRoot === null || !isWithin(childPath, ownerBoardsRoot)) continue;
        const key = foldPath(childPath);
        const choice: BoardChoice = {
          uri: api.Uri.joinPath(folder.uri, ...childPath.split("/")),
          path: childPath,
          boardsRoot: ownerBoardsRoot,
          owner,
        };
        const previous = byPath.get(key);
        if (previous !== undefined && previous.path !== choice.path) {
          if (!collisionKeys.has(key)) {
            failures.push(`${previous.path} and ${choice.path} differ only by case; board selection is ambiguous.`);
            collisionKeys.add(key);
          }
          continue;
        }
        if (previous === undefined || choice.boardsRoot.length > previous.boardsRoot.length) byPath.set(key, choice);
      }
    };
    await walk([]);
  }
  return { boards: [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path)), failures, owners: discovered.owners };
}



async function chooseProjectBoard(api: VscodeApi, folder: vscode.WorkspaceFolder, fileSystem: BoardUpgradeCommandHost["fileSystem"]): Promise<BoardChoice | undefined> {
  const found = await projectBoards(api, folder, fileSystem);
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

async function chooseBoard(api: VscodeApi, operation: BoardUpgradeOperation, activeEditorUri: () => vscode.Uri | undefined, fileSystem: BoardUpgradeCommandHost["fileSystem"], originUri?: vscode.Uri): Promise<BoardChoice | undefined> {
  if (originUri !== undefined) {
    const origin = await boardChoice(api, originUri, fileSystem);
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
    return chooseProjectBoard(api, folder, fileSystem);
  }
  const active = api.window.activeTextEditor?.document.uri ?? activeEditorUri();
  const activeChoice = active === undefined ? undefined : await boardChoice(api, active, fileSystem);
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
  return chooseProjectBoard(api, folder, fileSystem);
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
      const choice = await chooseBoard(api, operation, activeEditorUri, fileSystem, originUri);
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
        boardsRoot: choice.boardsRoot,
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
        isDestinationOwnedBySource: async (destination) => {
          const discovered = await projectBoardRoots(api, folder, fileSystem);
          if (discovered.failures.length > 0) return false;
          const sourceOwner = projectLayoutOwnerForDocumentPath(choice.path, discovered.owners);
          if (sourceOwner === null || !sameOwner(sourceOwner, choice.owner)) return false;
          const destinationOwners: ProjectLayoutOwner[] = discovered.owners.map((owner) => ({
            mainPath: owner.mainPath,
            layout: owner.prospectiveLayout ?? owner.layout,
          }));
          const destinationOwner = projectLayoutOwnerForDocumentPath(destination, destinationOwners);
          if (destinationOwner === null || !sameOwner(sourceOwner, destinationOwner)) return false;
          const sourceBoards = await resolveReservedFolderPath(
            { list: (candidate) => fs.listProject(projectId, candidate) },
            reservedFolder(sourceOwner.layout, "boards"),
          );
          const destinationBoards = await resolveReservedFolderPath(
            { list: (candidate) => fs.listProject(projectId, candidate) },
            reservedFolder(destinationOwner.layout, "boards"),
          );
          return sourceBoards.failure === null && destinationBoards.failure === null
            && isWithin(choice.path, sourceBoards.path)
            && isWithin(destination, destinationBoards.path);
        },
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
