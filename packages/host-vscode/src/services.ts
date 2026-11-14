import * as vscode from "vscode";
import type { PackageExportService, PlatformServices, ProjectHandle, SettingValue, SettingsLayer } from "@tk-reawakened/platform-services";
import { platformError, platformOk } from "@tk-reawakened/platform-services";
import { vscodeCapabilities } from "./capabilities.ts";
import { createVscodeDialogs } from "./dialogs.ts";
import { createVscodeFileSystem } from "./filesystem.ts";

/** Build the host service surface around the chosen workspace folder. */
export function createVscodeServices(root: vscode.Uri): PlatformServices {
  const folder = vscode.workspace.getWorkspaceFolder(root);
  const project: ProjectHandle = { id: root.toString(), name: folder?.name ?? root.path.split("/").at(-1) ?? "Workspace" };
  return {
    capabilities: new Set(vscodeCapabilities(vscode.env.uiKind === vscode.UIKind.Desktop)),
    fs: createVscodeFileSystem(root),
    project: {
      open: async () => platformOk(project),
      recent: async () => platformOk((vscode.workspace.workspaceFolders ?? []).map((item) => ({ id: item.uri.toString(), name: item.name }))),
    },
    settings: {
      get: async (layer, id) => {
        const target = vscode.workspace.getConfiguration("rpgToolkit", folder?.uri).inspect<SettingValue>(id);
        const value = layer === "user" ? target?.globalValue : target?.workspaceValue;
        return platformOk(value === undefined ? null : value);
      },
      set: async (layer: SettingsLayer, id, value) => {
        const target = vscode.workspace.getConfiguration("rpgToolkit", folder?.uri);
        await target.update(id, value, layer === "user" ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace);
        return platformOk(undefined);
      },
    },
    document: { edited: () => undefined },
    dialogs: createVscodeDialogs(root),
    packageExport: vscodePackageExport(),
  };
}

/** The digest the install descriptor needs. Saving is done by the package command's Save As flow, not by this service. */
function vscodePackageExport(): PackageExportService {
  return {
    async sha256(bytes) {
      try {
        const crypto = globalThis.crypto;
        if (crypto?.subtle === undefined) return platformError("unavailable", "Web Crypto is unavailable for the package digest.");
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer));
        return platformOk([...digest].map((byte) => byte.toString(16).padStart(2, "0")).join(""));
      } catch {
        return platformError("io-error", "Could not calculate the package SHA-256 digest.");
      }
    },
  };
}
