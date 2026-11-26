import * as vscode from "vscode";
import { prepareGameSetup } from "@tk-reawakened/editor-model";
import { savePackageWithSaveAs, type PackageSavePort } from "./package-save.ts";
import { ensureExportParent, fileNameOf, preflightGamePackage, siblingUri, vscodeDestinationKind } from "./package-preflight.ts";
import { validatePackageDestination } from "./package-destination.ts";
import { replaceSetupFile, saveSetupWithSaveAs, type SetupSavePort } from "./setup-save.ts";

const SAVE_PACKAGE_LABEL = "Choose where to save…";
const SAVE_SETUP_LABEL = "Choose where to save the setup…";

function vscodeSavePort(projectRoot: vscode.Uri): PackageSavePort<vscode.Uri> {
  return {
    chooseDestination: async (suggested) => await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.joinPath(projectRoot, ".tkr-exports", suggested),
      saveLabel: "Save package",
      title: "Save RPG Toolkit package",
      filters: { "RPG Toolkit package": ["tpk"] },
    }),
    fileName: fileNameOf,
    sibling: siblingUri,
    describe: (uri) => vscode.workspace.asRelativePath(uri, false),
    validateDestination: async (uri) => validatePackageDestination(projectRoot, uri),
    inspect: vscodeDestinationKind,
    confirmReplace: async (existing) => {
      const names = existing.map(fileNameOf).join(", ");
      const answer = await vscode.window.showWarningMessage(
        `${names} already exists in the chosen folder. Replace ${existing.length === 1 ? "it" : "them"}?`,
        { modal: true, detail: "Nothing is replaced unless you choose Replace." },
        "Replace",
      );
      return answer === "Replace";
    },
    write: async (uri, bytes) => {
      await ensureExportParent(projectRoot, uri);
      await vscode.workspace.fs.writeFile(uri, bytes);
    },
  };
}

/**
 * One setup ZIP, written in full beside the destination and only then swapped in, so a failed save keeps an earlier
 * setup file (`docs/spec/formats/packaging-and-paths.md#reawakened-setup-delivery`).
 */
function vscodeSetupPort(projectRoot: vscode.Uri): SetupSavePort<vscode.Uri> {
  return {
    chooseDestination: async (suggested) => await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.joinPath(projectRoot, ".tkr-exports", suggested),
      saveLabel: "Save game setup",
      title: "Save RPG Toolkit game setup",
      filters: { "RPG Toolkit game setup": ["zip"] },
    }),
    fileName: fileNameOf,
    describe: (uri) => vscode.workspace.asRelativePath(uri, false),
    validateDestination: async (uri) => validatePackageDestination(projectRoot, uri),
    inspect: vscodeDestinationKind,
    confirmReplace: async (existing) => {
      const answer = await vscode.window.showWarningMessage(
        `${fileNameOf(existing)} already exists in the chosen folder. Replace it?`,
        { modal: true, detail: "The previous setup file is kept unless you choose Replace." },
        "Replace",
      );
      return answer === "Replace";
    },
    replace: async (uri, bytes) => {
      const refusal = validatePackageDestination(projectRoot, uri);
      if (refusal !== undefined) throw new Error(refusal);
      await ensureExportParent(projectRoot, uri);
      await replaceSetupFile({
        write: async (staging, contents) => { await vscode.workspace.fs.writeFile(staging, contents); },
        rename: async (staging, destination) => { await vscode.workspace.fs.rename(staging, destination, { overwrite: true }); },
        remove: async (staging) => { await vscode.workspace.fs.delete(staging); },
        stagingName: (destination) => `${fileNameOf(destination)}.partial-${crypto.randomUUID()}`,
        sibling: siblingUri,
      }, uri, bytes);
    },
  };
}

function message(error: unknown): string {
  const detail = error instanceof Error ? error.message : "unknown error";
  return /symbolic.?link|symlink/i.test(detail)
    ? `A symbolic link was detected in the project. Packaging will not follow it without safe containment support. ${detail}`
    : `Package export failed: ${detail}`;
}

/** Register the Explorer/command-palette entry that packages the selected project's main game. */
export function registerPackageGameCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand("tkr.packageGame", async (resource?: vscode.Uri, suppliedVersion?: string) => {
    try {
      const accepted = await preflightGamePackage(context, resource, suppliedVersion, {
        pickerTitle: "Package RPG Toolkit game",
        pickerLabel: "Choose game to package",
        versionTitle: "Package RPG Toolkit game",
        acceptLabel: SAVE_PACKAGE_LABEL,
        question: (includedFiles) => `Preflight passed: ${includedFiles} files will be packaged. Review the inventory, then choose where to save the package and its install descriptor.`,
        detailSuffix: "The package and descriptor are saved where you choose, through Save As. Files that already exist are replaced only if you confirm.",
      });
      if (accepted === undefined) return;
      const saved = await savePackageWithSaveAs(vscodeSavePort(accepted.folder), accepted.prepared);
      if (saved.ok) void vscode.window.showInformationMessage(saved.message);
      else if (!saved.cancelled) void vscode.window.showErrorMessage(saved.message);
    } catch (error) {
      void vscode.window.showErrorMessage(`${message(error)}. Nothing more was written.`);
    }
  }));
}

/**
 * Register the command that builds the reviewed setup ZIP (T-72, ADR 0045 5C). The ZIP holds only the package, its
 * install descriptor and the plain-text instructions; the player app installs and removes it.
 */
export function registerGameSetupCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand("tkr.packageGameSetup", async (resource?: vscode.Uri, suppliedVersion?: string) => {
    try {
      const accepted = await preflightGamePackage(context, resource, suppliedVersion, {
        pickerTitle: "Create RPG Toolkit game setup",
        pickerLabel: "Choose game for its setup",
        versionTitle: "Create RPG Toolkit game setup",
        acceptLabel: SAVE_SETUP_LABEL,
        question: (includedFiles) => `Preflight passed: ${includedFiles} game files will be bundled. Review the inventory, then choose the setup ZIP's destination.`,
        detailSuffix: "The setup ZIP holds the reviewed package, its install descriptor and plain-text instructions. A browser can download it but cannot install it; the player app's Install and Remove do.",
      });
      if (accepted === undefined) return;
      const setup = prepareGameSetup(accepted.prepared);
      if (!setup.ok) {
        void vscode.window.showErrorMessage(setup.message);
        return;
      }
      const contents = [
        `Setup file: ${setup.value.artifact.fileName}`,
        "It contains:",
        ...["package", "descriptor", "instructions"].map((key) => `  + ${setup.value[key as "package" | "descriptor" | "instructions"].fileName}`),
        "Dependencies: none outside these files. Nothing is signed and no installer runs.",
      ].join("\n");
      const reviewed = await vscode.window.showInformationMessage(
        "Review the setup ZIP contents and dependencies before saving it.",
        { modal: true, detail: contents },
        SAVE_SETUP_LABEL,
      );
      if (reviewed !== SAVE_SETUP_LABEL) {
        void vscode.window.showInformationMessage("Setup export was cancelled; nothing was written.");
        return;
      }
      const saved = await saveSetupWithSaveAs(vscodeSetupPort(accepted.folder), setup.value);
      if (saved.ok) void vscode.window.showInformationMessage(saved.message);
      else if (!saved.cancelled) void vscode.window.showErrorMessage(saved.message);
    } catch (error) {
      void vscode.window.showErrorMessage(`${message(error)}. Nothing more was written.`);
    }
  }));
}
