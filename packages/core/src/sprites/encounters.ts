/** Movement-owned random encounters and the battle handoff seam (E-70, AD-12/AD-25/AD-26). */
import type { MainFileEnemy } from "../formats/main-file/model.ts";
import type { PostEffect } from "../engine/effects.ts";
import type { EnginePhaseRegistration } from "../engine/engine.ts";
import type { PlainData } from "../ports/plain-data.ts";
import { createRngPort } from "../rng/xoshiro.ts";
import type { GameState } from "../save/state.ts";
import { coordLayout, pixelToTile } from "../world/coords.ts";
import type { SpriteActor } from "./model.ts";

export type RandomEncounterConfig = {
  readonly fightingDisabled: number;
  readonly enemies: readonly MainFileEnemy[];
  readonly fightType: number;
  readonly chances: number;
  readonly useCustomFightPrg: number;
  readonly customFightPrg: string;
};

export type BattleActorContext = {
  id: string;
  kind: "player";
  index: number;
  source: string;
  x: number;
  y: number;
  layer: number;
};

export type BattleFighterReference = {
  party: "player" | "enemy";
  id: string;
  index: number;
  source: string;
  skill: number | null;
};

export type RandomBattleHandoff = {
  trigger: "random";
  board: { key: string; skill: number; background: string };
  actor: BattleActorContext;
  fighters: BattleFighterReference[];
};

export type RandomBattleCustomRequest = {
  trigger: "random";
  board: { key: string; skill: number; background: string };
  actor: BattleActorContext;
  program: string;
};

export type RandomBattleNoEnemies = {
  trigger: "random";
  board: { key: string; skill: number; background: string };
  actor: BattleActorContext;
  message: string;
};

export type RandomEncounterOptions = {
  readonly config: RandomEncounterConfig;
  readonly rank?: number;
};

type Post = (section: "battle", effect: PostEffect) => void;

function drawBelow(rng: { nextUint32(): number }, max: number): number {
  return max <= 0 ? 0 : rng.nextUint32() % max;
}

function actorContext(actor: SpriteActor): BattleActorContext {
  return { id: actor.id, kind: "player", index: actor.index, source: actor.source, x: actor.x, y: actor.y, layer: actor.layer };
}

function effect(name: string, payload: PlainData): PostEffect {
  return { thread: 0, name, kind: "request", args: [payload], out: {}, result: null, patch: null, wait: null, request: null };
}

/** Evaluate one battle phase after trigger activation. */
export function runRandomEncounterPhase(state: GameState, config: RandomEncounterConfig | null, post?: Post): void {
  const board = state.world.board ?? null;
  const actor = state.sprites.players.find((value) => value.id === state.sprites.selectedPlayer) ?? null;
  if (board === null || actor === null) return;
  const tile = pixelToTile(coordLayout(board.coordType), board.sizeX, actor.x, actor.y);
  if (config === null || config.fightingDisabled !== 0 || board.allowBattles === undefined || board.allowBattles === 0) return;
  const previous = state.sprites.randomEncounter;
  if (previous === null || previous === undefined || previous.boardKey !== board.key) {
    state.sprites.randomEncounter = { boardKey: board.key, tile, tiles: 0 };
    return;
  }
  if (previous.tile.x === tile.x && previous.tile.y === tile.y) return;
  const progress = { boardKey: board.key, tile, tiles: previous.tiles };
  state.sprites.randomEncounter = progress;
  const chances = Math.trunc(config.chances);
  const rng = createRngPort(state.rng);
  let fight = false;
  if (config.fightType === 0) {
    if (chances <= 0) return;
    fight = drawBelow(rng, chances) === 0;
  } else {
    progress.tiles += 1;
    if (chances <= 0 || progress.tiles < chances) return;
    progress.tiles = 0;
    fight = true;
  }
  if (!fight || post === undefined) return;
  const boardContext = { key: String(board.key), skill: board.battleSkill ?? 0, background: board.battleBackground ?? "" };
  const actorData = actorContext(actor);
  if (config.useCustomFightPrg !== 0 && config.customFightPrg !== "") {
    post("battle", effect("battle.customFight", { trigger: "random", board: boardContext, actor: actorData, program: config.customFightPrg } as RandomBattleCustomRequest));
    return;
  }
  const pool = config.enemies.filter((enemy) => enemy.skillLevel === boardContext.skill);
  if (pool.length === 0) {
    const message = `No enemies of skill level ${boardContext.skill} found.`;
    post("battle", effect("battle.noEnemies", { trigger: "random", board: boardContext, actor: actorData, message } as RandomBattleNoEnemies));
    return;
  }
  const count = 1 + drawBelow(rng, 4);
  const enemies: BattleFighterReference[] = [];
  for (let index = 0; index < count; index += 1) {
    const enemy = pool[drawBelow(rng, pool.length)]!;
    enemies.push({ party: "enemy", id: `enemy:${index}`, index, source: enemy.enemyFile, skill: enemy.skillLevel });
  }
  const handoff: RandomBattleHandoff = {
    trigger: "random",
    board: boardContext,
    actor: actorData,
    fighters: [{ party: "player", id: actor.id, index: actor.index, source: actor.source, skill: null }, ...enemies],
  };
  post("battle", effect("battle.randomEncounter", handoff));
}

/** Register the evaluator for scene-mode runners; boot mode supplies its config directly. */
export function randomEncounterPhaseRegistration(options: RandomEncounterOptions): EnginePhaseRegistration {
  return { phase: "triggers", rank: options.rank ?? 0, run: (state, post) => runRandomEncounterPhase(state, options.config, post) };
}
