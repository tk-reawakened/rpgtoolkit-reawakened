/** Plain save data for the battle owner (docs/spec/engine/battle.md#bat-2). */
import { isRecord } from "../script/cells.ts";
import type { ActorId, ActorsSection } from "../actors/model.ts";

export const BATTLE_SCHEMA_VERSION = 2;

export type BattleParty = 0 | 1;
export type BattleFighter = { party: BattleParty; actorId: ActorId; charge: number };
export type BattleState = {
  id: number;
  boardKey: string;
  background: string;
  canRun: boolean;
  outcome: 0 | 1 | 2 | 3 | 4 | null;
  /** Unusable references are retained to preserve party indices; callers compute usability against actors. */
  parties: [BattleFighter[], BattleFighter[]];
};
export type BattleSection = BattleState | null;
export type BattleIssue = { path: string; message: string; recoverable?: boolean };

export function createBattleSection(): BattleSection { return null; }

/** A missing, wrong-kind or repeated actor makes a fighter unusable without altering saved data. */
export function isBattleFighterUsable(battle: BattleState, party: BattleParty, index: number, actors: ActorsSection): boolean {
  const fighter = battle.parties[party][index];
  if (!fighter) return false;
  const actor = actors.actors.find((candidate) => candidate.id === fighter.actorId);
  if (!actor || actor.kind !== (party === 0 ? "enemy" : "party")) return false;
  const partyEntries = battle.parties[party];
  for (let previous = 0; previous < index; previous += 1) {
    if (partyEntries[previous]?.actorId === fighter.actorId) return false;
  }
  return true;
}

/** Pure located diagnostics; malformed entries remain in their arrays for repair. */
export function validateBattleSection(value: unknown, actors: ActorsSection): BattleIssue[] {
  if (value === null) return [];
  const issues: BattleIssue[] = [];
  const issue = (path: string, message: string, recoverable = false) => { issues.push({ path, message, recoverable }); };
  if (!isRecord(value)) return [{ path: "battle", message: "must be an object or null" }];
  if (!Number.isSafeInteger(value.id)) issue("battle.id", "must be a safe integer");
  if (typeof value.boardKey !== "string") issue("battle.boardKey", "must be a string");
  if (typeof value.background !== "string") issue("battle.background", "must be a string");
  if (typeof value.canRun !== "boolean") issue("battle.canRun", "must be a boolean");
  if (value.outcome !== null && ![0, 1, 2, 3, 4].includes(value.outcome as number)) issue("battle.outcome", "must be 0 through 4 or null");
  if (!Array.isArray(value.parties) || value.parties.length !== 2) {
    issue("battle.parties", "must contain exactly two ordered arrays");
    return issues;
  }
  const seen = new Set<string>();
  value.parties.forEach((partyEntries, partyIndex) => {
    if (!Array.isArray(partyEntries)) { issue(`battle.parties[${partyIndex}]`, "must be an array"); return; }
    partyEntries.forEach((entry, index) => {
      const path = `battle.parties[${partyIndex}][${index}]`;
      if (!isRecord(entry)) { issue(path, "must be an object"); return; }
      if (entry.party !== partyIndex) issue(`${path}.party`, "must match its party array (0 or 1)");
      if (!Number.isSafeInteger(entry.actorId)) issue(`${path}.actorId`, "must be a safe integer");
      if (typeof entry.charge !== "number" || !Number.isFinite(entry.charge)) issue(`${path}.charge`, "must be a finite number");
      if (Number.isSafeInteger(entry.actorId)) {
        const key = `${partyIndex}:${entry.actorId}`;
        if (seen.has(key)) issue(`${path}.actorId`, "duplicates an actor reference in this party", true);
        else {
          seen.add(key);
          const actor = actors.actors.find((candidate) => candidate.id === entry.actorId);
          if (!actor) issue(`${path}.actorId`, "references a missing actor", true);
          else if (actor.kind !== (partyIndex === 0 ? "enemy" : "party")) {
            issue(`${path}.actorId`, "references an actor of the wrong kind for this party", true);
          }
        }
      }
    });
  });
  return issues;
}

