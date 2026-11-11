// Resolve the Electron executable installed in this workspace.
//
// The `electron` npm package's main entry logs to stdout before it returns the path when the binary is missing, which
// pollutes any stdout capture. We read its `path.txt` directly and, if the binary is not on disk, run its install script
// synchronously. This keeps measurement and the run script deterministic on a fresh checkout.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

function electronRoot() {
  // Resolve from the repository root so this helper works wherever it is imported.
  return dirname(require.resolve("electron/package.json", { paths: [join(here, "..", "..")] }));
}

// Temporary CI investigation for #1918. Never change the launch result or print command-line arguments.
export function reportElectronLaunchFailure(error) {
  if (!process.env.CI || process.platform !== "linux" || !String(error).includes("ETXTBSY")) return;
  try {
    const executable = join(electronRoot(), "dist", readFileSync(join(electronRoot(), "path.txt"), "utf8").trim());
    const target = statSync(executable);
    console.error(`[electron-race] ETXTBSY pid=${process.pid} inode=${target.ino} dev=${target.dev}`);
    for (const pid of readdirSync("/proc").filter((name) => /^\d+$/.test(name))) {
      try {
        for (const fd of readdirSync(`/proc/${pid}/fd`)) {
          try {
            const file = statSync(`/proc/${pid}/fd/${fd}`);
            if (file.ino !== target.ino || file.dev !== target.dev) continue;
            const info = readFileSync(`/proc/${pid}/fdinfo/${fd}`, "utf8").match(/^flags:\s*(\S+)/m)?.[1];
            const comm = readFileSync(`/proc/${pid}/comm`, "utf8").trim();
            console.error(`[electron-race] holder pid=${pid} comm=${comm} fd=${fd} flags=${info}`);
          } catch { /* The descriptor may disappear during the scan. */ }
        }
      } catch { /* Processes may exit or be inaccessible. */ }
    }
  } catch (diagnosticError) {
    console.error("[electron-race] diagnostic failed:", diagnosticError);
  }
}

function ensureDownloaded(root) {
  const pathFile = join(root, "path.txt");
  if (process.env.CI) console.error(`[electron-race] pid=${process.pid} pathFileExists=${existsSync(pathFile)}`);
  if (!existsSync(pathFile)) {
    if (process.env.CI) console.error(`[electron-race] pid=${process.pid} starting installer: path missing`);
    execFileSync(process.execPath, [join(root, "install.js")], { cwd: root, stdio: "inherit" });
    if (process.env.CI) console.error(`[electron-race] pid=${process.pid} installer completed`);
  }
  const relative = readFileSync(pathFile, "utf8").trim();
  const full = join(root, "dist", relative);
  if (process.env.CI) console.error(`[electron-race] pid=${process.pid} executableExists=${existsSync(full)}`);
  if (!existsSync(full)) {
    if (process.env.CI) console.error(`[electron-race] pid=${process.pid} starting installer: binary missing`);
    execFileSync(process.execPath, [join(root, "install.js")], { cwd: root, stdio: "inherit" });
    if (process.env.CI) console.error(`[electron-race] pid=${process.pid} installer completed`);
  }
  return full;
}

export function electronBinary() {
  return ensureDownloaded(electronRoot());
}
