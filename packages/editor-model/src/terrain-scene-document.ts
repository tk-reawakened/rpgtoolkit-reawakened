import { err, ok, utf8Decode, utf8Encode, type Result } from "@tk-reawakened/core";
import { formatSceneProblems, readScene, setScenePackPlacements, setSceneTerrain, type Scene, type SceneEditResult, type ScenePlacedPack } from "@tk-reawakened/native-data";
import { createBinaryDocument, openBinaryDocument, type DocumentCodec, type DocumentSnapshot, type DocumentStorage, type EditorDocument } from "./binary-document.ts";
import type { DocumentIdentity } from "./identity.ts";

/** The authored fields the native scene view owns; everything else in the file is carried as written. */
export type TerrainSceneEdit = Pick<Scene, "terrainRegions" | "tileOverrides">;

export type TerrainSceneCommand = {
  readonly type: "edit-scene-terrain";
  readonly terrain: TerrainSceneEdit;
  /** The whole `placedPacks` list; absent when the host has no pack placements to write. */
  readonly placements?: readonly ScenePlacedPack[];
};
type TerrainFields = { readonly text: string; readonly scene: Scene };
export type TerrainSceneDocument = EditorDocument<DocumentSnapshot<TerrainSceneCommand> & TerrainFields, TerrainSceneCommand>;
const section = "docs/spec/formats/native-scene.md#resolving-painted-terrain";

/** The text after one view edit: terrain first, then the placement list, each a splice on the last result. */
export function applyTerrainSceneEdit(text: string, command: Pick<TerrainSceneCommand, "terrain" | "placements">): SceneEditResult {
  const terrain = setSceneTerrain(text, command.terrain);
  if (!terrain.ok || command.placements === undefined) return terrain;
  return setScenePackPlacements(terrain.text, command.placements);
}

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
  isCommand: (value): value is TerrainSceneCommand => typeof value === "object" && value !== null && "type" in value && value.type === "edit-scene-terrain"
    && "terrain" in value && typeof value.terrain === "object" && value.terrain !== null
    && (!("placements" in value) || (Array.isArray(value.placements) && value.placements.every((entry) => typeof entry === "object" && entry !== null))),
  apply(model, command) {
    const result = applyTerrainSceneEdit(model.text, command);
    if (!result.ok || result.text === model.text) return model;
    const read = readScene(result.text);
    return read.ok ? { scene: read.scene, text: result.text } : model;
  },
  refuse(next, _command, previous) {
    return next === previous ? { reason: "invalid", message: "Scene edit could not be applied without changing unsupported source text, or changed nothing." } : null;
  },
  label: () => "Edit scene",
  summary: ({ scene }) => `Terrain scene: ${scene.size.width} × ${scene.size.height}`,
  fields: (model) => model,
};

export function openTerrainSceneDocument(storage: DocumentStorage, identity: DocumentIdentity) {
  return openBinaryDocument(terrainSceneCodec, storage, identity);
}
export function createTerrainSceneDocument(storage: DocumentStorage, identity: DocumentIdentity, bytes: Uint8Array) {
  return createBinaryDocument(terrainSceneCodec, storage, identity, bytes);
}
