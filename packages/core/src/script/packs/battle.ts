import type { StatusEffect } from "../../formats/battle/model.ts";
import { readStatusEffect } from "../../formats/battle/status-effect.ts";
import type { Result } from "../../formats/result.ts";
import { BinaryReader } from "../../formats/binary/reader.ts";
import { canon } from "../../canon/index.ts";
import { createObject, writeMember } from "../objects.ts";
import type { ActorId, ActorStats } from "../../actors/model.ts";
import { registerActorObject } from "../../actors/object.ts";
import type { BattleAction, BattleOperationResult } from "../../battle/port.ts";
import type { Value } from "../../ports/value.ts";
import type { Arg, BuiltinDoc, BuiltinSpec, ParamSpec } from "../builtins.ts";
import { ScriptError } from "../errors.ts";
import type { CommandResult, CommandView, PluginDefinition } from "../plugin.ts";

const GROUP = "battle-stats-menus-33";
const NO_WAIT = { kind: "never", summary: "Completes in the current script turn." } as const;
const STATUS_WAIT = { kind: "host-request", summary: "Waits for the host to load and return the requested StatusE `.ste` asset." } as const;
const FIGHTER_HANDLES = "Handles accept `source` or `target` from the current script thread, a party-member name resolved in the actor store's ordered party, an actor object (including the object returned by `battle.fighter(...)`), or an enemy reference `{ party: 0, index }` with a zero-based index.";
const STAT_THROWS: NonNullable<BuiltinDoc["throws"]> = [
  { code: "battle.bad-fighter", when: "the handle does not identify an actor or its enemy-reference position is invalid" },
  { code: "battle.not-active", when: "an enemy reference is used without an active battle" },
  { code: "builtin.bad-arg", when: "a stat value or amount is not a valid safe integer for the actor owner" },
];
const STAT_READ_THROWS = STAT_THROWS.filter((item) => item.code !== "builtin.bad-arg");

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

const STATUS_APPLY_THROWS: NonNullable<BuiltinDoc["throws"]> = [
  { code: "battle.not-active", when: "there is no active battle" },
  { code: "battle.bad-fighter", when: "the target does not identify an active fighter" },
  { code: "asset.missing", when: "the requested StatusE asset is missing" },
  { code: "request.bad-reply", when: "the host asset reply is not valid hexadecimal bytes" },
  { code: "format.status-effect", when: "the bytes are not a valid StatusE `.ste` file" },
  { code: "builtin.bad-arg", when: "the `.ste` rounds value is not a non-negative safe integer" },
];
const STATUS_REMOVE_THROWS: NonNullable<BuiltinDoc["throws"]> = [
  { code: "battle.not-active", when: "there is no active battle" },
  { code: "battle.bad-fighter", when: "the target does not identify an active fighter" },
  { code: "asset.missing", when: "the requested StatusE asset is missing" },
  { code: "request.bad-reply", when: "the host asset reply is not valid hexadecimal bytes" },
  { code: "format.status-effect", when: "the bytes are not a valid StatusE `.ste` file" },
];

function documentation(
  summary: string,
  behaviour: string,
  throws: NonNullable<BuiltinDoc["throws"]> = STAT_THROWS,
  waits: BuiltinDoc["waits"] = NO_WAIT,
): BuiltinDoc {
  return { summary, behaviour, groups: [GROUP], tags: ["legacy"], waits, throws };
}

const BATTLE_READ_THROWS: NonNullable<BuiltinDoc["throws"]> = [
  { code: "battle.not-active", when: "there is no active battle" },
  { code: "battle.bad-fighter", when: "the party, index, or fighter position is invalid" },
];
const BATTLE_PARTY_SIZE_THROWS: NonNullable<BuiltinDoc["throws"]> = [
  { code: "battle.not-active", when: "there is no active battle" },
  { code: "battle.bad-fighter", when: "party is not 0 or 1" },
];
const BATTLE_CHARGE_THROWS: NonNullable<BuiltinDoc["throws"]> = [
  ...BATTLE_READ_THROWS,
  { code: "builtin.bad-arg", when: "the charge or resulting stored charge is not finite" },
];
const BATTLE_FINISH_THROWS: NonNullable<BuiltinDoc["throws"]> = [
  { code: "battle.not-active", when: "there is no active battle" },
  { code: "battle.bad-outcome", when: "the outcome is not an integer from 0 through 4" },
  { code: "battle.already-finished", when: "the battle already has an outcome" },
  { code: "battle.cannot-run", when: "outcome 0 is requested while canRun is false" },
];

function internalDocumentation(summary: string, behaviour: string, throws: NonNullable<BuiltinDoc["throws"]> = []): BuiltinDoc {
  return { summary, behaviour, groups: ["internal"], access: "internal", waits: NO_WAIT, throws };
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
    then: { command: "__battle_status_asset", args: [operation, target, statusSource(view), statusPath(text(args, 1))] },
  };
}

function statusFileReply(args: readonly Arg[]): Result<StatusEffect> {
  if (numeric(args, 0) !== 1) throw new ScriptError("asset.missing", "status effect asset was not found");
  const hex = text(args, 1);
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) throw new ScriptError("request.bad-reply", "status effect asset reply must be hexadecimal bytes");
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return readStatusEffect(new BinaryReader(bytes));
}
function statusContinuation(view: CommandView, args: readonly Arg[]): CommandResult {
  const status = statusFileReply(args);
  if (!status.ok) throw new ScriptError("format.status-effect", status.error.message);
  const operation = text(args, 2);
  const actorId = integer(args, 3, "battle status operation");
  if (operation !== "apply" && operation !== "remove") throw new ScriptError("request.bad-reply", "unknown status operation");
  if (operation === "apply" && (!Number.isSafeInteger(status.value.rounds) || status.value.rounds < 0)) {
    throw new ScriptError("builtin.bad-arg", "applystatus: StatusE rounds must be a non-negative safe integer");
  }
  const sourceValue = args[4]?.value;
  const source = typeof sourceValue === "number" && Number.isSafeInteger(sourceValue) && sourceValue > 0 ? sourceValue as ActorId : null;
  const actors = view.actors;
  if (actors === undefined) throw new ScriptError("battle.bad-fighter", `unknown status target (party=unknown, index=unknown)`);
  const file = text(args, 5);
  const result = operation === "apply"
    ? actors.applyStatus(actorId, file, status.value.rounds, { source })
    : actors.removeStatus(actorId, file, { source });
  if (result === null) throw new ScriptError("battle.bad-fighter", `unknown status target (party=unknown, index=unknown)`);
  return { value: null };
}

function statusFlagsContinuation(view: CommandView, args: readonly Arg[]): CommandResult {
  const status = statusFileReply(args);
  if (!status.ok) throw new ScriptError("format.status-effect", status.error.message);
  const object = createObject(view.state!.vm, null);
  writeMember(object, "speed", status.value.speedUp !== 0 ? 1 : 0);
  writeMember(object, "slow", status.value.slowDown !== 0 ? 1 : 0);
  writeMember(object, "disable", status.value.disable !== 0 ? 1 : 0);
  return { value: { kind: "object", handle: object.handle, className: object.className } };
}

const STATUS_FLAGS_ASSET = {
  name: "__battle_status_flags_asset", aliases: [], params: [parameter("ok"), parameter("bytes")],
  doc: internalDocumentation("Resume a StatusE flag request.", "Reads the StatusE asset and returns only its normalized speed, slow and disable values."),
  call: statusFlagsContinuation,
} satisfies BuiltinSpec;

const STATUS_FLAGS = {
  name: "statusflags", aliases: [], params: [parameter("file")],
  doc: {
    summary: "Read a status file's speed, slow and disable flags.",
    behaviour: "Requests the normalized StatusE `.ste` asset and returns a dictionary with numeric `speed`, `slow` and `disable` values of 1 or 0. It reads only the file and does not change actor counters or stats.",
    groups: [GROUP, "reawakened-additions-not-part-of-the-282-legacy-catalogue"], tags: ["experimental"], waits: STATUS_WAIT,
    throws: [
      { code: "asset.missing", when: "the requested StatusE asset is missing" },
      { code: "request.bad-reply", when: "the host reply is not valid hexadecimal bytes" },
      { code: "format.status-effect", when: "the bytes are not a valid StatusE `.ste` file" },
    ],
  },
  call: (_view: CommandView, args: readonly Arg[]) => ({
    value: null,
    request: { kind: "asset", area: "statusEffects", path: statusPath(text(args, 0)) },
    then: { command: "__battle_status_flags_asset", args: [] },
  }),
} satisfies BuiltinSpec;

const GET_STATUS = {
  name: "getstatus", aliases: [], params: [parameter("fighter"), parameter("index")],
  doc: {
    summary: "Read one of a fighter's active status file names.",
    behaviour: "Returns the filename key of the zero-based status entry in canonical filename order, or an empty string when the index is past the end. Canonical ordering matches snapshots, so enumeration resumes identically after restore. A present zero-round counter remains included until removed. This does not read status rules or change actor state.",
    groups: [GROUP, "reawakened-additions-not-part-of-the-282-legacy-catalogue"], tags: ["experimental"], waits: NO_WAIT,
    throws: [...STAT_READ_THROWS, { code: "builtin.bad-arg", when: "index is not a non-negative safe integer" }],
  },
  call: (view: CommandView, args: readonly Arg[]) => {
    const id = referenceActor(view, args[0]?.value);
    const index = integer(args, 1, "getstatus");
    if (index < 0) throw new ScriptError("builtin.bad-arg", "getstatus: index must be non-negative");
    const actor = actorRecord(view, id);
    if (actor === null) return { value: "" };
    // Actor maps are key-sorted by canonical snapshots; use the same order live.
    return { value: Object.keys(actor.statuses).sort()[index] ?? "" };
  },
} satisfies BuiltinSpec;
const STATUS_SIGNATURE = {
  name: "statussignature", aliases: [], params: [parameter("fighter")],
  doc: {
    summary: "Read a fighter's status signature.",
    behaviour: `Returns an opaque exact canonical JSON text token for the fighter's current status names and round counters; it changes when the status set or any counter changes, including presence of a zero-round status. Canonical key order matches snapshots, so the result is safe to save and compare after restore regardless of insertion order. This synchronous read does not load StatusE files or change actor state. ${FIGHTER_HANDLES}`,
    groups: [GROUP, "reawakened-additions-not-part-of-the-282-legacy-catalogue"], tags: ["experimental"], waits: NO_WAIT,
    throws: STAT_READ_THROWS,
  },
  call: (view: CommandView, args: readonly Arg[]) => {
    const id = referenceActor(view, args[0]?.value);
    const actor = actorRecord(view, id);
    return { value: actor === null ? "{}" : canon(actor.statuses) };
  },
} satisfies BuiltinSpec;

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
  const statName = field === "maxHp" ? "maximum HP" : field === "maxSmp" ? "maximum SMP" : field;
  const unit = field.toLowerCase().includes("hp") ? "HP points" : field.toLowerCase().includes("smp") ? "SMP points" : `${field} stat points`;
  const operation = mode === "get"
    ? `Reads the live actor-owned ${statName} in ${unit}; the optional trailing by-reference result receives the same current value.`
    : mode === "set"
      ? `Sets the live actor-owned ${statName} in ${unit} through the actor owner. HP and SMP are clamped to [0, maximum]; lowering a maximum also clamps its current value.`
      : field === "hp" || field === "smp"
        ? `Adds the signed ${unit} amount through the actor owner's damage/heal operation (positive heals, negative damages); the owner clamps the result to [0, maximum]${field === "hp" ? " and emits the ordinary fallen transition once when HP crosses to zero" : ""}.`
        : `Adds the signed ${unit} amount to the live actor-owned value through the actor owner; the resulting safe integer is committed atomically.`;
  const behaviour = `${FIGHTER_HANDLES} ${operation} These aliases always read and write the actor store; no stats are copied, and they do not require an active battle for legacy actor handles. The call completes synchronously.`;
  return {
    name,
    aliases: [],
    params,
    doc: documentation(summary, behaviour, mode === "get" ? STAT_READ_THROWS : STAT_THROWS),
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
  doc: internalDocumentation(
    "Read a battle party size.",
    "For `battle.partySize(party)`, returns the number of entries in party 0 (enemies) or party 1 (the player's ordered party). Party is 0 or 1; the read comes from the saved battle section and completes synchronously.",
    BATTLE_PARTY_SIZE_THROWS,
  ),
  call: (view: CommandView, args: readonly Arg[]) => ({ value: resolve(owner(view).partySize(numeric(args, 1))) }),
} satisfies BuiltinSpec;
const FIGHTER = {
  name: "__battle_fighter", aliases: [], params: [parameter("self"), parameter("party"), parameter("index")],
  doc: internalDocumentation(
    "Return a battle fighter object.",
    "For `battle.fighter(party, index)`, returns the same canonical actor host object registered in the actor store, not a copy. Party 0 is enemies, party 1 is the player's ordered party, and index is zero-based; only usable positions resolve.",
    BATTLE_READ_THROWS,
  ),
  call: (view: CommandView, args: readonly Arg[]) => {
    const fighter = resolve(owner(view).fighter(numeric(args, 1), numeric(args, 2)));
    const state = view.state;
    if (state === undefined) throw new ScriptError("battle.not-active", "there is no active battle");
    const record = registerActorObject(state.vm, state.events, state.actors, fighter.actorId);
    if (record === null) throw new ScriptError("battle.bad-fighter", `no usable fighter exists at this position (party=${display(numeric(args, 1))}, index=${display(numeric(args, 2))})`);
    return { value: { kind: "object", handle: record.handle, className: record.className } };
  },
} satisfies BuiltinSpec;
function chargeCommand(
  name: string,
  summary: string,
  behaviour: string,
  params: readonly ParamSpec[],
  action: (args: readonly Arg[]) => BattleAction,
  throws: NonNullable<BuiltinDoc["throws"]> = BATTLE_CHARGE_THROWS,
): BuiltinSpec {
  return {
    name, aliases: [], params,
    doc: internalDocumentation(summary, behaviour, throws),
    call: (view, args) => { resolve(owner(view).apply(action(args))); return { value: null }; },
  };
}
const CHARGE = {
  name: "__battle_charge", aliases: [], params: [parameter("self"), parameter("party"), parameter("index")],
  doc: internalDocumentation(
    "Read a fighter's stored charge.",
    "For `battle.charge(party, index)`, returns the exact stored charge number for that zero-based fighter entry. Storage is not clamped to a threshold; party 0 is enemies and party 1 is the player's ordered party.",
    BATTLE_READ_THROWS,
  ),
  call: (view: CommandView, args: readonly Arg[]) => ({ value: resolve(owner(view).charge(numeric(args, 1), numeric(args, 2))) }),
} satisfies BuiltinSpec;
const CHARGE_PERCENT = {
  name: "__battle_charge_percent", aliases: [], params: [parameter("self"), parameter("party"), parameter("index")],
  doc: internalDocumentation(
    "Read a fighter's charge percentage.",
    "For `battle.chargePercent(party, index)`, computes floor(stored charge × 100 / threshold), then clamps the result to 0–100. The threshold is 123 for enemy party 0 and 75 for player party 1; stored charge itself is unchanged.",
    BATTLE_READ_THROWS,
  ),
  call: (view: CommandView, args: readonly Arg[]) => ({ value: resolve(owner(view).chargePercent(numeric(args, 1), numeric(args, 2))) }),
} satisfies BuiltinSpec;
const ADD_CHARGE = chargeCommand(
  "__battle_add_charge",
  "Add to a fighter's stored charge.",
  "For `battle.addCharge(party, index, amount)`, adds a finite numeric amount to the stored charge and commits through the battle owner. The stored value is not clamped to a threshold; party and index are 0-based party/entry selectors.",
  [parameter("self"), parameter("party"), parameter("index"), parameter("amount")],
  (args) => ({ type: "addCharge", party: numeric(args, 1), index: numeric(args, 2), amount: numeric(args, 3) }),
);
const SET_CHARGE = chargeCommand(
  "__battle_set_charge",
  "Set a fighter's stored charge.",
  "For `battle.setCharge(party, index, charge)`, stores the finite numeric value exactly through the battle owner, without threshold clamping. Party and index are 0-based party/entry selectors.",
  [parameter("self"), parameter("party"), parameter("index"), parameter("charge")],
  (args) => ({ type: "setCharge", party: numeric(args, 1), index: numeric(args, 2), charge: numeric(args, 3) }),
);
const RELEASE_CHARGE = chargeCommand(
  "__battle_release_charge",
  "Release a fighter's charge.",
  "For `battle.releaseCharge(party, index)`, sets that fighter's stored charge to exactly 0 through the battle owner. Party and index are 0-based party/entry selectors.",
  [parameter("self"), parameter("party"), parameter("index")],
  (args) => ({ type: "releaseCharge", party: numeric(args, 1), index: numeric(args, 2) }),
  BATTLE_READ_THROWS,
);
const FINISH = {
  name: "__battle_finish", aliases: [], params: [parameter("self"), parameter("code")],
  doc: internalDocumentation(
    "Record a battle outcome.",
    "`battle.finish(code)` accepts integer codes 0 through 4 and records the outcome once through the battle owner; code 0 (run) is accepted only when `battle.canRun` is true. It does not execute an outcome adapter or sequence.",
    BATTLE_FINISH_THROWS,
  ),
  call: (view: CommandView, args: readonly Arg[]) => { resolve(owner(view).apply({ type: "finish", code: numeric(args, 1) })); return { value: null }; },
} satisfies BuiltinSpec;
const STATUS_ASSET = {
  name: "__battle_status_asset", aliases: [], params: [parameter("ok"), parameter("bytes"), parameter("operation"), parameter("actor"), parameter("source"), parameter("file")],
  doc: internalDocumentation(
    "Resume a status-effect asset request.",
    "After the host replies, reads rounds from the `.ste` asset and delegates the counter change to the actor owner, keyed by the supplied file name (extension appended, StatusE prefix removed); the in-file name is display data only.",
    [
      { code: "asset.missing", when: "the requested StatusE asset is missing" },
      { code: "request.bad-reply", when: "the host reply is malformed" },
      { code: "format.status-effect", when: "the bytes are not a valid StatusE `.ste` file" },
      { code: "builtin.bad-arg", when: "the `.ste` rounds value is not a non-negative safe integer" },
      { code: "battle.bad-fighter", when: "the target actor does not exist" },
    ],
  ),
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
  doc: documentation(
    "Give experience to a player.",
    `${FIGHTER_HANDLES} Awards a non-negative safe-integer number of experience points through the actor progression owner. It checks each crossed threshold in order and commits level/stat changes synchronously; the command does not wait. Legacy actor handles work without an active battle.`,
    [
      { code: "battle.bad-fighter", when: "the handle does not identify an actor" },
      { code: "battle.not-active", when: "an enemy reference is used without an active battle" },
      { code: "builtin.bad-arg", when: "the amount is not a non-negative safe integer" },
    ],
  ),
  call: (view, args) => {
    const id = referenceActor(view, args[0]?.value);
    const amount = integer(args, 1, "giveexp");
    if (amount < 0) throw new ScriptError("builtin.bad-arg", "giveexp: amount must not be negative");
    if (view.actors?.awardExperience(id, amount) === null || view.actors === undefined) return badFighter(args[0]?.value);
    return { value: null };
  },
};
const APPLY_STATUS: BuiltinSpec = {
  name: "applystatus", aliases: [], params: [parameter("target"), parameter("file")],
  doc: documentation(
    "Apply a status effect to a fighter.",
    `Loads StatusE/<file>.ste (the prefix and extension may be omitted), then starts or restarts the actor-owned counter keyed by that file name, preserving spelling and comparing ignoring case, at the file's non-negative rounds value, including zero; re-application replaces the counter and never adds rounds. The embedded name is display data only. The actor owner emits the ordinary \`statusChanged\` event with detail { status, previousRounds, rounds, expired, source }. This call waits for the asset reply but does not tick counters or apply battle-round effects. ${FIGHTER_HANDLES}`,
    STATUS_APPLY_THROWS,
    STATUS_WAIT,
  ),
  call: (view, args) => statusRequest(view, args, "apply"),
};
const REMOVE_STATUS: BuiltinSpec = {
  name: "removestatus", aliases: [], params: [parameter("target"), parameter("file")],
  doc: documentation(
    "Remove a status effect from a fighter.",
    `Loads StatusE/<file>.ste (the prefix and extension may be omitted), then removes the actor-owned counter keyed by that file name, compared ignoring case; when present, the actor owner emits the ordinary \`statusChanged\` event with detail { status, previousRounds, rounds, expired, source }. Removing an absent status is a no-op. The embedded name is display data only. This call waits for the asset reply but does not tick counters or apply battle-round effects. ${FIGHTER_HANDLES}`,
    STATUS_REMOVE_THROWS,
    STATUS_WAIT,
  ),
  call: (view, args) => statusRequest(view, args, "remove"),
};

export const BATTLE_COMMANDS: readonly BuiltinSpec[] = [
  PARTY_SIZE, FIGHTER, CHARGE, ADD_CHARGE, SET_CHARGE, RELEASE_CHARGE, CHARGE_PERCENT, FINISH,
  HP, GIVE_HP, GET_HP, MAX_HP, GET_MAX_HP, SMP, GIVE_SMP, GET_SMP, MAX_SMP, GET_MAX_SMP,
  FP, GIVE_FP, GET_FP, DP, GET_DP, GIVE_EXP, APPLY_STATUS, REMOVE_STATUS, STATUS_ASSET, GET_STATUS, STATUS_FLAGS, STATUS_FLAGS_ASSET,
  STATUS_SIGNATURE,
];
export const BATTLE_COMMAND_NAMES = new Set<string>(BATTLE_COMMANDS.flatMap((command) => [command.name, ...command.aliases]));
export const BATTLE_PLUGIN: PluginDefinition = {
  id: "battle",
  version: "1.0.0",
  doc: {
    summary: "For game scripts, inspect active fighters, read or update stored charge, and record a battle outcome through the battle owner.",
    groups: [
      { id: GROUP, name: "Battle, stats & menus", summary: "`battle.partySize`, `battle.fighter`, charge methods (`battle.charge`, `battle.addCharge`, `battle.setCharge`, `battle.releaseCharge`, `battle.chargePercent`), and `battle.finish` are synchronous owner-mediated operations requiring an active battle. Party is 0 for enemies and 1 for the player's ordered party; indexes are zero-based. Invalid party/index/position is `battle.bad-fighter`; no active battle is `battle.not-active`. `battle.canRun` is read-only and returns 1 when the section flag is true or 0 when false; `battle.outcome` is read-only and is null until finish records a code from 0 through 4. `battle.fighter` returns the canonical actor object." },
      { id: "internal", name: "Internal", summary: "Deterministic host continuations for battle methods and StatusE requests." },
    ],
  },
  commands: BATTLE_COMMANDS,
};
