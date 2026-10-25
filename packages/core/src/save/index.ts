/**
 * The save tree, the RNG and time sections, and snapshots (AD-7, AD-10,
 * AD-11, AD-23).
 *
 * AD-10 (one state tree) and AD-11 (one canonical form); docs/spec/formats/save-game.md#layout-minor-4 (the
 * saved game).
 */

export { createGameState, createSchemaState, SCHEMA_VERSIONS } from "./state.ts";
export type { GameState, GameStateIsPlainData, SchemaState, SectionKey } from "./state.ts";
export { restoreGameState, snapshot } from "./snapshot.ts";
export { hashGameState } from "./hash.ts";
export {
  createFxSection,
  BATTLE_SCHEMA_VERSION,
  createBattleSection,
  validateBattleSection,
  isBattleFighterUsable,
  type BattleSection,
  type BattleFighter,
  type BattleIssue,
  type BattleParty,
  type BattleState,
  type CameraSection,
  type EngineSection,
  type FxSection,
  type InputSection,
  type InventorySection,
  type MenuSection,
  type PartySection,
  type SpritesSection,
  type RgbaSnapshot,
  type SurfaceState,
  type SurfacesSection,
  type TriggersSection,
  type UiSection,
  type WorldSection,
} from "./sections.ts";

export type { ActorsSection } from "../actors/model.ts";
