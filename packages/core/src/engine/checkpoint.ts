import { canon, reviveNonFinite, tagNonFinite } from "../canon/index.ts";
import { materializePresentedSurfaces } from "../raster/surfaces.ts";
import type { AssertPlainData } from "../ports/plain-data.ts";
import { isRecord } from "../script/cells.ts";
import { ScriptError } from "../script/errors.ts";
import { restoreDecodedGameState, restoreSurfaceState } from "../save/snapshot.ts";
import type { GameState } from "../save/state.ts";
import type { SurfaceState } from "../save/sections/surfaces.ts";

/** Historical presentation data, not a cache reconstructed from the live canvas. */
export type ScenePresentation = {
  readonly holdProgramFrame: boolean;
  readonly endedProgramThisTick: boolean;
  readonly blockingWasAlive: boolean;
  readonly outermostProgramStartAnimationId: number;
  readonly bakedOverlay: Readonly<SurfaceState> | null;
};

type SceneCheckpoint = {
  readonly version: 1;
  readonly state: GameState;
  readonly presentation: ScenePresentation;
};

export type SceneCheckpointIsPlainData = AssertPlainData<SceneCheckpoint>;

export function snapshotSceneCheckpoint(state: GameState, presentation: ScenePresentation): string {
  materializePresentedSurfaces(state.surfaces);
  return canon(tagNonFinite({ version: 1, state, presentation }) as never);
}

function shape(path: string, message: string): never {
  throw new ScriptError("restore.shape", `the scene checkpoint's ${path} ${message}`);
}

function validatePresentation(value: unknown): asserts value is ScenePresentation {
  if (!isRecord(value)) shape("presentation", "must be an object");
  for (const key of ["holdProgramFrame", "endedProgramThisTick", "blockingWasAlive"] as const) {
    if (!Object.hasOwn(value, key) || typeof value[key] !== "boolean") shape(`presentation.${key}`, "must be a boolean");
  }
  const watermark = value.outermostProgramStartAnimationId;
  if (!Number.isSafeInteger(watermark) || (watermark as number) < 0) {
    shape("presentation.outermostProgramStartAnimationId", "must be a non-negative safe integer");
  }
  if (!Object.hasOwn(value, "bakedOverlay")) shape("presentation.bakedOverlay", "must be a bitmap snapshot or null");
  if (value.bakedOverlay !== null) {
    const overlay = restoreSurfaceState(value.bakedOverlay, "presentation.bakedOverlay");
    if (!Number.isSafeInteger(overlay.id) || overlay.id <= 0) shape("presentation.bakedOverlay.id", "must be a positive safe integer");
    if (!Number.isSafeInteger(overlay.rev) || overlay.rev < 0) shape("presentation.bakedOverlay.rev", "must be a non-negative safe integer");
  }
}

/** Decode once, then reuse the ordinary state's one validation/migration seam. */
export function restoreSceneCheckpoint(json: string): SceneCheckpoint {
  let parsed: unknown;
  try {
    parsed = reviveNonFinite(JSON.parse(json));
  } catch {
    shape("envelope", "must be valid JSON");
  }
  if (!isRecord(parsed)) shape("envelope", "must be an object");
  if (parsed.version !== 1) shape("version", "must be 1");
  const presentation = parsed.presentation;
  validatePresentation(presentation);
  const state = restoreDecodedGameState(parsed.state, [], { requireCurrentIr: true });
  return { version: 1, state, presentation };
}
