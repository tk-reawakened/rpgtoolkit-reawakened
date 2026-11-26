import * as vscode from "vscode";
import { createDocumentWorkspace, prepareGamePackage, type PreparedGamePackage } from "@tk-reawakened/editor-model";
import type { PackageDestinationKind } from "./package-save.ts";
import { createVscodeServices } from "./services.ts";

/** How a host answers "what is already at this output path". */
export async function vscodeDestinationKind(uri: vscode.Uri): Promise<PackageDestinationKind> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if ((stat.type & vscode.FileType.SymbolicLink) !== 0) return "link";
    if ((stat.type & vscode.FileType.Directory) !== 0) return "directory";
    if ((stat.type & vscode.FileType.File) !== 0) return "file";
    return "other";
  } catch (error) {
    if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") return "missing";
    throw error;
  }
}

/** Create the project's reserved `.tkr-exports/` folder when the destination is an in-project output there. */
export async function ensureExportParent(projectRoot: vscode.Uri, uri: vscode.Uri): Promise<void> {
  if (uri.scheme !== projectRoot.scheme || uri.authority !== projectRoot.authority) return;
  if (!uri.path.startsWith(`${projectRoot.path.replace(/\/$/, "")}/.tkr-exports/`)) return;
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(projectRoot, ".tkr-exports"));
}

/** A sibling of `uri` in the same folder. */
export function siblingUri(uri: vscode.Uri, name: string): vscode.Uri {
  return uri.with({ path: `${uri.path.slice(0, uri.path.lastIndexOf("/") + 1)}${name}` });
}

/** The last path segment, as the host sees it. */
export function fileNameOf(uri: vscode.Uri): string {
  return uri.path.slice(uri.path.lastIndexOf("/") + 1);
}

/**
 * Save open documents, preflight the selected project's main game, and let the author review the inventory. Both the
 * package command and the setup command use this one preflight so their inventories cannot drift.
 */
export async function preflightGamePackage(
  context: vscode.ExtensionContext,
  resource: vscode.Uri | undefined,
  suppliedVersion: string | undefined,
  options: {
    readonly pickerTitle: string;
    readonly pickerLabel: string;
    readonly versionTitle: string;
    readonly acceptLabel: string;
    readonly question: (includedFiles: number) => string;
    readonly detailSuffix: string;
  },
): Promise<{ readonly folder: vscode.Uri; readonly prepared: PreparedGamePackage } | undefined> {
  const mainUri = resource ?? (await vscode.window.showOpenDialog({
    canSelectMany: false,
    canSelectFiles: true,
    canSelectFolders: false,
    openLabel: options.pickerLabel,
    title: options.pickerTitle,
    filters: { "RPG Toolkit game": ["gam"] },
  }))?.[0];
  if (mainUri === undefined) return undefined;
  const folder = vscode.workspace.getWorkspaceFolder(mainUri);
  if (folder === undefined || !mainUri.path.toLowerCase().endsWith(".gam")) {
    void vscode.window.showErrorMessage("Choose a .gam file inside an open RPG Toolkit project folder.");
    return undefined;
  }
  const rootPath = folder.uri.path.replace(/\/$/, "");
  const mainPath = mainUri.path.slice(rootPath.length).replace(/^\/+/, "");
  const releaseVersion = suppliedVersion ?? await vscode.window.showInputBox({
    title: options.versionTitle,
    prompt: "Enter the release version for the install descriptor.",
    placeHolder: "1.0.0",
    ignoreFocusOut: true,
    validateInput: (value) => value.trim().length === 0 ? "Enter a release version." : value.length > 128 ? "Use 128 characters or fewer." : undefined,
  });
  if (releaseVersion === undefined) return undefined;
  if (!await vscode.workspace.saveAll(true)) {
    void vscode.window.showErrorMessage("Save open files before packaging the game.");
    return undefined;
  }

  const services = createVscodeServices(folder.uri, context, () => 0);
  const workspace = createDocumentWorkspace({ projectId: folder.uri.toString(), services });
  try {
    const prepared = await prepareGamePackage({ workspace, services, mainPath, version: releaseVersion });
    if (!prepared.ok) {
      void vscode.window.showErrorMessage(prepared.message);
      return undefined;
    }
    const inventory = [
      `Included (${prepared.value.includedFiles.length}):`,
      ...prepared.value.includedFiles.map((path) => `  + ${path}`),
      `Excluded (${prepared.value.excludedFiles.length}):`,
      ...(prepared.value.excludedFiles.length === 0 ? ["  (none)"] : prepared.value.excludedFiles.map((path) => `  - ${path}`)),
    ].join("\n");
    const choice = await vscode.window.showInformationMessage(
      options.question(prepared.value.includedFiles.length),
      { modal: true, detail: `${inventory}\n\n${options.detailSuffix}` },
      options.acceptLabel,
    );
    if (choice !== options.acceptLabel) return undefined;
    return { folder: folder.uri, prepared: prepared.value };
  } finally {
    workspace.dispose();
  }
}
