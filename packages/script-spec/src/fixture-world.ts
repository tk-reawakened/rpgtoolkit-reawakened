import { assetKey } from "@tk-reawakened/core";
import { sha256Hex } from "./sha256.ts";
import { FixtureError, type FixtureDefinition } from "./fixture.ts";

export type FixtureWorldInputFile = {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly revision?: string;
};

export type FixtureWorldFile = {
  /** The path the core sees in the frozen world (overlay prefix removed). */
  readonly path: string;
  readonly bytes: Uint8Array;
  /** The host path that supplied these bytes. */
  readonly sourcePath: string;
  /** Host-provided revision identity, or the SHA-256 of the exact bytes served. */
  readonly revision: string;
};

export type FixtureWorld = {
  /** Overlay files and explicitly named files only, in deterministic path order. */
  readonly files: readonly FixtureWorldFile[];
  /** Asset-key lookup shared by asset and program-loader requests. */
  readonly byKey: ReadonlyMap<string, FixtureWorldFile>;
};

const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const normalize = (path: string): string => path.replaceAll("\\", "/").replace(/^\.\//, "");

function inventoryPath(item: string): string {
  return `Item/${item.toLowerCase().endsWith(".itm") ? item : `${item}.itm`}`;
}

/**
 * Freeze exactly the fixture's visible files: the complete `.tkr-tests/` overlay plus explicitly named project files.
 * Overlay paths shadow ordinary project paths after stripping the reserved prefix. Callers use `byKey` for both the
 * engine asset port and the scene program loader, so those surfaces cannot observe different inventories.
 */
export function createFixtureWorld(files: readonly FixtureWorldInputFile[], fixture: FixtureDefinition): FixtureWorld {
  const overlays = new Map<string, FixtureWorldFile>();
  const project = new Map<string, FixtureWorldFile>();
  for (const file of [...files].sort((left, right) => compare(normalize(left.path), normalize(right.path)))) {
    const sourcePath = normalize(file.path);
    const segments = sourcePath.split("/");
    const overlay = segments[0]?.toLowerCase() === ".tkr-tests";
    const path = overlay ? segments.slice(1).join("/") : sourcePath;
    if (path === "") continue;
    const key = assetKey(path);
    const target = overlay ? overlays : project;
    if (!target.has(key)) target.set(key, { path, bytes: file.bytes, sourcePath, revision: file.revision ?? sha256Hex(file.bytes) });
  }

  const selected = new Map<string, FixtureWorldFile>(overlays);
  const named = [fixture.board, ...fixture.party, ...Object.keys(fixture.inventory).map(inventoryPath), ...fixture.files];
  for (const path of named) {
    const key = assetKey(path);
    if (selected.has(key)) continue;
    const file = project.get(key);
    if (file === undefined) throw new FixtureError("spec.fixture-load", `specFixture: named file "${path}" is missing from the fixture world`);
    selected.set(key, file);
  }

  const ordered = [...selected.values()].sort((left, right) => compare(left.path, right.path));
  return { files: ordered, byKey: new Map(ordered.map((file) => [assetKey(file.path), file])) };
}
