import type { Capability } from "@tk-reawakened/platform-services";

/**
 * What the VS Code host can do, declared truthfully (AD-20, ADR 0022 D3.5, D3.6). Every VS Code writes through
 * `workspace.fs`, keeps a workspace folder across restarts and backs up unsaved custom documents (hot exit). Only the
 * desktop build's file watcher reports changes other programs make; in a browser (`vscode.dev`) the watcher is not a
 * complete change log (ADR 0022 evidence table), so live change detection is not claimed there and a change is found
 * when the document is saved.
 */
export function vscodeCapabilities(desktop: boolean): readonly Capability[] {
  // `pickFile`: `showOpenDialog` works in both builds (a browser build shows the browser's own picker).
  return desktop
    ? ["folderWrite", "fileWatch", "stableProjectHandle", "backup", "pickFile"]
    : ["folderWrite", "stableProjectHandle", "backup", "pickFile"];
}
