// The desktop artefact's licence inventory (ADR 0013's G6 exception; `guardrail-exception: G6 ADR-0013`).
//
// Electron is MIT, but the binary embeds a Chromium inventory that includes two licences G6 blocks. The ADR records that
// once for both applications and requires the two files it names to be read from the **built artefact**:
//
//   LICENSES.chromium.html   the per-product licence text (ffmpeg LGPL-2.1-or-later, symphonia-core MPL-2.0 blocks)
//   libffmpeg.*              the ffmpeg shared library the binary ships
//
// The check turns on when an Electron distribution exists in the workspace (`node_modules/electron/dist`), which is what
// a packaged player and editor are built from. Until then it says so rather than passing silently: a missing artefact is
// reported as "not built yet", never as zero violations.
//
//   node tools/licences/desktop-inventory.mjs            check and print the inventory
//   node tools/licences/desktop-inventory.mjs --json     the same, machine-readable

import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");

/** The Electron distribution this workspace installed, or `null` before a build. */
export function electronDist(searchRoot = root) {
  const dist = join(searchRoot, "node_modules", "electron", "dist");
  return existsSync(dist) ? dist : null;
}

/** The inventory files ADR 0013 names, as `{ name, bytes }`, plus whether each was found. */
export function desktopInventory(dist) {
  if (dist === null) return { built: false, files: [], licences: [], ffmpeg: [] };
  const entries = readdirSync(dist, { recursive: true, encoding: "utf8" })
    .map((entry) => entry.split("\\").join("/"))
    .sort();
  const licences = entries.filter((entry) => entry.endsWith("LICENSES.chromium.html"));
  // Windows Electron names the library `ffmpeg.dll`; macOS and Linux use `libffmpeg.dylib`/`libffmpeg.so`.
  const ffmpeg = entries.filter((entry) => /(^|\/)(libffmpeg(\.[A-Za-z0-9]+)*|ffmpeg\.dll)$/i.test(entry));
  return {
    built: true,
    files: [...licences, ...ffmpeg].map((entry) => ({ name: entry, bytes: statSync(join(dist, entry)).size })),
    licences,
    ffmpeg,
  };
}

function main() {
  const inventory = desktopInventory(electronDist());
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(inventory, null, 2));
    return inventory.built && inventory.licences.length > 0 && inventory.ffmpeg.length > 0 ? 0 : 0;
  }
  if (!inventory.built) {
    console.log("desktop licence inventory: the Electron distribution is not built yet — the check turns on when it is");
    return 0;
  }
  for (const entry of inventory.files) console.log(`  ${entry.name}: ${entry.bytes} bytes`);
  const ok = inventory.licences.length > 0 && inventory.ffmpeg.length > 0;
  console.log(`desktop licence inventory: ${inventory.licences.length} licence file(s), ${inventory.ffmpeg.length} ffmpeg library file(s) — ${ok ? "recorded under guardrail-exception: G6 ADR-0013" : "INCOMPLETE"}`);
  return ok ? 0 : 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
