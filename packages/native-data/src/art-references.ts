import { isMap, isScalar, isSeq, parseDocument, type Scalar } from "yaml";

/** Native art references in the scene's declared reference locations, excluding plugin data. */
export type ArtReference = {
  readonly kind: "tileset" | "pack";
  readonly path: Scalar<string>;
  readonly localId: string;
};

export function sceneArtReferences(text: string): { references: ArtReference[]; problems: string[] } {
  const root = parseDocument(text, { version: "1.2", schema: "core" }).contents;
  if (!isMap(root)) return { references: [], problems: [] };
  const contract = root.get("contract", true);
  if (!isScalar(contract) || String(contract.value) !== "scene") return { references: [], problems: [] };
  const result: ArtReference[] = [];
  const problems: string[] = [];
  const add = (node: unknown, kind: "tileset" | "pack", idKey: "tile" | "asset"): void => {
    if (!isMap(node)) return;
    const path = node.get(kind, true);
    const localId = node.get(idKey, true);
    if (isScalar(path) && typeof path.value === "string" && isScalar(localId) && typeof localId.value === "string" && path.value !== "" && localId.value !== "") {
      result.push({ kind, path: path as Scalar<string>, localId: localId.value });
    } else if (kind === "pack" || node.has("tileset") || node.has("tile")) {
      problems.push(`expected ${kind} path and ${idKey} local ID`);
    }
  };
  const palette = root.get("tilePalette", true);
  if (isSeq(palette)) for (const entry of palette.items) add(entry, "tileset", "tile");
  const floors = root.get("floors", true);
  if (isSeq(floors)) for (const floor of floors.items) {
    if (!isMap(floor)) continue;
    const boundary = floor.get("boundarySources", true);
    if (!isMap(boundary)) continue;
    const tiles = boundary.get("walkableTiles", true);
    if (isSeq(tiles)) for (const entry of tiles.items) add(entry, "tileset", "tile");
  }
  const placements = root.get("placedPacks", true);
  if (isSeq(placements)) for (const entry of placements.items) add(entry, "pack", "asset");
  return { references: result, problems };
}
