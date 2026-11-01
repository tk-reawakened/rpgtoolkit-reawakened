/**
 * File helpers for the CLI: deterministic collection, Windows-1252 decoding and
 * re-encoding, and safe JSON/config reads.
 */

import { decodeCp1252, encodeCp1252, utf8Encode } from "@tk-reawakened/core";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

function compareNames(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function isSourceFile(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".prg") || lower.endsWith(".rnc");
}

export type SourceFile = {
  readonly path: string;
  /** Project-relative or argument-relative path, used for stable baselines. */
  readonly name: string;
  readonly source: string;
};

/**
 * Recursively collect `.prg` and `.rnc` files under a set of paths, ordered so
 * the same file tree always yields the same sequence.
 */
export function collectSourceFiles(paths: readonly string[], base?: string): SourceFile[] {
  const seen = new Set<string>();
  const result: SourceFile[] = [];
  const roots = paths.map((p) => resolve(p));
  const baseRoot = base === undefined ? (roots.length === 1 && statSync(roots[0]!).isDirectory() ? roots[0]! : process.cwd()) : resolve(base);

  const visit = (absolutePath: string): void => {
    const stat = statSync(absolutePath);
    if (stat.isDirectory()) {
      const entries = readdirSync(absolutePath).sort(compareNames);
      for (const entry of entries) {
        if (entry === "node_modules" || entry === ".git") continue;
        visit(join(absolutePath, entry));
      }
      return;
    }
    if (!stat.isFile() || !isSourceFile(absolutePath)) return;
    const real = absolutePath;
    if (seen.has(real)) return;
    seen.add(real);
    const bytes = readFileSync(real);
    const source = decodeCp1252(bytes, 0, bytes.length);
    const name = relative(baseRoot, real).split(sep).join("/");
    result.push({ path: real, name, source });
  };

  for (const root of roots) visit(root);
  return result.sort((left, right) => compareNames(left.name, right.name));
}

export function writeTextFile(path: string, text: string): void {
  const encoded = encodeCp1252(text);
  if (!encoded.ok) throw new Error(`cannot encode ${path} as Windows-1252: ${encoded.error.message}`);
  writeFileSync(path, encoded.value);
}

export function readJsonFile(path: string): unknown {
  const text = readFileSync(path, "utf8");
  return JSON.parse(text);
}

export function readProjectConfig(path: string): unknown | null {
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return null;
    return readJsonFile(path);
  } catch {
    return null;
  }
}

export function findUp(name: string, from: string): string | null {
  let current = resolve(from);
  const root = resolve("/");
  while (true) {
    const candidate = join(current, name);
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // continue searching upward
    }
    const parent = dirname(current);
    if (parent === current || current === root) break;
    current = parent;
  }
  return null;
}
