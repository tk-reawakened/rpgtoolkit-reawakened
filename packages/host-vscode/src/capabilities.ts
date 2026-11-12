import type { Capability } from "@tk-reawakened/platform-services";

export const VSCODE_CAPABILITIES = ["folderWrite", "fileWatch", "stableProjectHandle"] as const satisfies readonly Capability[];
