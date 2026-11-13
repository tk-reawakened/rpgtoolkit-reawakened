// Enumerate every installed package in the isolated npm lock, including nested copies; write JSON to stdout.
// Usage: node tools/spikes/e11-editor/inventory.mjs > /tmp/spike-package-inventory.json
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { depsDir } from "./env.mjs";

const lock = JSON.parse(readFileSync(join(depsDir, "package-lock.json"), "utf8"));
const packages = Object.keys(lock.packages).filter((path) => path && path.includes("node_modules/"));
const inventory = packages.map((path) => {
  const manifest = JSON.parse(readFileSync(join(depsDir, path, "package.json"), "utf8"));
  return { name: manifest.name, version: manifest.version, license: manifest.license, dependencies: manifest.dependencies ?? {} };
});
inventory.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
console.log(JSON.stringify(inventory, null, 2));
