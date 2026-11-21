export {
  checkDocuments,
  documentId,
  isDocumentPath,
  REPORT_CLASSES,
  validateConfig,
  type CheckConfig,
  type CheckReport,
  type DuplicateIdReport,
  type ExtensionContractMismatchReport,
  type FoldCollisionReport,
  type NativeArtReport,
  type NativeSceneReport,
  type PluginBlockReport,
  type ReportClass,
} from "./check.ts";
export {
  readDocument,
  type DocumentInput,
  type FieldValue,
  type ReadDocument,
  type StampKey,
  type StampProblemKind,
  type StampReport,
} from "./document.ts";
export {
  validatePluginData,
  type PluginBlockProblem,
  type PluginBlockProblemKind,
} from "./plugin-data.ts";
export { foldId } from "./fold.ts";
export {
  classifyExtension,
  extensionOf,
  lookupExtension,
  REGISTRY,
  validateRegistry,
  type Registry,
  type RegistryEntry,
} from "./registry.ts";
export { formatReport } from "./report.ts";
export { parseVersion, type VersionParse } from "./version.ts";
export {
  checkClip,
  CLIP_CONTRACT,
  CLIP_VERSION,
  formatClipPath,
  formatClipProblems,
  readClip,
  removeClipProperty,
  setClipProperty,
  writeClip,
  type Clip,
  type ClipColour,
  type ClipEditResult,
  type ClipEditValue,
  type ClipFrame,
  type ClipJson,
  type ClipPath,
  type ClipProblem,
  type ClipReadResult,
  type ClipWriteResult,
} from "./clip.ts";
export {
  readTileset, writeTileset, checkTileset, setTilesetProperty,
  TILESET_CONTRACT, TILESET_VERSION,
  type Tileset, type TilesetProblem, type TilesetReadResult,
} from "./tileset.ts";
export {
  TILE_CONTRACT, TILE_VERSION, checkTile, readTile, writeTile,
  type NativeTile, type NativeTileSample, type TileProblem, type TileReadResult, type TileWriteResult,
} from "./tile.ts";
export type { SceneTerrainRegion, SceneTileOverride, SceneTerrainReference, SceneTerrainCellTile } from "./scene-terrain.ts";
export {
  readAssetPack, writeAssetPack, checkAssetPack, setAssetPackProperty,
  ASSET_PACK_CONTRACT, ASSET_PACK_VERSION,
  type AssetPack, type AssetPackProblem, type AssetPackReadResult,
} from "./asset-pack.ts";
export { checkProjectArtAssets } from "./project-art-assets.ts";
export {
  SCENE_CONTRACT, SCENE_VERSION,
  readScene, writeScene, checkScene, setSceneProperty, sceneFindings,
  sceneNativeReferences, sceneCellCount, formatScenePath, formatSceneProblems,
  type Scene, type SceneProblem, type SceneReadResult, type SceneWriteResult,
  type SceneEditResult, type SceneEditValue, type ScenePath,
} from "./scene.ts";
export {
  applyPlanToDocuments,
  planRename,
  validateRenameConfig,
  verifyPlan,
  type LineChange,
  type RefusalCode,
  type RenameConfig,
  type RenameEdit,
  type RenameMove,
  type RenamePair,
  type RenamePlan,
  type RenameRefusal,
  type RenameResult,
} from "./rename.ts";
export { applySplices, type Splice } from "./splice.ts";
