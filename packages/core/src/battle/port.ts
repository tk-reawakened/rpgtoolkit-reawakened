import { actorId, type ActorId, type ActorsSection } from "../actors/model.ts";
import { isBattleFighterUsable, type BattleFighter, type BattleParty, type BattleSection, type BattleState } from "./model.ts";

export type BattleErrorCode =
  | "battle.bad-fighter"
  | "battle.empty-party"
  | "battle.bad-outcome"
  | "battle.already-finished"
  | "battle.cannot-run"
  | "battle.not-active"
  | "builtin.bad-arg";

export type BattleOperationError = { readonly code: BattleErrorCode; readonly message: string };
export type BattleOperationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: BattleOperationError };

/** Plain-data actions accepted by the battle-section owner (docs/spec/engine/battle.md#bat-3). */
export type BattleAction =
  | { readonly type: "addCharge"; readonly party: number; readonly index: number; readonly amount: number }
  | { readonly type: "setCharge"; readonly party: number; readonly index: number; readonly charge: number }
  | { readonly type: "releaseCharge"; readonly party: number; readonly index: number }
  | { readonly type: "finish"; readonly code: number };

/** Ordered actor references and encounter metadata for BAT-9 setup. */
export type BattleStartInput = {
  readonly boardKey: string;
  readonly background: string;
  readonly canRun: boolean;
  readonly enemies: readonly (ActorId | number)[];
  readonly players: readonly (ActorId | number)[];
};
/** Owner boundary over the one saved battle section; callers never mutate it directly. */
export type BattleOwner = {
  start(input: BattleStartInput): BattleOperationResult<BattleState>;
  partySize(party: number): BattleOperationResult<number>;
  fighter(party: number, index: number): BattleOperationResult<BattleFighter>;
  charge(party: number, index: number): BattleOperationResult<number>;
  chargePercent(party: number, index: number): BattleOperationResult<number>;
  canRun(): BattleOperationResult<boolean>;
  background(): BattleOperationResult<string>;
  outcome(): BattleOperationResult<BattleState["outcome"]>;
  /** Resolve an automatic outcome after the stock pass has applied its loss/run/win precedence. */
  decideOutcome(code: number): BattleOperationResult<null>;
  /** End a lost battle before a game-over program runs. */
  endLoss(): BattleOperationResult<null>;
  apply(action: BattleAction): BattleOperationResult<null>;
};

export type BattleOwnerStore = {
  readonly readBattle: () => BattleSection;
  readonly readActors: () => ActorsSection;
  readonly commit: (battle: BattleSection) => void;
  /** The run's next battle number (`engine.nextBattleId`); survives loss cleanup (BAT-2 "battle numbers"). */
  readonly readBattleCounter: () => number | undefined;
  readonly commitBattleCounter: (next: number) => void;
};

const PARTY_THRESHOLDS: Readonly<Record<BattleParty, number>> = { 0: 123, 1: 75 };

function success<T>(value: T): BattleOperationResult<T> {
  return { ok: true, value };
}

function failure<T = never>(code: BattleErrorCode, message: string): BattleOperationResult<T> {
  return { ok: false, error: { code, message } };
}

function display(value: unknown): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : "unknown";
}

function badFighter(party: unknown, index: unknown, reason: string): BattleOperationResult<never> {
  return failure("battle.bad-fighter", `${reason} (party=${display(party)}, index=${display(index)})`);
}

/** Create the section owner used by the battle host object and its package commands. */
export function createBattleOwner(store: BattleOwnerStore): BattleOwner {
  const active = (): BattleOperationResult<BattleState> => {
    const battle = store.readBattle();
    return battle === null
      ? failure("battle.not-active", "there is no active battle")
      : success(battle);
  };

  const resolve = (partyValue: number, indexValue: number): BattleOperationResult<BattleFighter> => {
    if (partyValue !== 0 && partyValue !== 1) return badFighter(partyValue, indexValue, "party must be 0 or 1");
    if (!Number.isSafeInteger(indexValue) || indexValue < 0) return badFighter(partyValue, indexValue, "fighter index must be a non-negative safe integer");
    const current = active();
    if (!current.ok) return current;
    const party = partyValue as BattleParty;
    const fighter = current.value.parties[party][indexValue];
    if (fighter === undefined || fighter.party !== party || !isBattleFighterUsable(current.value, party, indexValue, store.readActors())) {
      return badFighter(partyValue, indexValue, "no usable fighter exists at this position");
    }
    return success(fighter);
  };

  return {
    start(input) {
      if (input.players.length === 0) return failure("battle.empty-party", "cannot start a battle with an empty party");
      if (input.enemies.length === 0) return failure("battle.bad-fighter", "cannot start a battle without enemies");
      if (typeof input.boardKey !== "string" || input.boardKey === "" || typeof input.background !== "string" || typeof input.canRun !== "boolean") {
        return failure("builtin.bad-arg", "battle start requires a board key, background and canRun flag");
      }
      const actors = store.readActors().actors;
      const party = (ids: readonly (ActorId | number)[], number: BattleParty, kind: "enemy" | "party"): BattleOperationResult<BattleFighter[]> => {
        const fighters: BattleFighter[] = [];
        for (let index = 0; index < ids.length; index += 1) {
          const id = ids[index];
          if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1) {
            return badFighter(number, index, "actor id must be a positive safe integer");
          }
          const record = actors.find((candidate) => candidate.id === id && candidate.kind === kind);
          if (record === undefined || fighters.some((fighter) => fighter.actorId === id)) {
            return badFighter(number, index, `no unique ${kind} actor exists at this position`);
          }
          fighters.push({ party: number, actorId: actorId(id), charge: 0 });
        }
        return success(fighters);
      };
      const enemies = party(input.enemies, 0, "enemy");
      if (!enemies.ok) return enemies;
      const players = party(input.players, 1, "party");
      if (!players.ok) return players;
      const id = Math.max(store.readBattleCounter() ?? 1, (store.readBattle()?.id ?? 0) + 1);
      if (!Number.isSafeInteger(id) || !Number.isSafeInteger(id + 1)) {
        return failure("builtin.bad-arg", "battle id counter exceeds the safe-integer range");
      }
      const battle: BattleState = {
        id,
        boardKey: input.boardKey,
        background: input.background,
        canRun: input.canRun,
        outcome: null,
        parties: [enemies.value, players.value],
      };
      store.commitBattleCounter(id + 1);
      store.commit(battle);
      return success(battle);
    },
    partySize(partyValue) {
      if (partyValue !== 0 && partyValue !== 1) return badFighter(partyValue, "n/a", "party must be 0 or 1");
      const current = active();
      return current.ok ? success(current.value.parties[partyValue as BattleParty].length) : current;
    },
    fighter(party, index) {
      return resolve(party, index);
    },
    charge(party, index) {
      const fighter = resolve(party, index);
      return fighter.ok ? success(fighter.value.charge) : fighter;
    },
    chargePercent(party, index) {
      const fighter = resolve(party, index);
      if (!fighter.ok) return fighter;
      const threshold = PARTY_THRESHOLDS[fighter.value.party];
      return success(Math.min(100, Math.max(0, Math.floor(fighter.value.charge * 100 / threshold))));
    },
    canRun() {
      const current = active();
      return current.ok ? success(current.value.canRun) : current;
    },
    background() {
      const current = active();
      return current.ok ? success(current.value.background) : current;
    },
    outcome() {
      const current = active();
      return current.ok ? success(current.value.outcome) : current;
    },
    decideOutcome(code) {
      const current = active();
      if (!current.ok) return current;
      if (!Number.isSafeInteger(code) || (code !== 0 && code !== 2 && code !== 4)) {
        return failure("battle.bad-outcome", `automatic battle outcome must be 0, 2 or 4: ${display(code)}`);
      }
      if (code === 0 && !current.value.canRun) return failure("battle.cannot-run", "the active battle does not allow running");
      store.commit({ ...current.value, outcome: code });
      return success(null);
    },
    endLoss() {
      const current = active();
      if (!current.ok) return current;
      if (current.value.outcome !== 4) return failure("battle.bad-outcome", "only a lost battle can end before game over");
      store.commit(null);
      return success(null);
    },
    apply(action) {
      if (action.type === "finish") {
        const current = active();
        if (!current.ok) return current;
        if (current.value.outcome !== null) return failure("battle.already-finished", "the active battle already has an outcome");
        if (!Number.isSafeInteger(action.code) || action.code < 0 || action.code > 4) {
          return failure("battle.bad-outcome", `battle outcome must be an integer from 0 through 4: ${display(action.code)}`);
        }
        if (action.code === 0 && !current.value.canRun) return failure("battle.cannot-run", "the active battle does not allow running");
        store.commit({ ...current.value, outcome: action.code as BattleState["outcome"] });
        return success(null);
      }

      const resolved = resolve(action.party, action.index);
      if (!resolved.ok) return resolved;
      let charge: number;
      switch (action.type) {
        case "addCharge":
          if (!Number.isFinite(action.amount)) return failure("builtin.bad-arg", "battle.addCharge requires a finite amount");
          charge = resolved.value.charge + action.amount;
          break;
        case "setCharge":
          if (!Number.isFinite(action.charge)) return failure("builtin.bad-arg", "battle.setCharge requires a finite charge");
          charge = action.charge;
          break;
        case "releaseCharge":
          charge = 0;
          break;
      }
      if (!Number.isFinite(charge)) return failure("builtin.bad-arg", "battle charge must remain finite");
      const current = store.readBattle();
      if (current === null) return failure("battle.not-active", "there is no active battle");
      const party = action.party as BattleParty;
      const entries = current.parties[party].slice();
      entries[action.index] = { ...resolved.value, charge };
      const parties: BattleState["parties"] = party === 0
        ? [entries, current.parties[1]]
        : [current.parties[0], entries];
      store.commit({ ...current, parties });
      return success(null);
    },
  };
}
