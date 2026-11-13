import { BinaryReader, assetKey, createAssetIndex, projectScriptDialect, readMainFile, type AssetKey, type ProgramLoader } from "@tk-reawakened/core";
import { indexLintProject, isLintHookAssetPath, lintProjectRoot } from "@tk-reawakened/script-tools";
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/** Read the selected .gam and its source tree without following filesystem links. */
export function readLintProject(path: string) {
  const mainPath = resolve(path);
  let mainBytes: Uint8Array;
  try {
    mainBytes = readFileSync(mainPath);
  } catch (error) {
    return { ok: false as const, path, message: `cannot read ${path}: ${error instanceof Error ? error.message : String(error)}` };
  }
  const main = readMainFile(new BinaryReader(mainBytes, path));
  if (!main.ok) return { ok: false as const, path, message: main.error.message };
  const folder = dirname(mainPath);
  const root = basename(folder).toLowerCase() === "main" ? dirname(folder) : folder;
  const paths: string[] = [];
  const bytes = new Map<AssetKey, Uint8Array>();
  let complete = true;
  function visit(prefix: string): void {
    try {
      const entries = readdirSync(join(root, prefix), { withFileTypes: true });
      entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      for (const entry of entries) {
        const name = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
        if (entry.isDirectory() && entry.name !== ".git" && entry.name !== "node_modules") visit(name);
        if (!entry.isFile() || (!/\.(prg|rnc)$/i.test(entry.name) && !isLintHookAssetPath(name))) continue;
        const key = assetKey(name);
        paths.push(name);
        if (!bytes.has(key)) {
          try {
            bytes.set(key, readFileSync(join(root, name)));
          } catch {
            complete = false;
          }
        }
      }
    } catch {
      complete = false;
    }
  }
  visit("");
  const index = createAssetIndex(paths);
  const dialect = projectScriptDialect(main.value);
  const loader: ProgramLoader = { index, root: lintProjectRoot(main.value, index), dialect, read: (key) => bytes.get(key) };
  return { ok: true as const, root, dialect, indexed: indexLintProject(main.value, loader, [], complete) };
}
