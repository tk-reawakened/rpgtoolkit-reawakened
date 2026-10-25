import { BinaryReader } from "../../formats/binary/reader.ts";
import { readStatusEffect } from "../../formats/battle/status-effect.ts";
import { registerActorObject } from "../../actors/object.ts";
import type { ActorId, ActorStats } from "../../actors/model.ts";
import type { BattleAction, BattleOperationResult } from "../../battle/port.ts";
import type { Value } from "../../ports/value.ts";
import type { Arg, BuiltinDoc, BuiltinSpec, ParamSpec } from "../builtins.ts";
import { ScriptError } from "../errors.ts";
import type { CommandResult, CommandView, PluginDefinition } from "../plugin.ts";

const GROUP = "battle-stats-menus-33";
const NO_WAIT = { kind: "never", summary: "Completes in the current script turn." } as const;

type StatusOperation = "apply" | "remove";

function parameter(name: string, optional = false, byRef = false): ParamSpec {
  return { name, optional, byRef, variadic: false };
}

function numeric(args: readonly Arg[], index: number): number {
  const value = args[index]?.value;
  return typeof value === "number" ? value : Number.NaN;
}

function integer(args: readonly Arg[], index: number, name: string): number {
  const value = numeric(args, index);
  if (!Number.isSafeInteger(value)) throw new ScriptError("builtin.bad-arg", `${name}: argument ${index + 1} must be a safe integer`);
  return value;
}

function text(args: readonly Arg[], index: number): string {
  const value = args[index]?.value;
  return typeof value === "string" ? value : "";
}

function output(args: readonly Arg[], index: number, value: Value): CommandResult["out"] {
  return args[index] === undefined || args[index]?.ref === null ? [] : [[index, value]];
}

function documentation(summary: string, behaviour: string, throws: BuiltinDoc["throws"] = [{ code: "battle.bad-fighter", when: "the handle does not identify an actor" }]): BuiltinDoc {
  return { summary, behaviour, groups: [GROUP], tags: ["legacy"], waits: NO_WAIT, throws };
}

function owner(view: CommandView) {
  if (view.battle === undefined) throw new ScriptError("battle.not-active", "there is no active battle");
  return view.battle;
}

function resolve<T>(result: BattleOperationResult<T>): T {
  if (!result.ok) throw new ScriptError(result.error.code, result.error.message);
  return result.value;
}

function display(value: unknown): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : "unknown";
}

function badFighter(value: unknown): never {
  throw new ScriptError("battle.bad-fighter", `unknown fighter handle "${display(value)}" (party=unknown, index=unknown)`);
}

function folded(value: string): string {
  return value.replaceAll("\\", "/").trim().toLowerCase();
}

function actorRecord(view: CommandView, id: number) {
  return view.actors?.readActor(id) ?? null;
}

function partyActor(view: CommandView, value: string): ActorId | undefined {
  const state = view.state;
  if (state === undefined || view.actors === undefined) return undefined;
  const wanted = folded(value);
  for (const id of state.party.members) {
    const actor = actorRecord(view, id);
    if (actor !== null && (String(actor.id) === wanted || folded(actor.name) === wanted || folded(actor.source) === wanted)) return actor.id;
  }
  return undefined;
}

function anyActor(view: CommandView, value: string): ActorId | undefined {
  const state = view.state;
  if (state === undefined || view.actors === undefined) return undefined;
  const wanted = folded(value);
  const sprite = state.sprites.players.find((player) => folded(player.id) === wanted);
  if (sprite?.actorId !== null && sprite?.actorId !== undefined && actorRecord(view, sprite.actorId) !== null) return sprite.actorId;
  const actor = state.actors.actors.find((candidate) =>
    String(candidate.id) === wanted || folded(candidate.name) === wanted || folded(candidate.source) === wanted,
  );
  return actor?.id;
}

function actorIdForObject(view: CommandView, handle: number): ActorId | undefined {
  const state = view.state;
  if (state === undefined || view.actors === undefined) return undefined;
  const record = state.vm.objects.find((candidate) => candidate.handle === handle);
  if (record?.hostType !== "actor") return undefined;
  for (const [key, registeredHandle] of Object.entries(state.events.emitters ?? {})) {
    if (registeredHandle !== handle || !key.startsWith("actor:")) continue;
    const id = Number(key.slice("actor:".length));
    if (Number.isSafeInteger(id) && actorRecord(view, id) !== null) return id as ActorId;
  }
  return undefined;
}

function sourceOrTarget(view: CommandView, name: "source" | "target"): ActorId | undefined {
  const state = view.state;
  const thread = state?.vm.threads.find((candidate) => candidate.id === view.thread);
  const value = thread?.[name];
  if (value === null || value === undefined) return undefined;
  return anyActor(view, value) ?? partyActor(view, value);
}

function referenceActor(view: CommandView, value: Value | undefined): ActorId {
  const state = view.state;
  if (typeof value === "string") {
    const token = value.toLowerCase();
    if (token === "source" || token === "target") {
      const id = sourceOrTarget(view, token);
      return id === undefined ? badFighter(value) : id;
    }
    const id = partyActor(view, value);
    return id === undefined ? badFighter(value) : id;
  }
  if (typeof value === "object" && value !== null && "kind" in value && value.kind === "object") {
    const actorId = actorIdForObject(view, value.handle);
    if (actorId !== undefined) return actorId;
    const members = view.objectMembers?.(value.handle) ?? state?.vm.objects.find((record) => record.handle === value.handle)?.members;
    if (members !== undefined && (Object.hasOwn(members, "party") || Object.hasOwn(members, "index"))) {
      const party = typeof members.party === "number" ? members.party : Number.NaN;
      const index = typeof members.index === "number" ? members.index : Number.NaN;
      if (party !== 0) throw new ScriptError("battle.bad-fighter", `enemy references require party 0 (party=${display(members.party)}, index=${display(members.index)})`);
      return resolve(owner(view).fighter(party, index)).actorId;
    }
  }
  return badFighter(value);
}

function activeBattleActor(view: CommandView, value: Value | undefined): ActorId {
  const battle = owner(view);
  resolve(battle.partySize(0));
  const id = referenceActor(view, value);
  for (const party of [0, 1] as const) {
    const size = resolve(battle.partySize(party));
    for (let index = 0; index < size; index += 1) {
      const fighter = battle.fighter(party, index);
      if (fighter.ok && fighter.value.actorId === id) return id;
    }
  }
  throw new ScriptError("battle.bad-fighter", `actor ${id} is not an active fighter (party=unknown, index=unknown)`);
}

function statusPath(value: string): string {
  let path = value.trim().replaceAll("\\", "/").replace(/^StatusE\//i, "");
  if (!path.toLowerCase().endsWith(".ste")) path += ".ste";
  return path;
}

function statusSource(view: CommandView): ActorId | null {
  const state = view.state;
  const thread = state?.vm.threads.find((candidate) => candidate.id === view.thread);
  if (thread?.source === null || thread?.source === undefined) return null;
  return anyActor(view, thread.source) ?? partyActor(view, thread.source) ?? null;
}

function statusRequest(view: CommandView, args: readonly Arg[], operation: StatusOperation): CommandResult {
  const target = activeBattleActor(view, args[0]?.value);
  return {
    value: null,
    request: { kind: "asset", area: "statusEffects", path: statusPath(text(args, 1)) },
    then: { command: "__battle_status_asset", args: [operation, target, statusSource(view)] },
  };
}

function statusContinuation(view: CommandView, args: readonly Arg[]): CommandResult {
  if (numeric(args, 0) !== 1) throw new ScriptError("asset.missing", "status effect asset was not found");
  const hex = text(args, 1);
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) throw new ScriptError("request.bad-reply", "status effect asset reply must be hexadecimal bytes");
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  const status = readStatusEffect(new BinaryReader(bytes));
  if (!status.ok) throw new ScriptError("format.status-effect", status.error.message);
  const operation = text(args, 2);
  const actorId = integer(args, 3, "battle status operation");
  const sourceValue = args[4]?.value;
  const source = typeof sourceValue === "number" && Number.isSafeInteger(sourceValue) && sourceValue > 0 ? sourceValue as ActorId : null;
  const actors = view.actors;
  if (actors === undefined) throw new ScriptError("battle.bad-fighter", `unknown status target (party=unknown, index=unknown)`);
  const result = operation === "apply"
    ? actors.applyStatus(actorId, status.value.name, status.value.rounds, { source })
    : operation === "remove"
      ? actors.removeStatus(actorId, status.value.name, { source })
      : null;
  if (operation !== "apply" && operation !== "remove") throw new ScriptError("request.bad-reply", "unknown status operation");
  if (result === null) throw new ScriptError("battle.bad-fighter", `unknown status target (party=unknown, index=unknown)`);
  return { value: null };
}

function statCommand(
  name: string,
  summary: string,
  field: keyof ActorStats,
  mode: "set" | "add" | "get",
  amountName?: string,
): BuiltinSpec {
  const params = mode === "get"
    ? [parameter("handle"), parameter("ret", true, true)]
    : [parameter("handle"), parameter(mode === "set" ? "value" : amountName ?? "add")];
  const behaviour = mode === "get"
    ? `Reads the live actor-owned ${field === "maxHp" ? "maximum HP" : field === "maxSmp" ? "maximum SMP" : field} value and optionally writes it to the trailing by-reference result; no stat copy is made.`
    : mode === "set"
      ? `Sets the live actor-owned ${field === "maxHp" ? "maximum HP" : field === "maxSmp" ? "maximum SMP" : field} value through the actor service, which validates and commits the stat update.`
      : `Adds the requested amount to the live actor-owned ${field} value through the actor service; the safe-integer update is validated and committed atomically.`;
  return {
    name,
    aliases: [],
    params,
    doc: documentation(summary, behaviour),
    call: (view, args) => {
      const actorId = referenceActor(view, args[0]?.value);
      const actor = actorRecord(view, actorId);
      const actors = view.actors;
      if (actor === null || actors === undefined) return badFighter(args[0]?.value);
      if (mode === "get") {
        const value = actor.stats[field];
        const out = output(args, 1, value);
        return out === undefined ? { value } : { value, out };
      }
      const amount = integer(args, 1, name);
      if (mode === "set") {
        try {
          if (actors.updateStats(actorId, { [field]: amount } as Partial<ActorStats>, { cause: "script" }) === null) return badFighter(args[0]?.value);
        } catch (error) {
          if (error instanceof ScriptError) throw error;
          throw new ScriptError("builtin.bad-arg", `${name}: ${error instanceof Error ? error.message : "invalid stat value"}`);
        }
        return { value: null };
      }
      if (field === "hp" || field === "smp") {
        try {
          actors.damage(actorId, -amount, null, field === "smp" ? "smp" : "hp");
        } catch (error) {
          if (error instanceof ScriptError) throw error;
          throw new ScriptError("builtin.bad-arg", `${name}: ${error instanceof Error ? error.message : "invalid stat amount"}`);
        }
        return { value: null };
      }
      try {
        if (actors.updateStats(actorId, { [field]: actor.stats[field] + amount } as Partial<ActorStats>, { cause: "script" }) === null) return badFighter(args[0]?.value);
      } catch (error) {
        if (error instanceof ScriptError) throw error;
        throw new ScriptError("builtin.bad-arg", `${name}: ${error instanceof Error ? error.message : "invalid stat amount"}`);
      }
      return { value: null };
    },
  };
}

const PARTY_SIZE = {
  name: "__battle_party_size", aliases: [], params: [parameter("self"), parameter("party")],
  doc: { summary: "Read a battle party size.", behaviour: "Returns the number of fighter entries in the requested saved battle party.", access: "internal" },
  call: (view: CommandView, args: readonly Arg[]) => ({ value: resolve(owner(view).partySize(numeric(args, 1))) }),
} satisfies BuiltinSpec;
const FIGHTER = {
  name: "__battle_fighter", aliases: [], params: [parameter("self"), parameter("party"), parameter("index")],
  doc: { summary: "Hydrate one battle fighter object.", behaviour: "Returns the canonical actor host object for the requested usable fighter position.", access: "internal" },
  call: (view: CommandView, args: readonly Arg[]) => {
    const fighter = resolve(owner(view).fighter(numeric(args, 1), numeric(args, 2)));
    const state = view.state;
    if (state === undefined) throw new ScriptError("battle.not-active", "there is no active battle");
    const record = registerActorObject(state.vm, state.events, state.actors, fighter.actorId);
    if (record === null) throw new ScriptError("battle.bad-fighter", `no usable fighter exists at this position (party=${display(numeric(args, 1))}, index=${display(numeric(args, 2))})`);
    return { value: { kind: "object", handle: record.handle, className: record.className } };
  },
} satisfies BuiltinSpec;
function chargeCommand(name: string, params: readonly ParamSpec[], action: (args: readonly Arg[]) => BattleAction): BuiltinSpec {
  return {
    name, aliases: [], params,
    doc: { summary: "Update battle charge through its owner.", behaviour: "Validates the fighter reference and commits the requested stored-charge operation without clamping its value.", access: "internal" },
    call: (view, args) => { resolve(owner(view).apply(action(args))); return { value: null }; },
  };
}
const CHARGE = {
  name: "__battle_charge", aliases: [], params: [parameter("self"), parameter("party"), parameter("index")],
  doc: { summary: "Read a fighter charge.", behaviour: "Returns the stored charge without clamping it.", access: "internal" },
  call: (view: CommandView, args: readonly Arg[]) => ({ value: resolve(owner(view).charge(numeric(args, 1), numeric(args, 2))) }),
} satisfies BuiltinSpec;
const CHARGE_PERCENT = {
  name: "__battle_charge_percent", aliases: [], params: [parameter("self"), parameter("party"), parameter("index")],
  doc: { summary: "Read a fighter charge percentage.", behaviour: "Returns the whole percentage of its party threshold, clamped to 0–100.", access: "internal" },
  call: (view: CommandView, args: readonly Arg[]) => ({ value: resolve(owner(view).chargePercent(numeric(args, 1), numeric(args, 2))) }),
} satisfies BuiltinSpec;
const ADD_CHARGE = chargeCommand("__battle_add_charge", [parameter("self"), parameter("party"), parameter("index"), parameter("amount")], (args) => ({ type: "addCharge", party: numeric(args, 1), index: numeric(args, 2), amount: numeric(args, 3) }));
const SET_CHARGE = chargeCommand("__battle_set_charge", [parameter("self"), parameter("party"), parameter("index"), parameter("charge")], (args) => ({ type: "setCharge", party: numeric(args, 1), index: numeric(args, 2), charge: numeric(args, 3) }));
const RELEASE_CHARGE = chargeCommand("__battle_release_charge", [parameter("self"), parameter("party"), parameter("index")], (args) => ({ type: "releaseCharge", party: numeric(args, 1), index: numeric(args, 2) }));
const FINISH = {
  name: "__battle_finish", aliases: [], params: [parameter("self"), parameter("code")],
  doc: { summary: "Finish the current battle.", behaviour: "Validates the 0–4 outcome and records it once; outcome sequencing belongs to the battle package.", access: "internal" },
  call: (view: CommandView, args: readonly Arg[]) => { resolve(owner(view).apply({ type: "finish", code: numeric(args, 1) })); return { value: null }; },
} satisfies BuiltinSpec;
const STATUS_ASSET = {
  name: "__battle_status_asset", aliases: [], params: [parameter("ok"), parameter("bytes"), parameter("operation"), parameter("actor"), parameter("source", true)],
  doc: { summary: "Resume a status effect asset request.", behaviour: "Reads the status name and rounds from the `.ste` asset and commits a status counter change through the actor owner.", access: "internal" },
  call: statusContinuation,
} satisfies BuiltinSpec;

const HP = statCommand("hp", "Set a fighter's hp.", "hp", "set");
const GIVE_HP = statCommand("givehp", "Increase a fighter's current hp.", "hp", "add");
const GET_HP = statCommand("gethp", "Get a fighter's hp.", "hp", "get");
const MAX_HP = statCommand("maxhp", "Set a fighter's max hp.", "maxHp", "set");
const GET_MAX_HP = statCommand("getmaxhp", "Get a fighter's max hp.", "maxHp", "get");
const GIVE_SMP = statCommand("givesmp", "Increase a fighter's smp.", "smp", "add", "value");
const SMP = statCommand("smp", "Set a fighter's smp.", "smp", "set");
const GET_SMP = statCommand("getsmp", "Get a fighter's smp.", "smp", "get");
const MAX_SMP = statCommand("maxsmp", "Set a fighter's max smp.", "maxSmp", "set");
const GET_MAX_SMP = statCommand("getmaxsmp", "Get a fighter's max smp.", "maxSmp", "get");
const FP = statCommand("fp", "Set a fighter's fp.", "fp", "set");
const GIVE_FP = statCommand("givefp", "Increase a fighter's fp.", "fp", "add");
const GET_FP = statCommand("getfp", "Get a fighter's fp.", "fp", "get");
const DP = statCommand("dp", "Set a fighter's dp.", "dp", "set");
const GET_DP = statCommand("getdp", "Get a fighter's dp.", "dp", "get");
const GIVE_EXP: BuiltinSpec = {
  name: "giveexp", aliases: [], params: [parameter("handle"), parameter("amount")],
  doc: documentation("Give experience to a player.", "Awards the amount to the named actor through the actor progression owner; all level changes and events use the shared actor progression path."),
  call: (view, args) => {
    const id = referenceActor(view, args[0]?.value);
    const amount = integer(args, 1, "giveexp");
    if (view.actors?.awardExperience(id, amount) === null || view.actors === undefined) return badFighter(args[0]?.value);
    return { value: null };
  },
};
const APPLY_STATUS: BuiltinSpec = {
  name: "applystatus", aliases: [], params: [parameter("target"), parameter("file")],
  doc: documentation("Apply a status effect to a fighter.", "Loads the named `.ste` file from StatusE, then starts or restarts the actor-owned counter using its name and rounds fields; the counter is not incremented and no battle-round effects run here.", [{ code: "battle.not-active", when: "there is no active battle" }, { code: "battle.bad-fighter", when: "the target is not an active fighter" }]),
  call: (view, args) => statusRequest(view, args, "apply"),
};
const REMOVE_STATUS: BuiltinSpec = {
  name: "removestatus", aliases: [], params: [parameter("target"), parameter("file")],
  doc: documentation("Remove a status effect from a fighter.", "Loads the named `.ste` file from StatusE to identify the status counter, then removes it through the actor owner; no battle-round effects run here.", [{ code: "battle.not-active", when: "there is no active battle" }, { code: "battle.bad-fighter", when: "the target is not an active fighter" }]),
  call: (view, args) => statusRequest(view, args, "remove"),
};

export const BATTLE_COMMANDS: readonly BuiltinSpec[] = [
  PARTY_SIZE, FIGHTER, CHARGE, ADD_CHARGE, SET_CHARGE, RELEASE_CHARGE, CHARGE_PERCENT, FINISH,
  HP, GIVE_HP, GET_HP, MAX_HP, GET_MAX_HP, SMP, GIVE_SMP, GET_SMP, MAX_SMP, GET_MAX_SMP,
  FP, GIVE_FP, GET_FP, DP, GET_DP, GIVE_EXP, APPLY_STATUS, REMOVE_STATUS, STATUS_ASSET,
];
export const BATTLE_COMMAND_NAMES = new Set<string>(BATTLE_COMMANDS.flatMap((command) => [command.name, ...command.aliases]));
export const BATTLE_PLUGIN: PluginDefinition = {
  id: "battle",
  version: "1.0.0",
  doc: {
    summary: "Owner-mediated access to active battle fighters and their actor-owned stats.",
    groups: [
      { id: GROUP, name: "Battle, stats & menus", summary: "Read and update battle fighters and their actor-owned stats." },
      { id: "internal", name: "Internal", summary: "Hydrated battle object continuations." },
    ],
  },
  commands: BATTLE_COMMANDS,
};
