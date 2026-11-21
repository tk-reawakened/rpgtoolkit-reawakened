import { err, ok, utf8Decode, utf8Encode, type Result } from "@tk-reawakened/core";
import { formatSceneProblems, readScene, setSceneTerrain, type Scene } from "@tk-reawakened/native-data";
import { createBinaryDocument, openBinaryDocument, type DocumentCodec, type DocumentSnapshot, type DocumentStorage, type EditorDocument } from "./binary-document.ts";
import type { DocumentIdentity } from "./identity.ts";

export type TerrainSceneCommand = { readonly type: "edit-scene-terrain"; readonly terrain: Pick<Scene, "terrainRegions" | "tileOverrides"> };
type TerrainFields = { readonly text: string; readonly scene: Scene };
export type TerrainSceneDocument = EditorDocument<DocumentSnapshot<TerrainSceneCommand> & TerrainFields, TerrainSceneCommand>;
const section = "docs/spec/formats/native-scene.md#resolving-painted-terrain";
function decode(bytes: Uint8Array): Result<TerrainFields> {
  try {
    const text = utf8Decode(bytes);
    const read = readScene(text);
    return read.ok ? ok({ scene: read.scene, text }) : err({ offset: 0, section, message: formatSceneProblems(read.problems) });
  } catch (error) {
    return err({ offset: 0, section, message: String(error) });
  }
}

export const terrainSceneCodec: DocumentCodec<TerrainFields, TerrainSceneCommand, TerrainFields> = {
  kind: "terrain-scene",
  read: decode,
  write: (model) => ok(utf8Encode(model.text)),
  readOnlyReason: () => null,
  isCommand: (value): value is TerrainSceneCommand => typeof value === "object" && value !== null && "type" in value && value.type === "edit-scene-terrain" && "terrain" in value && typeof value.terrain === "object" && value.terrain !== null,
  apply(model, command) {
    const result = setSceneTerrain(model.text, command.terrain);
    if (!result.ok) return model;
    const read = readScene(result.text);
    return read.ok ? { scene: read.scene, text: result.text } : model;
  },
  refuse(next, _command, previous) {
    return next === previous ? { reason: "invalid", message: "Terrain edit could not be applied without changing unsupported source text, or changed nothing." } : null;
  },
  label: () => "Edit scene terrain",
  summary: ({ scene }) => `Terrain scene: ${scene.size.width} × ${scene.size.height}`,
  fields: (model) => model,
};

export function openTerrainSceneDocument(storage: DocumentStorage, identity: DocumentIdentity) {
  return openBinaryDocument(terrainSceneCodec, storage, identity);
}
export function createTerrainSceneDocument(storage: DocumentStorage, identity: DocumentIdentity, bytes: Uint8Array) {
  return createBinaryDocument(terrainSceneCodec, storage, identity, bytes);
}
