/**
 * The checker reports stamp, document identity, plugin-envelope and registered
 * extension problems without repairing documents.
 */

import { readDocument, type DocumentInput, type StampReport } from "./document.ts";
import { compareText, foldId } from "./fold.ts";
import { classifyExtension, extensionOf, lookupExtension, REGISTRY, validateRegistry, type Registry } from "./registry.ts";
import type { PluginBlockProblemKind } from "./plugin-data.ts";
import { readTileset, type TilesetReadResult } from "./tileset.ts";
import { readAssetPack, type AssetPackReadResult } from "./asset-pack.ts";
import { scenePackReferences } from "./art-references.ts";
import { readScene, type SceneReadResult } from "./scene.ts";
import { readTile } from "./tile.ts";
import { sceneTerrainArtReferences, tilesetTerrainArtReferences } from "./terrain-art-references.ts";

export type CheckConfig = {
  /** Extensions that mark a native document; absent means the shipped registry. */
  readonly documentExtensions?: readonly string[];
  /** The extension-to-contract table; absent means the shipped registry. */
  readonly registry?: Registry;
};

export type DuplicateIdReport = {
  readonly class: "duplicate-id";
  readonly id: string;
  readonly paths: readonly string[];
};

export type FoldCollisionReport = {
  readonly class: "fold-collision";
  readonly foldedId: string;
  readonly paths: readonly string[];
};

export type PluginBlockReport = {
  readonly class: "plugin-block";
  readonly path: string;
  readonly kind: PluginBlockProblemKind;
  readonly pluginId: string | null;
  readonly found: string;
  readonly reason: string;
  readonly line: number | null;
};

export type ExtensionContractMismatchReport = {
  readonly class: "extension-contract-mismatch";
  readonly path: string;
  readonly extension: string;
  readonly registered: string;
  readonly stamp: string;
};

/** A contract-specific field or local reference problem in an art document. */
export type NativeArtReport = {
  readonly class: "native-art";
  readonly path: string;
  readonly field: string;
  readonly message: string;
  readonly line: number | null;
};

/** A field or local reference problem in a native scene. */
export type NativeSceneReport = {
  readonly class: "native-scene";
  readonly path: string;
  readonly field: string;
  readonly message: string;
  readonly line: number | null;
};

export type CheckReport =
  | StampReport
  | DuplicateIdReport
  | FoldCollisionReport
  | PluginBlockReport
  | ExtensionContractMismatchReport
  | NativeArtReport
  | NativeSceneReport;

export type ReportClass = CheckReport["class"];

export const REPORT_CLASSES: readonly ReportClass[] = [
  "stamp",
  "duplicate-id",
  "fold-collision",
  "plugin-block",
  "extension-contract-mismatch",
  "native-art",
  "native-scene",
];

const RESERVED_KEYS: Readonly<Record<string, readonly string[]>> = {
  "animation-clip": ["canvas", "delay", "colourKey", "frames"],
  tile: ["name", "projection", "role", "visual", "solid", "under", "activationAreas", "kitbash"],
  tileset: ["name", "expects", "tiles", "terrains", "sources", "isoBlocks", "outputBinding"],
  "asset-pack": ["name", "projection", "grid", "sources", "assets"],
  scene: ["name", "projection", "pixelCoordinates", "size", "floors", "tilePalette", "terrainRegions", "tileOverrides", "shading", "lights", "vectors", "triggers", "items", "images", "placedPacks", "atmosphere", "start", "links", "enterProgram", "battle", "savingDisabled", "threads", "constants", "legacy"],
};

/**
 * The ID of a document: its path, extension included, with empty and `.` parts
 * dropped. Case is kept; comparison folds it with the ASCII-only fold.
 */
export function documentId(path: string): string {
  return path
    .split("/")
    .filter((part) => part !== "" && part !== ".")
    .join("/");
}

type Doc = {
  readonly input: DocumentInput;
  readonly path: string;
  readonly id: string;
};

/** Throws a RangeError naming the first unusable checker option. */
export function validateConfig(config: CheckConfig): void {
  if (config.documentExtensions !== undefined &&
      (config.documentExtensions.length === 0 || config.documentExtensions.some((extension) => extension === ""))) {
    throw new RangeError("at least one non-empty document extension is required");
  }
  if (config.registry !== undefined) validateRegistry(config.registry);
}

/** Whether a path names a native document under the supplied registry/configuration. */
export function isDocumentPath(path: string, config: Pick<CheckConfig, "documentExtensions" | "registry">): boolean {
  if (config.documentExtensions === undefined) return classifyExtension(extensionOf(path), config.registry ?? REGISTRY) === "native-registered";
  const folded = foldId(path);
  return config.documentExtensions.some((extension) => {
    const suffix = foldId(extension);
    return folded.endsWith(suffix) && path.length > suffix.length;
  });
}

function group<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [item]);
    else list.push(item);
  }
  return groups;
}

/** Check a folder's documents; reports are stable by class, then path. */
export function checkDocuments(inputs: readonly DocumentInput[], config: CheckConfig = {}): CheckReport[] {
  validateConfig(config);
  const registry = config.registry ?? REGISTRY;
  const docs: Doc[] = inputs
    .filter((input) => isDocumentPath(input.path, config))
    .sort((left, right) => compareText(left.path, right.path))
    .map((input) => ({ input, path: input.path, id: documentId(input.path) }));
  const reads = docs.map((doc) => {
    const extension = extensionOf(doc.path) ?? "";
    const contract = lookupExtension(extension, registry)?.contract;
    const reserved = [...(contract === undefined ? [] : RESERVED_KEYS[contract] ?? [])];
    const read = readDocument(doc.input, ["contract"], reserved);
    return { ...doc, read };
  });
  const reports: CheckReport[] = [];
  const sceneModels = new Map<string, SceneReadResult>();
  for (const doc of reads) {
    reports.push(...doc.read.stampReports);
    for (const problem of doc.read.pluginProblems) {
      reports.push({ class: "plugin-block", path: doc.path, ...problem });
    }
    if ("text" in doc.input) {
      const contract = lookupExtension(extensionOf(doc.path) ?? "", registry)?.contract;
      const result = contract === "tileset" ? readTileset(doc.input.text)
        : contract === "asset-pack" ? readAssetPack(doc.input.text)
        : contract === "tile" ? readTile(doc.input.text) : null;
      if (result !== null && !result.ok) {
        for (const problem of result.problems) {
          if (problem.kind === "shape") {
            reports.push({ class: "native-art", path: doc.path, field: problem.path, message: problem.message, line: problem.line });
          }
        }
      }
    }
    if ("text" in doc.input && lookupExtension(extensionOf(doc.path) ?? "", registry)?.contract === "scene") {
      const result = readScene(doc.input.text);
      sceneModels.set(doc.path, result);
      if (!result.ok) {
        for (const problem of result.problems) {
          if (problem.kind === "shape") {
            reports.push({ class: "native-scene", path: doc.path, field: problem.path, message: problem.message, line: problem.line });
          }
        }
      }
    }
  }

  // Scene references name a native document, and sometimes a local ID. Resolve both after all
  // documents are known, so a missing document and an ambiguous case-folded match differ.
  const artTargets = group(reads, (doc) => foldId(doc.id));
  const terrainModels = new Map<string, TilesetReadResult>();
  const packModels = new Map<string, AssetPackReadResult>();
  for (const doc of reads) {
    if (!("text" in doc.input)) continue;
    const terrainScan = sceneTerrainArtReferences(doc.input.text);
    const tilesetScan = tilesetTerrainArtReferences(doc.input.text);
    const packScan = scenePackReferences(doc.input.text);
    for (const message of [...terrainScan.problems, ...tilesetScan.problems, ...packScan.problems]) {
      reports.push({ class: "native-art", path: doc.path, field: "reference", message, line: null });
    }
    const references = [
      ...terrainScan.references.map((reference) => reference.kind === "tile"
        ? { kind: "tile" as const, written: reference.path.value, localId: null as string | null }
        : { kind: "terrain" as const, written: reference.path.value, localId: reference.localId }),
      ...tilesetScan.references.map((reference) => ({ kind: "tile" as const, written: reference.path.value, localId: null as string | null })),
      ...packScan.references.map((reference) => ({ kind: "asset" as const, written: reference.path.value, localId: reference.localId })),
    ];
    for (const reference of references) {
      const targets = artTargets.get(foldId(documentId(reference.written))) ?? [];
      if (targets.length > 1) {
        reports.push({
          class: "native-art", path: doc.path, field: reference.kind,
          message: `ambiguous ${reference.kind} ${reference.written}: ${targets.map((target) => target.path).join(", ")}`,
          line: null,
        });
        continue;
      }
      const target = targets[0];
      const expected = reference.kind === "tile" ? "tile" : reference.kind === "terrain" ? "tileset" : "asset-pack";
      const contract = target === undefined ? undefined : lookupExtension(extensionOf(target.path) ?? "", registry)?.contract;
      let exists = false;
      if (target !== undefined && contract === expected && "text" in target.input) {
        if (reference.kind === "terrain") {
          const result = terrainModels.get(target.path) ?? readTileset(target.input.text);
          terrainModels.set(target.path, result);
          exists = result.ok && result.tileset.terrains?.some((terrain) => terrain.id === reference.localId) === true;
        } else if (reference.kind === "asset") {
          const result = packModels.get(target.path) ?? readAssetPack(target.input.text);
          packModels.set(target.path, result);
          exists = result.ok && result.assetPack.assets.some((asset) => asset.id === reference.localId);
          const scene = sceneModels.get(doc.path);
          if (exists && result.ok && scene?.ok && result.assetPack.projection !== scene.scene.projection) {
            reports.push({ class: "native-scene", path: doc.path, field: "placedPacks", message: `pack ${reference.written} projection does not match the scene`, line: null });
          }
        } else {
          exists = true;
        }
      }
      if (!exists) {
        reports.push({
          class: "native-art", path: doc.path, field: reference.kind,
          message: reference.localId === null
            ? `cannot resolve ${reference.kind} ${reference.written}`
            : `cannot resolve ${reference.kind} ${reference.written} and local ID ${reference.localId}`,
          line: null,
        });
      }
    }
  }

  const byId = group(reads, (doc) => doc.id);
  for (const [id, same] of byId) {
    if (same.length > 1) reports.push({ class: "duplicate-id", id, paths: same.map((doc) => doc.path) });
  }
  const byFold = group(reads, (doc) => foldId(doc.id));
  for (const [foldedId, same] of byFold) {
    if (new Set(same.map((doc) => doc.id)).size > 1) {
      reports.push({ class: "fold-collision", foldedId, paths: same.map((doc) => doc.path) });
    }
  }

  for (const doc of reads) {
    const entry = lookupExtension(extensionOf(doc.path) ?? "", registry);
    const contractValues = doc.read.fields.get("contract");
    if (entry === undefined || contractValues === undefined || contractValues.length !== 1) continue;
    const stamped = contractValues[0]!;
    if (stamped.kind === "text" && stamped.value !== entry.contract) {
      reports.push({
        class: "extension-contract-mismatch",
        path: doc.path,
        extension: entry.extension,
        registered: entry.contract,
        stamp: stamped.value,
      });
    }
  }

  const rank = (report: CheckReport): number => REPORT_CLASSES.indexOf(report.class);
  const firstPath = (report: CheckReport): string => {
    switch (report.class) {
      case "stamp":
      case "plugin-block":
      case "extension-contract-mismatch":
      case "native-art":
      case "native-scene":
        return report.path;
      case "duplicate-id":
      case "fold-collision":
        return report.paths[0] ?? "";
    }
  };
  return reports.sort((left, right) => rank(left) - rank(right) || compareText(firstPath(left), firstPath(right)));
}
