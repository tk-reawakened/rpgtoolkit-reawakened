/**
 * Test support for the running-project contract
 * (docs/spec/engine/rpgcode-tooling.md#tool-1-project): main files of a chosen
 * version and the `rpgcode/project` snapshots a client sends, built either in
 * memory or from a folder on disk the way the extension builds them.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { newProjectMainFile, utf8Encode, writeMainFile } from "@tk-reawakened/core";
import { encodeBase64, isProgramPath, projectRootUri, type ProjectSnapshot } from "../src/protocol.ts";

/**
 * A main file that selects `dialect`: a 3.1 binary main file (minor 9), or a
 * Toolkit 2.2 main file in the line-oriented text form the 2.x editor wrote.
 */
export function mainFileBytes(dialect: "tk2" | "tk3", projectPath = ""): Uint8Array {
  if (dialect === "tk3") {
    const written = writeMainFile({ ...newProjectMainFile(), projectPath });
    if (!written.ok) throw new Error(written.error.message);
    return written.value;
  }
  const lines = ["RPGTLKIT MAIN", "2", "2", "0", "start.prg", "", "1", "0", "0", "0", "start.brd", "hero.tem", "0", "0", "0"];
  for (let k = 0; k < 501; k += 1) lines.push("", "0");
  lines.push("0", "0", "0", "", "", "Tiny", "2", "", "", projectPath, "", "", "");
  for (let k = 0; k < 51; k += 1) lines.push("0", "");
  lines.push("");
  return utf8Encode(lines.join("\r\n") + "\r\n");
}

export type MemoryProject = {
  readonly rootUri: string;
  readonly mainUri: string;
  /** The URI of a root-relative path, spelled as the client spells it. */
  uri(path: string): string;
  snapshot(revision?: number): ProjectSnapshot;
};

/**
 * A project held in memory under `rootUri`: `files` maps root-relative paths
 * (original spelling) to their text; `main` is the main file's path.
 */
export function memoryProject(
  files: Readonly<Record<string, string | Uint8Array>>,
  main: string,
  options: { readonly rootUri?: string; readonly lintConfig?: string } = {},
): MemoryProject {
  const rootUri = options.rootUri ?? "file:///game/";
  const uri = (path: string): string => rootUri + path.split("/").map(encodeURIComponent).join("/");
  const mainUri = uri(main);
  if (projectRootUri(mainUri) !== rootUri) throw new Error(`${main} is not a main file at the root ${rootUri}`);
  const bytesOf = (value: string | Uint8Array): Uint8Array => (typeof value === "string" ? utf8Encode(value) : value);
  return {
    rootUri,
    mainUri,
    uri,
    snapshot: (revision = 1) => ({
      revision,
      main: { uri: mainUri, bytes: encodeBase64(bytesOf(files[main]!)) },
      rootUri,
      files: Object.entries(files)
        .filter(([path]) => isProgramPath(path))
        .map(([path, value]) => ({ path, uri: uri(path), bytes: encodeBase64(bytesOf(value)) })),
      lintConfig: options.lintConfig === undefined ? null : { uri: uri("tkr-lint.json"), text: options.lintConfig },
    }),
  };
}

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return walk(path);
      return entry.isFile() ? [path] : [];
    });
}

/** The snapshot a client sends for the `.gam` at `mainPath` (absolute), read from disk. */
export function folderSnapshot(mainPath: string, revision = 1): ProjectSnapshot {
  const mainUri = pathToFileURL(mainPath).href;
  const rootUri = projectRootUri(mainUri);
  const rootPath = new URL(rootUri);
  const rootDirectory = decodeURIComponent(rootPath.pathname);
  const files = walk(rootDirectory)
    .map((path) => ({ path: relative(rootDirectory, path).split(sep).join("/"), absolute: path }))
    .filter((file) => isProgramPath(file.path));
  let lintConfig: ProjectSnapshot["lintConfig"] = null;
  try {
    lintConfig = { uri: new URL("tkr-lint.json", rootUri).href, text: readFileSync(join(rootDirectory, "tkr-lint.json"), "utf8") };
  } catch {
    lintConfig = null;
  }
  return {
    revision,
    main: { uri: mainUri, bytes: encodeBase64(readFileSync(mainPath)) },
    rootUri,
    files: files.map((file) => ({ path: file.path, uri: pathToFileURL(file.absolute).href, bytes: encodeBase64(readFileSync(file.absolute)) })),
    lintConfig,
  };
}
