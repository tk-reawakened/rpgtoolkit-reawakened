import * as path from "node:path";
import * as fs from "node:fs";

export function resolveServerModule(contextExtensionPath: string): string {
  const candidates = [
    path.join(contextExtensionPath, "server", "stdio.js"),
    path.join(contextExtensionPath, "..", "..", "packages", "lsp", "dist-bin", "stdio.js"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`RPGCode language server not found. Tried: ${candidates.join(", ")}`);
}
