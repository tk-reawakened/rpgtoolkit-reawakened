import { isMap, isScalar, isSeq, parseDocument, type Scalar } from "yaml";

/** Declared document references in the terrain cutover; scalar nodes retain their source ranges. */
export type TerrainArtReference =
  | { readonly kind: "tile"; readonly path: Scalar<string> }
  | { readonly kind: "tileset"; readonly path: Scalar<string>; readonly localId: string; readonly localIdScalar: Scalar<string> };

export type TerrainArtReferences = { readonly references: TerrainArtReference[]; readonly problems: string[] };

const textScalar = (node: unknown): node is Scalar<string> =>
  isScalar(node) && typeof node.value === "string" && node.value.trim() !== "" && node.range !== undefined;

/** Scene reference locations from docs/spec/formats/native-scene.md#resolving-painted-terrain. */
export function sceneTerrainArtReferences(text: string): TerrainArtReferences {
  const document = parseDocument(text, { version: "1.2", schema: "core" });
  if (document.errors.length) return { references: [], problems: ["invalid YAML document"] };
  const root = document.contents;
  const contract = isMap(root) && isScalar(root.get("contract", true)) ? String(root.get("contract", true)?.value) : null;
  if (!isMap(root) || contract !== "scene") return { references: [], problems: [] };
  const references: TerrainArtReference[] = [];
  const problems: string[] = [];
  const tile = (node: unknown, where: string, empty: boolean): void => {
    if (!isMap(node)) { problems.push(`${where}: expected tile reference mapping`); return; }
    if (node.has("tile")) {
      const path = node.get("tile", true);
      if (node.has("legacy") || !textScalar(path)) problems.push(`${where}: expected a tile path without legacy`);
      else references.push({ kind: "tile", path });
    } else if (node.has("legacy")) {
      if (!textScalar(node.get("legacy", true))) problems.push(`${where}: expected legacy tile reference`);
    } else if (!empty || node.items.length !== 0) problems.push(`${where}: expected tile reference`);
  };
  const list = (node: unknown, where: string, visit: (item: unknown, where: string) => void): void => {
    if (node === undefined) return;
    if (!isSeq(node)) { problems.push(`${where}: expected sequence`); return; }
    node.items.forEach((item, index) => visit(item, `${where}[${index}]`));
  };
  list(root.get("tilePalette", true), "tilePalette", (item, where) => tile(item, where, true));
  list(root.get("floors", true), "floors", (floor, where) => {
    if (!isMap(floor)) { problems.push(`${where}: expected mapping`); return; }
    const boundary = floor.get("boundarySources", true);
    if (boundary === undefined) return;
    if (!isMap(boundary)) { problems.push(`${where}.boundarySources: expected mapping`); return; }
    list(boundary.get("walkableTiles", true), `${where}.boundarySources.walkableTiles`, (item, at) => tile(item, at, false));
  });
  list(root.get("tileOverrides", true), "tileOverrides", (entry, where) => {
    if (!isMap(entry)) { problems.push(`${where}: expected mapping`); return; }
    tile(entry.get("tile", true), `${where}.tile`, true);
  });
  list(root.get("terrainRegions", true), "terrainRegions", (entry, where) => {
    if (!isMap(entry)) { problems.push(`${where}: expected mapping`); return; }
    const terrain = entry.get("terrain", true);
    if (!isMap(terrain)) { problems.push(`${where}.terrain: expected terrain reference mapping`); return; }
    const path = terrain.get("tileset", true);
    const localId = terrain.get("terrain", true);
    if (!textScalar(path) || !textScalar(localId)) problems.push(`${where}.terrain: expected tileset path and terrain local ID`);
    else references.push({ kind: "tileset", path, localId: localId.value, localIdScalar: localId });
  });
  return { references, problems };
}

/** Tileset reference locations from docs/spec/formats/native-tileset.md#terrain-cutover. */
export function tilesetTerrainArtReferences(text: string): TerrainArtReferences {
  const document = parseDocument(text, { version: "1.2", schema: "core" });
  if (document.errors.length) return { references: [], problems: ["invalid YAML document"] };
  const root = document.contents;
  const contract = isMap(root) && isScalar(root.get("contract", true)) ? String(root.get("contract", true)?.value) : null;
  if (!isMap(root) || contract !== "tileset") return { references: [], problems: [] };
  const references: TerrainArtReference[] = [];
  const problems: string[] = [];
  const tile = (node: unknown, where: string): void => {
    if (!isMap(node) || !textScalar(node.get("tile", true))) { problems.push(`${where}: expected tile path`); return; }
    references.push({ kind: "tile", path: node.get("tile", true) as Scalar<string> });
  };
  const list = (node: unknown, where: string, visit: (item: unknown, where: string) => void, required = false): void => {
    if (node === undefined && !required) return;
    if (!isSeq(node)) { problems.push(`${where}: expected sequence`); return; }
    node.items.forEach((item, index) => visit(item, `${where}[${index}]`));
  };
  list(root.get("tiles", true), "tiles", tile, true);
  list(root.get("terrains", true), "terrains", (terrain, where) => {
    if (!isMap(terrain)) { problems.push(`${where}: expected mapping`); return; }
    list(terrain.get("rules", true), `${where}.rules`, (rule, at) => {
      if (!isMap(rule)) { problems.push(`${at}: expected mapping`); return; }
      if (rule.has("use")) tile(rule.get("use", true), `${at}.use`);
      if (rule.has("variants")) list(rule.get("variants", true), `${at}.variants`, tile, true);
      if (rule.has("use") === rule.has("variants")) problems.push(`${at}: expected exactly one of use or variants`);
    }, true);
  });
  const binding = root.get("outputBinding", true);
  if (!isMap(binding)) problems.push("outputBinding: expected mapping");
  else list(binding.get("slots", true), "outputBinding.slots", (slot, where) => {
    if (!isMap(slot)) { problems.push(`${where}: expected mapping`); return; }
    if (slot.has("reserved")) {
      if (slot.has("tile") || !isScalar(slot.get("reserved", true)) || slot.get("reserved", true)?.value !== true) problems.push(`${where}: invalid reserved slot`);
    } else tile(slot, where);
  }, true);
  return { references, problems };
}
