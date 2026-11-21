import { isMap, isScalar, isSeq, parseDocument, type Scalar } from "yaml";

/** A pack placement's document reference and local asset id, with the source range of both. */
export type PackReference = {
  readonly kind: "pack";
  readonly path: Scalar<string>;
  readonly localId: string;
  readonly localIdScalar: Scalar<string>;
};

/** Pack references from docs/spec/formats/native-scene.md#pack-placements, excluding plugin data. */
export function scenePackReferences(text: string): { references: PackReference[]; problems: string[] } {
  const document = parseDocument(text, { version: "1.2", schema: "core", uniqueKeys: false });
  if (document.errors.length) return { references: [], problems: [] };
  const root = document.contents;
  if (!isMap(root)) return { references: [], problems: [] };
  const contract = root.get("contract", true);
  if (!isScalar(contract) || String(contract.value) !== "scene") return { references: [], problems: [] };
  const references: PackReference[] = [];
  const problems: string[] = [];
  const placements = root.get("placedPacks", true);
  if (placements === undefined) return { references, problems };
  if (!isSeq(placements)) return { references, problems: ["placedPacks: expected sequence"] };
  placements.items.forEach((entry, index) => {
    if (!isMap(entry)) { problems.push(`placedPacks[${index}]: expected mapping`); return; }
    const path = entry.get("pack", true);
    const asset = entry.get("asset", true);
    if (!isScalar(path) || typeof path.value !== "string" || path.value.trim() === "" || path.range === undefined
      || !isScalar(asset) || typeof asset.value !== "string" || asset.value === "" || asset.range === undefined) {
      problems.push(`placedPacks[${index}]: expected pack path and asset local ID`);
      return;
    }
    references.push({ kind: "pack", path: path as Scalar<string>, localId: asset.value, localIdScalar: asset as Scalar<string> });
  });
  return { references, problems };
}
