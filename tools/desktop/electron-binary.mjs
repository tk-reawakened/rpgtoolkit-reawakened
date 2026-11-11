// Resolve Electron without letting concurrent lazy installers write the same executable.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const lockWaitMs = 300_000;
const pause = new Int32Array(new SharedArrayBuffer(4));

function electronRoot() {
  return dirname(require.resolve("electron/package.json", { paths: [join(here, "..", "..")] }));
}

// All callers take the lock, even if the executable already exists: another caller may still be extracting it.
// A killed process leaves its lock behind; fail explicitly instead of risking a second concurrent writer.
export function electronBinaryAt(root) {
  const lock = join(root, ".tkr-electron-install.lock");
  const deadline = Date.now() + lockWaitMs;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() >= deadline) {
        throw new Error(`Electron installation lock timed out: ${lock}. If no installer is running, remove this directory and try again.`);
      }
      Atomics.wait(pause, 0, 0, 50);
    }
  }
  try {
    const pathFile = join(root, "path.txt");
    if (!existsSync(pathFile)) {
      execFileSync(process.execPath, [join(root, "install.js")], { cwd: root, stdio: "inherit" });
    }
    const full = join(root, "dist", readFileSync(pathFile, "utf8").trim());
    if (!existsSync(full)) {
      execFileSync(process.execPath, [join(root, "install.js")], { cwd: root, stdio: "inherit" });
    }
    return full;
  } finally {
    rmdirSync(lock);
  }
}

export function electronBinary() {
  return electronBinaryAt(electronRoot());
}
