import * as vscode from "vscode";
import { createDocumentWorkspace, prepareGamePackage } from "@tk-reawakened/editor-model";
import { savePackageWithSaveAs, type PackageSavePort } from "./package-save.ts";
import { createVscodeServices } from "./services.ts";

const SAVE_LABEL = "Choose where to save…";

/** The Save As port over VS Code's own dialogs and workspace filesystem. */
function vscodeSavePort(projectRoot: vscode.Uri): PackageSavePort<vscode.Uri> {
  const fileName = (uri: vscode.Uri): string => uri.path.slice(uri.path.lastIndexOf("/") + 1);
  return {
    chooseDestination: async (suggested) => await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.joinPath(projectRoot, suggested),
      saveLabel: "Save package",
      title: "Save RPG Toolkit package",
      filters: { "RPG Toolkit package": ["tpk"] },
    }),
    fileName,
    sibling: (uri, name) => uri.with({ path: `${uri.path.slice(0, uri.path.lastIndexOf("/") + 1)}${name}` }),
    describe: (uri) => vscode.workspace.asRelativePath(uri, false),
    exists: async (uri) => {
      try {
        await vscode.workspace.fs.stat(uri);
        return true;
      } catch (error) {
        if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") return false;
        throw error;
      }
    },
    confirmReplace: async (existing) => {
      const names = existing.map(fileName).join(", ");
      const answer = await vscode.window.showWarningMessage(
        `${names} already exists in the chosen folder. Replace ${existing.length === 1 ? "it" : "them"}?`,
        { modal: true, detail: "Nothing is replaced unless you choose Replace." },
        "Replace",
      );
      return answer === "Replace";
    },
    write: async (uri, bytes) => { await vscode.workspace.fs.writeFile(uri, bytes); },
  };
}

/** Register the Explorer/command-palette entry that packages the selected project's main game. */
export function registerPackageGameCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand("tkr.packageGame", async (resource?: vscode.Uri, suppliedVersion?: string) => {
    const mainUri = resource ?? (await vscode.window.showOpenDialog({
      canSelectMany: false,
      canSelectFiles: true,
      canSelectFolders: false,
      openLabel: "Choose game to package",
      title: "Package RPG Toolkit game",
      filters: { "RPG Toolkit game": ["gam"] },
    }))?.[0];
    if (mainUri === undefined) return;
    const folder = vscode.workspace.getWorkspaceFolder(mainUri);
    if (folder === undefined || !mainUri.path.toLowerCase().endsWith(".gam")) {
      void vscode.window.showErrorMessage("Choose a .gam file inside an open RPG Toolkit project folder.");
      return;
    }
    const rootPath = folder.uri.path.replace(/\/$/, "");
    const mainPath = mainUri.path.slice(rootPath.length).replace(/^\/+/, "");
    const releaseVersion = suppliedVersion ?? await vscode.window.showInputBox({
      title: "Package RPG Toolkit game",
      prompt: "Enter the release version for the install descriptor.",
      placeHolder: "1.0.0",
      ignoreFocusOut: true,
      validateInput: (value) => value.trim().length === 0 ? "Enter a release version." : value.length > 128 ? "Use 128 characters or fewer." : undefined,
    });
    if (releaseVersion === undefined) return;
    if (!await vscode.workspace.saveAll(true)) {
      void vscode.window.showErrorMessage("Save open files before packaging the game.");
      return;
    }

    const services = createVscodeServices(folder.uri);
    const workspace = createDocumentWorkspace({ projectId: folder.uri.toString(), services });
    try {
      const prepared = await prepareGamePackage({ workspace, services, mainPath, version: releaseVersion });
      if (!prepared.ok) {
        void vscode.window.showErrorMessage(prepared.message);
        return;
      }
      const inventory = [
        `Included (${prepared.value.includedFiles.length}):`,
        ...prepared.value.includedFiles.map((path) => `  + ${path}`),
        `Excluded (${prepared.value.excludedFiles.length}):`,
        ...(prepared.value.excludedFiles.length === 0 ? ["  (none)"] : prepared.value.excludedFiles.map((path) => `  - ${path}`)),
      ].join("\n");
      const choice = await vscode.window.showInformationMessage(
        `Preflight passed: ${prepared.value.includedFiles.length} files will be packaged. Review the inventory, then choose where to save the package and its install descriptor.`,
        { modal: true, detail: `${inventory}\n\nThe package and descriptor are saved where you choose, through Save As. Files that already exist are replaced only if you confirm.` },
        SAVE_LABEL,
      );
      if (choice !== SAVE_LABEL) return;

      const saved = await savePackageWithSaveAs(vscodeSavePort(folder.uri), prepared.value);
      if (saved.ok) void vscode.window.showInformationMessage(saved.message);
      else if (!saved.cancelled) void vscode.window.showErrorMessage(saved.message);
    } catch {
      void vscode.window.showErrorMessage("Package export failed before completion. No successful export was reported.");
    } finally {
      workspace.dispose();
    }
  }));
}
