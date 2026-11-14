import * as vscode from "vscode";
import { createDocumentWorkspace, prepareGamePackage, publishGamePackage } from "@tk-reawakened/editor-model";
import { createVscodeServices } from "./services.ts";

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
      const publish = await vscode.window.showInformationMessage(
        `Preflight passed: ${prepared.value.includedFiles.length} files will be packaged. Review the inventory before publishing.`,
        { modal: true, detail: inventory },
        "Publish package…",
      );
      if (publish !== "Publish package…") return;

      if (services.capabilities.has("folderWrite")) {
        const result = await publishGamePackage(services, mainPath, prepared.value);
        if (!result.ok) {
          void vscode.window.showErrorMessage(result.message);
          return;
        }
        void vscode.window.showInformationMessage(`Package and install descriptor saved to ${result.path}.`);
        return;
      }
      for (const artifact of [prepared.value.package, prepared.value.descriptor]) {
        const result = await services.packageExport?.downloadFile(artifact.fileName, artifact.bytes);
        if (result === undefined || !result.ok) {
          void vscode.window.showErrorMessage(result === undefined ? "This host does not provide package downloads." : result.error.message);
          return;
        }
      }
      void vscode.window.showInformationMessage("Package and install descriptor downloads started.");
    } catch {
      void vscode.window.showErrorMessage("Package export failed before completion. No successful export was reported.");
    } finally {
      workspace.dispose();
    }
  }));
}
