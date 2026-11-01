// Resolve the Electron executable installed in this workspace.
//
// The `electron` npm package's main entry logs to stdout before it returns the path when the binary is missing, which
// pollutes any stdout capture. We read its `path.txt` directly and, if the binary is not on disk, run its install script
// synchronously. This keeps measurement and the run script deterministic on a fresh checkout.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

function electronRoot() {
  // Resolve from the repository root so this helper works wherever it is imported.
  return dirname(require.resolve("electron/package.json", { paths: [join(here, "..", "..")] }));
}

function ensureDownloaded(root) {
  const pathFile = join(root, "path.txt");
  if (!existsSync(pathFile)) {
    execFileSync(process.execPath, [join(root, "install.js")], { cwd: root, stdio: "inherit" });
  }
  const relative = readFileSync(pathFile, "utf8").trim();
  const full = join(root, "dist", relative);
  if (!existsSync(full)) {
    execFileSync(process.execPath, [join(root, "install.js")], { cwd: root, stdio: "inherit" });
  }
  return full;
}

export function electronBinary() {
  return ensureDownloaded(electronRoot());
}
