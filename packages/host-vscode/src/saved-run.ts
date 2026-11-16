import * as vscode from "vscode";
import { platformError, platformOk, type PlatformResult, type RunStartGuard } from "@tk-reawakened/platform-services";

export type RunGeneration = () => number;

/** Save every accepted editor, then capture the generation native runners must still see at snapshot start. */
export async function saveBeforeRun(generation: RunGeneration): Promise<PlatformResult<number>> {
  const before = generation();
  let saved: boolean;
  try {
    saved = await vscode.workspace.saveAll();
  } catch (error) {
    return platformError("io-error", `VS Code could not save open files: ${String(error)}`);
  }
  if (!saved) return platformError("io-error", "VS Code could not save all open files; nothing was run.");
  if (generation() !== before) return platformError("unavailable", "A document changed while VS Code was saving it; save again and retry the run.");
  if (vscode.workspace.textDocuments.some((document) => document.isDirty)) {
    return platformError("unavailable", "An open document is still unsaved; nothing was run.");
  }
  return platformOk(generation());
}

/** The final, synchronous gate shared by saved-byte runs after their inventory has been frozen. */
export function savedRunGuard(root: vscode.Uri, generation: RunGeneration, expected: number): RunStartGuard {
  return () => {
    const workspace = vscode.workspace.workspaceFolders?.find((folder) => folder.uri.toString() === root.toString());
    if (workspace === undefined) return platformError("unavailable", "The project workspace was closed before the saved run started.");
    return generation() === expected
      ? platformOk(undefined)
      : platformError("unavailable", "A document changed after the saved files were read; save again and retry the run.");
  };
}
