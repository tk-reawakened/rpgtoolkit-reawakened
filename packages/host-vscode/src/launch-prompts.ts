import * as vscode from "vscode";
import type { LaunchKind } from "@tk-reawakened/platform-services";
import type { LaunchPrompts } from "./run-configuration.ts";

/** The workspace-relative path of `uri`, or `undefined` outside `root` or with `.`/`..` segments. */
export function relativeToWorkspace(root: vscode.Uri, uri: vscode.Uri): string | undefined {
  if (uri.scheme !== root.scheme || uri.authority !== root.authority) return undefined;
  const base = root.path === "/" ? "" : root.path.replace(/\/+$/, "");
  const relative = uri.path === root.path ? "" : uri.path.startsWith(`${base}/`) ? uri.path.slice(base.length + 1) : undefined;
  return relative === undefined || relative.split("/").some((part) => part === "." || part === "..") ? undefined : relative;
}

/** The spellings of a workspace folder a launch configuration may use for an absolute path (ADR 0037 item 2). */
export function workspaceRoots(root: vscode.Uri): string[] {
  return [...new Set([root.toString(), root.fsPath, root.path])].filter((spelling) => spelling !== "");
}

export async function projectFolderChoices(root: vscode.Uri): Promise<Array<{ label: string; folder: string }>> {
  const choices = [{ label: "Workspace root (package layout)", folder: "" }];
  try {
    for (const [name, type] of await vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(root, "Game"))) {
      if ((type & vscode.FileType.Directory) !== 0) choices.push({ label: `Game/${name}`, folder: `Game/${name}` });
    }
  } catch (error) {
    if (!(error instanceof vscode.FileSystemError) || error.code !== "FileNotFound") throw error;
  }
  return choices;
}

/** Ask which workspace folder a launch belongs to; one folder is used without asking. */
export async function pickWorkspace(title: string): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    void vscode.window.showErrorMessage("Open a workspace folder first.");
    return undefined;
  }
  if (folders.length === 1) return folders[0];
  return (await vscode.window.showQuickPick(folders.map((workspace) => ({ label: workspace.name, description: workspace.uri.toString(), workspace })),
    { title, ignoreFocusOut: true }))?.workspace;
}

/**
 * The palette commands' questions, one per missing launch value (ADR 0037 item 3). The Test Program command and the
 * `tkr` debug configuration provider both use these, so the two routes ask the same way. A wrong choice (a file outside
 * the workspace folder) is reported and cancels, as the command always did.
 */
export function createLaunchPrompts(workspace: vscode.Uri): LaunchPrompts {
  const folderUri = (projectFolder: string): vscode.Uri => projectFolder === "" ? workspace : vscode.Uri.joinPath(workspace, ...projectFolder.split("/"));
  return {
    kind: async () => (await vscode.window.showQuickPick<{ label: string; description: string; launch: LaunchKind }>([
      { label: "Run game", description: "Start the game the way a player does", launch: "game" },
      { label: "Test board", description: "Start on a chosen board and position with a chosen party", launch: "board" },
      { label: "Test program", description: "Run one program with test settings", launch: "program" },
    ], { title: "Which launch?", ignoreFocusOut: true }))?.launch,
    main: async () => {
      const selected = await pickOne(workspace, "Choose the game's .gam main file", { "RPG Toolkit game": ["gam"] });
      if (selected === undefined) return undefined;
      const main = relativeToWorkspace(workspace, selected);
      if (main === undefined || !main.toLowerCase().endsWith(".gam")) return refuse("Choose a .gam main file inside the selected workspace.");
      return main;
    },
    projectFolder: async () => (await vscode.window.showQuickPick(await projectFolderChoices(workspace), {
      title: "Choose the game's asset folder", placeHolder: "Workspace root or Game/<game>", ignoreFocusOut: true,
    }))?.folder,
    program: async (projectFolder) => await relativePick(folderUri(projectFolder), "Choose the RPGCode program to test", { "RPGCode program": ["prg"] },
      "Choose a program file inside the selected workspace."),
    board: async (projectFolder, purpose) => await relativePick(folderUri(projectFolder),
      purpose === "fixture" ? "Choose the fixture board" : "Choose the board to test", { "RPG Toolkit boards": ["brd"] },
      "Choose a board file inside the selected workspace."),
    coordinate: async (name) => {
      const prompt = name === "x" ? "Start X (tile)" : name === "y" ? "Start Y (tile)" : "Start layer";
      const text = await vscode.window.showInputBox({
        prompt, value: "1", ignoreFocusOut: true,
        validateInput: (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? undefined : "Enter a positive whole number.",
      });
      return text === undefined ? undefined : Number(text);
    },
    party: async (projectFolder, required) => {
      if (!required) {
        const action = await vscode.window.showQuickPick([
          { label: "Choose fixture party members", id: "choose" },
          { label: "No party members", id: "none" },
        ], { title: "Fixture party", ignoreFocusOut: true });
        if (action === undefined) return undefined;
        if (action.id === "none") return [];
      }
      const selections = await vscode.window.showOpenDialog({
        title: required ? "Choose the party (1 to 5 characters, leader first)" : "Choose fixture party members",
        canSelectMany: true, canSelectFiles: true, canSelectFolders: false,
        defaultUri: vscode.Uri.joinPath(folderUri(projectFolder), "Chrs"), filters: { "Character files": ["tem"] },
      });
      if (selections === undefined || selections.length === 0) return undefined;
      const party = selections.map((uri) => relativeToWorkspace(workspace, uri));
      if (party.some((path) => path === undefined)) return refuse("Choose party member files inside the selected workspace.");
      return party as string[];
    },
    font: async () => await vscode.window.showInputBox({ prompt: "Fixture font name (leave blank for the game's default)", ignoreFocusOut: true }),
    fontSize: async () => {
      const text = await vscode.window.showInputBox({
        prompt: "Fixture font size (leave blank for the game's default)",
        validateInput: (value) => value === "" || (Number.isFinite(Number(value)) && Number(value) > 0) ? undefined : "Enter a positive finite font size, or leave this blank.",
        ignoreFocusOut: true,
      });
      return text === undefined ? undefined : text === "" ? null : Number(text);
    },
    windowGraphic: async (projectFolder) => {
      const action = await vscode.window.showQuickPick([
        { label: "Choose a message-window graphic", id: "choose" },
        { label: "No message-window graphic", id: "none" },
      ], { title: "Fixture message-window graphic", ignoreFocusOut: true });
      if (action === undefined) return undefined;
      if (action.id === "none") return null;
      return await relativePick(folderUri(projectFolder), "Choose the message-window graphic", {}, "Choose a message-window graphic inside the selected workspace.");
    },
  };

  async function relativePick(root: vscode.Uri, title: string, filters: Record<string, string[]>, outside: string): Promise<string | undefined> {
    const selected = await pickOne(root, title, filters);
    if (selected === undefined) return undefined;
    return relativeToWorkspace(workspace, selected) ?? refuse(outside);
  }
}

async function pickOne(root: vscode.Uri, title: string, filters: Record<string, string[]>): Promise<vscode.Uri | undefined> {
  const selected = await vscode.window.showOpenDialog({
    title, canSelectMany: false, canSelectFiles: true, canSelectFolders: false, defaultUri: root, filters,
  });
  return selected?.[0];
}

function refuse(message: string): undefined {
  void vscode.window.showErrorMessage(message);
  return undefined;
}
