/**
 * Snapshot and restore (AD-10/AD-11; decisions Q4, Q5/Q12).
 *
 * `snapshot(state)` is the canonical form of the whole state tree, so a
 * snapshot, a save, a hash and a restore all share one representation
 * (`canon`, RFC 8785) — Q4. `restoreGameState(json)` parses it and checks the
 * compiler version and the presence of every section; bounds and the
 * restore-versus-restart policy for a mismatch are entry 11's. Q5/Q12 place the
 * shared snapshot→restore→hash check in `runner-harness`. Compiled programs are
 * not in state (AD-7), so a restored host recompiles lazily through its own
 * program memo.
 *
 * Two errors are pinned: a different `schema.compiler` is
 * `restore.compiler-mismatch`, and a missing section is `restore.shape`.
 *
 * **Callable handles and closure cells (FUN-8; entry 18.6).** `restoreGameState`
 * also checks, with no program to hand, that every callable is a whole record,
 * that `vm.cells` and `vm.cellSeq` agree, and that every cell a handle or a frame
 * names exists (`restore.callable-malformed`, `restore.cell-seq`,
 * `restore.cell-missing`). Whether a handle's definition is still defined needs
 * the compiled programs, so a host runs `verifyRestoredHandles` after it has
 * rebuilt its services. No schema or compiler version moves: the new fields are
 * optional and absent from every state with no closure in it.
 *
 * **Migration (AD-7's migration chain).** A save whose `schema.vm` is behind
 * `SCHEMA_VERSIONS.vm` is migrated forward before it is returned: v2 → v3 adds
 * the effect log that ticket 3.21 introduced, v3 → v4 the thread, wait and
 * request fields of ticket 3.9, v4 → v5 advances both ticket 3.8 module
 * metadata and ticket 3.16's sandboxed file-handle table, then the section
 * version is set to the current one. The chain is keyed by the per-section
 * numbers (AD-23). A save whose `schema.audio` is 1 carried the empty
 * placeholder; it is replaced by a fresh schema-2 audio section
 * (docs/spec/engine/audio-media.md#audio-state), because a placeholder held no
 * playback to keep.
 *
 * AD-10 (the state tree) and AD-11 (the canonical form); docs/spec/formats/save-game.md#layout-minor-4 (the
 * saved game).
 */

import { canon, reviveNonFinite, tagNonFinite } from "../canon/index.ts";
import { cellIdOfRef, cellNumber, eachRootValue, isRecord } from "../script/cells.ts";
import {
  RESTORE_CALLABLE_MALFORMED,
  RESTORE_CELL_MISSING,
  RESTORE_CELL_SEQ,
  ScriptError,
} from "../script/errors.ts";
import { COMPILER_VERSION } from "../script/program.ts";
import { SCHEMA_VERSIONS, type GameState } from "./state.ts";
import { asActorsSection, createActorsSection, ACTORS_SCHEMA_VERSION, validateActorProgression, type ActorProgression, type ActorStats } from "../actors/model.ts";
import { asSpritesSection, createSpritesSection, SPRITES_SCHEMA_VERSION } from "../sprites/model.ts";
import { createInputSection } from "../input/input.ts";
import { createTriggersSection, TRIGGERS_SCHEMA_VERSION } from "../triggers/model.ts";
import { INPUT_SCHEMA_VERSION } from "./sections/input.ts";
import { AUDIO_SCHEMA_VERSION, createAudioSection } from "../audio/model.ts";
import { createEventsSection } from "../events/model.ts";
import { EVENT_DISPATCH_WAIT } from "../events/emitter.ts";
import type { Diagnostic } from "../ports/engine.ts";
import { BATTLE_SCHEMA_VERSION, createBattleSection, validateBattleSection } from "../battle/model.ts";
import { migrateMenuSections } from "../menu/migrate.ts";
/** Upgrade the old empty battle placeholder to the fighter-reference section. */
function migrateBattle(record: Record<string, unknown>, schema: Record<string, unknown>): void {
  const version = schema.battle;
  if (typeof version !== "number") shapeError("the snapshot's `schema` has no numeric `battle` version");
  if (version > BATTLE_SCHEMA_VERSION) shapeError(`the snapshot's battle schema version ${String(version)} is newer than supported version ${BATTLE_SCHEMA_VERSION}`);
  if (version < BATTLE_SCHEMA_VERSION) {
    if (version !== 1) shapeError(`the snapshot's battle schema version ${String(version)} has no migration`);
    record.battle = createBattleSection();
    schema.battle = BATTLE_SCHEMA_VERSION;
  }
}

/** The canonical form of a whole game state (AD-10/AD-11). */
export function snapshot(state: GameState): string {
  return canon(tagNonFinite(state) as never);
}

/**
 * Migrate a snapshot's `vm` section to the current schema. Engine effect queues
 * are optional and require no version bump because an empty engine section
 * serialises identically before and after registration.
 */
function migrateVm(record: Record<string, unknown>, schema: Record<string, unknown>): void {
  const version = schema.vm;
  if (typeof version !== "number") {
    throw new ScriptError("restore.shape", "the snapshot's `schema` has no numeric `vm` version");
  }
  if (version >= SCHEMA_VERSIONS.vm) return;

  const vm = record.vm;
  if (typeof vm !== "object" || vm === null || Array.isArray(vm)) {
    throw new ScriptError("restore.shape", "the snapshot's `vm` section is not an object");
  }
  const vmRecord = vm as Record<string, unknown>;
  if (version < 3) {
    if (!Array.isArray(vmRecord.effects)) vmRecord.effects = [];
    if (typeof vmRecord.effectSeq !== "number") vmRecord.effectSeq = 0;
  }
  if (version < 4) {
    if (!Array.isArray(vmRecord.threads)) {
      throw new ScriptError("restore.shape", "the snapshot's `vm.threads` is not an array");
    }
    for (const entry of vmRecord.threads as unknown[]) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        throw new ScriptError("restore.shape", "a thread in the snapshot is not an object");
      }
      const thread = entry as Record<string, unknown>;
      thread.queue = [];
      thread.pending = null;
      thread.detached = [];
      thread.collect = null;
      const wait = thread.wait;
      if (typeof wait === "object" && wait !== null && !Array.isArray(wait)) {
        const waitRecord = wait as Record<string, unknown>;
        if (waitRecord.kind === "sleep") {
          waitRecord.global = true;
          waitRecord.resumesCall = true;
        }
      }
    }
    vmRecord.block = null;
    vmRecord.requestSeq = 0;
  }
  if (version < 5) {
    if (!Array.isArray(vmRecord.files)) vmRecord.files = [];
  }
  schema.vm = SCHEMA_VERSIONS.vm;
}

/** Advance engine effect-dispatch state to the bounded-queue schema. */
function migrateEngine(record: Record<string, unknown>, schema: Record<string, unknown>): void {
  const version = schema.engine;
  if (typeof version !== "number") {
    throw new ScriptError("restore.shape", "the snapshot's `schema` has no numeric `engine` version");
  }
  if (version >= SCHEMA_VERSIONS.engine) return;
  const engine = recordAt(record.engine, "engine");
  if (version < 2) {
    if (engine.pendingEffects !== undefined && (typeof engine.pendingEffects !== "object" || engine.pendingEffects === null || Array.isArray(engine.pendingEffects))) {
      throw new ScriptError("restore.shape", "the snapshot's engine.pendingEffects is not an object");
    }
    if (engine.effectDropped !== undefined && (typeof engine.effectDropped !== "object" || engine.effectDropped === null || Array.isArray(engine.effectDropped))) {
      throw new ScriptError("restore.shape", "the snapshot's engine.effectDropped is not an object");
    }
    if (engine.effectDiagnostics !== undefined && !Array.isArray(engine.effectDiagnostics)) {
      throw new ScriptError("restore.shape", "the snapshot's engine.effectDiagnostics is not an array");
    }
  }
  schema.engine = SCHEMA_VERSIONS.engine;
}

/** Migrate the old empty sprites placeholder and v2 actors to the movement-aware section. */
function migrateSprites(record: Record<string, unknown>, schema: Record<string, unknown>): void {
  const version = schema.sprites;
  if (typeof version !== "number") shapeError("the snapshot's `schema` has no numeric `sprites` version");
  const current = asSpritesSection(record.sprites);
  const section = current === null ? createSpritesSection() : current;
  const movement = { active: null, waitTicks: 0, pendingExit: null, under: [], lastStepTick: null, lastStepDistance: 0 };
  const normalise = (actor: (typeof section.players)[number]) => ({
    ...actor,
    movement: {
      ...movement,
      ...(actor.movement ?? {}),
      lastStepTick: actor.movement?.lastStepTick ?? null,
      lastStepDistance: actor.movement?.lastStepDistance ?? 0,
    },
  });
  section.players = section.players.map(normalise);
  section.items = section.items.map(normalise);
  if (version < SPRITES_SCHEMA_VERSION) {
    section.version = SPRITES_SCHEMA_VERSION;
    record.sprites = section;
    schema.sprites = SPRITES_SCHEMA_VERSION;
  } else if (current !== null) {
    record.sprites = section;
  }
}

function migrationInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) shapeError(`the snapshot's ${field} must be a safe integer`);
  return value;
}

function migrateActorProgression(actor: Record<string, unknown>, index: number): void {
  const stats = recordAt(actor.stats, `actors.actors[${index}].stats`) as unknown as ActorStats;
  const old = recordAt(actor.progression, `actors.actors[${index}].progression`);
  const fields = ["levelType", "experienceIncrease", "maxLevel", "levelHp", "levelDp", "levelFp", "levelSm", "levelUpType"] as const;
  const policy = Object.fromEntries(fields.map((field) => [field, migrationInteger(old[field], `actors.actors[${index}].progression.${field}`)])) as unknown as ActorProgression;
  let nextRequirement = policy.levelType;
  let remainingExperience = nextRequirement - migrationInteger(stats.experience, `actors.actors[${index}].stats.experience`);
  const level = migrationInteger(stats.level, `actors.actors[${index}].stats.level`);
  for (let priorLevel = 1; priorLevel < level; priorLevel += 1) {
    const product = nextRequirement * policy.experienceIncrease;
    if (!Number.isSafeInteger(product)) shapeError(`the snapshot's actors.actors[${index}] progression threshold is unsafe`);
    nextRequirement = policy.levelUpType === 0
      ? nextRequirement + Math.trunc(product / 100)
      : nextRequirement + policy.experienceIncrease;
    if (!Number.isSafeInteger(nextRequirement)) shapeError(`the snapshot's actors.actors[${index}] progression threshold is unsafe`);
    remainingExperience += nextRequirement;
    if (!Number.isSafeInteger(remainingExperience)) shapeError(`the snapshot's actors.actors[${index}] remaining experience is unsafe`);
  }
  const migrated = {
    ...old,
    ...policy,
    remainingExperience: Math.max(0, remainingExperience),
    nextRequirement,
    // Version 1 did not persist whether a source legacy program was present.
    legacyLevelUp: null,
  };
  try {
    validateActorProgression(stats, migrated);
  } catch {
    shapeError(`the snapshot's actors.actors[${index}] has invalid progression`);
  }
  actor.progression = migrated;
}

/** Migrate actor records while retaining their saved identity and state. */
function migrateActors(record: Record<string, unknown>, schema: Record<string, unknown>): void {
  const version = schema.actors;
  if (version === undefined) {
    record.actors = createActorsSection();
    schema.actors = ACTORS_SCHEMA_VERSION;
    return;
  }
  if (typeof version !== "number") shapeError("the snapshot's `schema` has no numeric `actors` version");
  if (version > ACTORS_SCHEMA_VERSION) shapeError(`the snapshot's actors schema version ${String(version)} is newer than supported version ${ACTORS_SCHEMA_VERSION}`);
  if (version === ACTORS_SCHEMA_VERSION) return;
  if (version !== 1) shapeError(`the snapshot's actors schema version ${String(version)} has no migration`);
  const section = recordAt(record.actors, "actors");
  if (section.version !== 1 || !Array.isArray(section.actors)) shapeError("the snapshot's actors section is not a version-1 actor section");
  for (const [index, value] of section.actors.entries()) {
    if (!isRecord(value)) shapeError(`the snapshot's actors.actors[${index}] is not an object`);
    migrateActorProgression(value, index);
  }
  section.version = ACTORS_SCHEMA_VERSION;
  schema.actors = ACTORS_SCHEMA_VERSION;
  record.actors = section;
}

/** Migrate the old empty trigger placeholder to the activation-state schema. */
function migrateTriggers(record: Record<string, unknown>, schema: Record<string, unknown>): void {
  const version = schema.triggers;
  if (typeof version !== "number") shapeError("the snapshot's `schema` has no numeric `triggers` version");
  if (version >= TRIGGERS_SCHEMA_VERSION) return;
  const current = record.triggers;
  if (typeof current !== "object" || current === null || Array.isArray(current) || Object.keys(current).length === 0) {
    record.triggers = createTriggersSection();
  } else {
    record.triggers = { ...createTriggersSection(), ...(current as Record<string, unknown>), version: TRIGGERS_SCHEMA_VERSION };
  }
  schema.triggers = TRIGGERS_SCHEMA_VERSION;
}

/** Migrate the raw input section to the binding-aware schema. */
function migrateInput(record: Record<string, unknown>, schema: Record<string, unknown>): void {
  const version = schema.input;
  if (typeof version !== "number") shapeError("the snapshot's `schema` has no numeric `input` version");
  if (version >= INPUT_SCHEMA_VERSION) return;
  const old = record.input;
  if (typeof old !== "object" || old === null || Array.isArray(old)) {
    record.input = createInputSection();
    schema.input = INPUT_SCHEMA_VERSION;
    return;
  }
  const oldRecord = old as Record<string, unknown>;
  const current = createInputSection();
  if (typeof oldRecord.nextSeq === "number") current.nextSeq = oldRecord.nextSeq;
  if (Array.isArray(oldRecord.keys)) current.keys = oldRecord.keys as typeof current.keys;
  if (typeof oldRecord.held === "object" && oldRecord.held !== null && !Array.isArray(oldRecord.held)) current.held = oldRecord.held as typeof current.held;
  if (typeof oldRecord.pointer === "object" && oldRecord.pointer !== null && !Array.isArray(oldRecord.pointer)) current.pointer = oldRecord.pointer as typeof current.pointer;
  if (typeof oldRecord.focused === "boolean") current.focused = oldRecord.focused;
  record.input = current;
  schema.input = INPUT_SCHEMA_VERSION;
}

/** Migrate the empty audio placeholder (schema 1) to the track-and-voice section (schema 2; docs/spec/engine/audio-media.md#audio-state). */
function migrateAudio(record: Record<string, unknown>, schema: Record<string, unknown>): void {
  const version = schema.audio;
  if (typeof version !== "number") shapeError("the snapshot's `schema` has no numeric `audio` version");
  if (version >= SCHEMA_VERSIONS.audio) return;
  record.audio = createAudioSection();
  schema.audio = SCHEMA_VERSIONS.audio;
}

function shapeError(message: string): never {
  throw new ScriptError("restore.shape", message);
}

function recordAt(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return shapeError(`the snapshot's ${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function arrayAt(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) return shapeError(`the snapshot's ${path} must be an array`);
  return value;
}

function stringAt(value: unknown, path: string): string {
  if (typeof value !== "string") return shapeError(`the snapshot's ${path} must be a string`);
  return value;
}

function numberAt(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    return shapeError(`the snapshot's ${path} must be a finite whole number`);
  }
  return value;
}

function nullableRecord(value: unknown, path: string): Record<string, unknown> | null {
  if (value === null) return null;
  return recordAt(value, path);
}
function validateNativeData(value: unknown, path: string): void {
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) shapeError(`the snapshot's ${path} must be finite`);
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) validateNativeData(entry, `${path}[${index}]`);
    return;
  }
  const record = recordAt(value, path);
  for (const [name, entry] of Object.entries(record)) validateNativeData(entry, `${path}.${name}`);
}


function validateProgramRef(value: unknown, path: string): void {
  const ref = recordAt(value, path);
  const kind = stringAt(ref.kind, `${path}.kind`);
  if (kind !== "inline" && kind !== "file") return shapeError(`the snapshot's ${path}.kind is invalid`);
  stringAt(ref.compiler, `${path}.compiler`);
  if (kind === "inline") stringAt(ref.text, `${path}.text`);
  else {
    stringAt(ref.path, `${path}.path`);
    stringAt(ref.sourceHash, `${path}.sourceHash`);
  }
  if (ref.owner !== undefined) {
    if (typeof ref.owner !== "string" || ref.owner === "") shapeError(`the snapshot's ${path}.owner must be a non-empty package name`);
  }
  if (ref.includes !== undefined) {
    for (const [index, item] of arrayAt(ref.includes, `${path}.includes`).entries()) {
      stringAt(item, `${path}.includes[${index}]`);
    }
  }
  if (ref.redirects !== undefined) {
    for (const [index, pair] of arrayAt(ref.redirects, `${path}.redirects`).entries()) {
      const values = arrayAt(pair, `${path}.redirects[${index}]`);
      if (values.length !== 2) return shapeError(`the snapshot's ${path}.redirects[${index}] must have two items`);
      stringAt(values[0], `${path}.redirects[${index}][0]`);
      stringAt(values[1], `${path}.redirects[${index}][1]`);
    }
  }
}

function validateVmShape(vm: Record<string, unknown>): void {
  for (const key of ["threads", "objects", "redirects", "files", "effects"] as const) arrayAt(vm[key], `vm.${key}`);
  recordAt(vm.globals, "vm.globals");
  numberAt(vm.effectSeq, "vm.effectSeq");
  numberAt(vm.requestSeq, "vm.requestSeq");
  nullableRecord(vm.block, "vm.block");
  if (vm.messagesOff !== undefined && vm.messagesOff !== true) shapeError("the snapshot's vm.messagesOff is invalid");
  if (vm.stepCounters !== undefined) {
    const counters = recordAt(vm.stepCounters, "vm.stepCounters");
    for (const [owner, count] of Object.entries(counters)) {
      if (owner === "" || typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
        shapeError(`the snapshot's vm.stepCounters.${owner} must be a non-negative whole number`);
      }
    }
  }
  for (const [index, threadValue] of arrayAt(vm.threads, "vm.threads").entries()) {
    const thread = recordAt(threadValue, `vm.threads[${index}]`);
    numberAt(thread.id, `vm.threads[${index}].id`);
    if (!["blocking", "board", "persistent", "item"].includes(stringAt(thread.kind, `vm.threads[${index}].kind`))) {
      shapeError(`the snapshot's vm.threads[${index}].kind is invalid`);
    }
    if (!["script", "world"].includes(stringAt(thread.owner, `vm.threads[${index}].owner`))) {
      shapeError(`the snapshot's vm.threads[${index}].owner is invalid`);
    }
    if (thread.source !== null) stringAt(thread.source, `vm.threads[${index}].source`);
    if (thread.target !== null) stringAt(thread.target, `vm.threads[${index}].target`);
    if (!["ready", "waiting", "finished"].includes(stringAt(thread.status, `vm.threads[${index}].status`))) {
      shapeError(`the snapshot's vm.threads[${index}].status is invalid`);
    }
    nullableRecord(thread.wait, `vm.threads[${index}].wait`);
    arrayAt(thread.queue, `vm.threads[${index}].queue`);
    nullableRecord(thread.pending, `vm.threads[${index}].pending`);
    arrayAt(thread.detached, `vm.threads[${index}].detached`);
    if (thread.collect !== null) arrayAt(thread.collect, `vm.threads[${index}].collect`);
    for (const [frameIndex, frameValue] of arrayAt(thread.frames, `vm.threads[${index}].frames`).entries()) {
      const frame = recordAt(frameValue, `vm.threads[${index}].frames[${frameIndex}]`);
      validateProgramRef(frame.program, `vm.threads[${index}].frames[${frameIndex}].program`);
      numberAt(frame.ip, `vm.threads[${index}].frames[${frameIndex}].ip`);
      recordAt(frame.locals, `vm.threads[${index}].frames[${frameIndex}].locals`);
      arrayAt(frame.operands, `vm.threads[${index}].frames[${frameIndex}].operands`);
      if (frame.errorHandler !== null) recordAt(frame.errorHandler, `vm.threads[${index}].frames[${frameIndex}].errorHandler`);
      if (typeof frame.autoLocal !== "boolean") shapeError(`the snapshot's vm.threads[${index}].frames[${frameIndex}].autoLocal is invalid`);
    }
  }
  validateVmObjects(vm);
  validateVmHandles(vm);
}

/**
 * The records of the handle table (OOP-10; entries 19.3 and 19.5): every object,
 * a dictionary and a class instance alike, has the one shape. The `handle`s are
 * distinct whole numbers, `keys` names each member exactly once, and `program` is
 * a program reference exactly when the record has a class (`className` is not `""`).
 * A record in the shape saved before entry 19.5 (a class instance with no `keys`)
 * is refused here: no step migrates it.
 */
function validateVmObjects(vm: Record<string, unknown>): void {
  const handles = new Set<number>();
  for (const [index, value] of arrayAt(vm.objects, "vm.objects").entries()) {
    const path = `vm.objects[${index}]`;
    const record = recordAt(value, path);
    const handle = numberAt(record.handle, `${path}.handle`);
    if (handle < 1 || handles.has(handle)) shapeError(`the snapshot's ${path}.handle is not a distinct positive handle`);
    handles.add(handle);
    if (typeof record.hostType !== "undefined" && (typeof record.hostType !== "string" || record.hostType === "")) {
      shapeError(`the snapshot's ${path}.hostType must be a non-empty string when present`);
    }
    if (stringAt(record.className, `${path}.className`) === "") {
      if (record.program !== null) shapeError(`the snapshot's ${path}.program must be null on an object with no class`);
    } else {
      validateProgramRef(record.program, `${path}.program`);
    }
    const keys = arrayAt(record.keys, `${path}.keys`);
    const members = recordAt(record.members, `${path}.members`);
    const listed = new Set<string>();
    for (const [at, key] of keys.entries()) listed.add(stringAt(key, `${path}.keys[${at}]`));
    const names = Object.keys(members);
    if (listed.size !== keys.length || names.length !== keys.length || !names.every((name) => listed.has(name))) {
      shapeError(`the snapshot's ${path}.keys does not list its members exactly once each`);
    }
  }
}

/** A typed restore failure whose message names the place in the save (entry 18.6). */
function restoreError(code: string, message: string): never {
  throw new ScriptError(code, `the snapshot's ${message}`);
}

/**
 * Check one script value at `path` (FUN-8; entry 18.6): a number, a string, null, an
 * object handle or a whole callable record, and a callable's `captures` all name
 * cells that exist. A malformed callable is `restore.callable-malformed`; a
 * missing cell is `restore.cell-missing`; any other value is `restore.shape`.
 */
function checkValue(path: string, value: unknown, cells: Readonly<Record<string, unknown>>): void {
  if (value === null || typeof value === "number" || typeof value === "string") return;
  if (!isRecord(value)) {
    return shapeError(`the snapshot's ${path} is not a script value (a number, a string, null, an object handle or a callable)`);
  }
  if (value.kind === "object") {
    if (!Number.isInteger(value.handle) || typeof value.className !== "string" || Object.keys(value).length !== 3) {
      shapeError(`the snapshot's ${path} is not a whole object handle`);
    }
    return;
  }
  if (value.type !== "callable") {
    return shapeError(`the snapshot's ${path} is not a script value (a number, a string, null, an object handle or a callable)`);
  }
  const { def, captures, receiver, owner } = value;
  const keyShape = Object.keys(value).sort().join(",");
  if (
    (keyShape !== "captures,def,receiver,type" && keyShape !== "captures,def,owner,receiver,type") ||
    (owner !== undefined && (typeof owner !== "string" || owner === "")) ||
    typeof def !== "string" ||
    def === "" ||
    !Array.isArray(captures) ||
    !captures.every((entry) => typeof entry === "string") ||
    (receiver !== null && typeof receiver !== "string")
  ) {
    restoreError(
      RESTORE_CALLABLE_MALFORMED,
      `${path} is not a whole callable: it must be { type, def, captures, receiver } with an optional owner package name, a def text, a list of cell ids and a receiver that is text or null`,
    );
  }
  for (const [index, id] of (captures as string[]).entries()) {
    if (id !== "" && !Object.hasOwn(cells, id)) {
      restoreError(RESTORE_CELL_MISSING, `${path}.captures[${index}] names cell "${id}", which is not in vm.cells`);
    }
  }
}

/**
 * The shape check of callable handles and closure cells (FUN-8; entry 18.6),
 * which needs no compiled program: `vm.cells` and `vm.cellSeq` agree and no id
 * is above the counter, every value and `vm.defOwners` entry is whole, and every
 * cell a handle, a frame slot, an operand or a wait names is in `vm.cells`.
 * The checks that need the compiled programs are `verifyRestoredHandles`.
 */
function validateVmHandles(vm: Record<string, unknown>): void {
  const cells = vm.cells;
  const seq = vm.cellSeq;
  if (cells === undefined) {
    if (seq !== undefined) restoreError(RESTORE_CELL_SEQ, "vm.cellSeq is present but vm.cells is not");
  } else {
    if (!isRecord(cells)) return shapeError("the snapshot's vm.cells must be an object");
    if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0) {
      restoreError(RESTORE_CELL_SEQ, "vm.cellSeq must be a whole number of at least 0 beside vm.cells");
    }
    for (const id of Object.keys(cells)) {
      const number = cellNumber(id);
      if (number === null) {
        restoreError(RESTORE_CELL_SEQ, `vm.cells has the id "${id}", which is not a cell id (cell1, cell2, …)`);
      }
      if (number > seq) {
        restoreError(
          RESTORE_CELL_SEQ,
          `vm.cells.${id} is above vm.cellSeq ${seq}, so a later cell would be issued the id of an existing cell`,
        );
      }
    }
  }
  const table: Readonly<Record<string, unknown>> = isRecord(cells) ? cells : {};
  if (vm.defOwners !== undefined) {
    const owners = recordAt(vm.defOwners, "vm.defOwners");
    for (const def of Object.keys(owners)) validateProgramRef(owners[def], `vm.defOwners.${def}`);
  }
  for (const id of Object.keys(table)) checkValue(`vm.cells.${id}`, table[id], table);
  eachRootValue(
    vm,
    (path, value) => checkValue(path, value, table),
    (path, ref) => {
      const id = cellIdOfRef(ref);
      if (id !== null && !Object.hasOwn(table, id)) {
        restoreError(RESTORE_CELL_MISSING, `${path} names cell "${id}", which is not in vm.cells`);
      }
    },
  );
}

/** A save made before the `events` section existed loads with the empty section (EMIT-15); nothing else moves. */
function migrateEvents(record: Record<string, unknown>, schema: Record<string, unknown>): void {
  if (record.events !== undefined || schema.events !== undefined) return;
  record.events = createEventsSection();
  schema.events = SCHEMA_VERSIONS.events;
}

/**
 * The `events` section's shape (EMIT-15; entry 19.10): the listener table, the queue
 * and the dispatch cursor are whole, every id is distinct and below `nextListener`,
 * every event handle names a live object, every listener is a whole callable whose
 * cells exist, and the cursor's list, position and thread agree. Whether a listener's
 * definition still exists needs the compiled programs, which is `verifyRestoredHandles`.
 */
function validateEventsShape(value: unknown, vm: Record<string, unknown>): void {
  const events = recordAt(value, "events");
  const next = numberAt(events.nextListener, "events.nextListener");
  if (next < 1) shapeError("the snapshot's events.nextListener must be at least 1");
  if (events.audioPasses !== undefined) {
    const passes = recordAt(events.audioPasses, "events.audioPasses");
    for (const [cue, pass] of Object.entries(passes)) {
      if (!Number.isSafeInteger(Number(cue)) || Number(cue) < 1 || String(Number(cue)) !== cue) {
        shapeError(`the snapshot's events.audioPasses.${cue} must name a positive cue id`);
      }
      if (typeof pass !== "number" || !Number.isSafeInteger(pass) || pass < 0) {
        shapeError(`the snapshot's events.audioPasses.${cue} must be a non-negative pass number`);
      }
    }
  }
  const objects = new Set<number>();
  for (const object of arrayAt(vm.objects, "vm.objects")) objects.add(numberAt(recordAt(object, "vm.objects[]").handle, "vm.objects[].handle"));
  const threads = new Set<number>();
  for (const thread of arrayAt(vm.threads, "vm.threads")) threads.add(numberAt(recordAt(thread, "vm.threads[]").id, "vm.threads[].id"));
  const cells = isRecord(vm.cells) ? vm.cells : {};
  const ids = new Set<number>();
  for (const [index, listenerValue] of arrayAt(events.listeners, "events.listeners").entries()) {
    const path = `events.listeners[${index}]`;
    const listener = recordAt(listenerValue, path);
    const id = numberAt(listener.id, `${path}.id`);
    if (id < 1 || id >= next || ids.has(id)) shapeError(`the snapshot's ${path}.id is not a distinct id below events.nextListener`);
    ids.add(id);
    stringAt(listener.emitter, `${path}.emitter`);
    stringAt(listener.type, `${path}.type`);
    if (typeof listener.once !== "boolean") shapeError(`the snapshot's ${path}.once must be a boolean`);
    if (!isRecord(listener.callable) || listener.callable.type !== "callable") {
      shapeError(`the snapshot's ${path}.callable must be a callable`);
    }
    checkValue(`${path}.callable`, listener.callable, cells);
  }
  const liveEvent = (handle: unknown, path: string): void => {
    if (!objects.has(numberAt(handle, path))) shapeError(`the snapshot's ${path} names no live object handle`);
  };
  for (const [index, queuedValue] of arrayAt(events.queue, "events.queue").entries()) {
    const queued = recordAt(queuedValue, `events.queue[${index}]`);
    stringAt(queued.emitter, `events.queue[${index}].emitter`);
    liveEvent(queued.event, `events.queue[${index}].event`);
  }
  if (events.nativeDetails !== undefined) {
    const nativeDetails = recordAt(events.nativeDetails, "events.nativeDetails");
    for (const [rawHandle, detailValue] of Object.entries(nativeDetails)) {
      const path = `events.nativeDetails.${rawHandle}`;
      const handle = Number(rawHandle);
      if (!Number.isSafeInteger(handle) || handle < 1) shapeError(`the snapshot's ${path} must name a positive event handle`);
      liveEvent(handle, path);
      const detail = recordAt(detailValue, path);
      for (const [name, entry] of Object.entries(detail)) validateNativeData(entry, `${path}.${name}`);
    }
  }
  for (const [index, threadValue] of arrayAt(vm.threads, "vm.threads").entries()) {
    const wait = recordAt(threadValue, `vm.threads[${index}]`).wait;
    if (!isRecord(wait) || wait.kind !== EVENT_DISPATCH_WAIT) continue;
    liveEvent(arrayAt(wait.payload, `vm.threads[${index}].wait.payload`)[0], `vm.threads[${index}].wait.payload[0]`);
  }
  if (events.emitters !== undefined) {
    const registered = new Set<number>();
    for (const [key, handle] of Object.entries(recordAt(events.emitters, "events.emitters"))) {
      liveEvent(handle, `events.emitters.${key}`);
      if (registered.has(handle as number)) shapeError(`the snapshot's events.emitters.${key} names a handle another key already names`);
      registered.add(handle as number);
    }
  }
  if (events.retiring !== undefined) {
    const retiring = arrayAt(events.retiring, "events.retiring");
    if (!isRecord(events.emitters)) shapeError("the snapshot's events.retiring requires registered emitters");
    const seen = new Set<string>();
    for (const [index, value] of retiring.entries()) {
      stringAt(value, `events.retiring[${index}]`);
      const key = value as string;
      if (seen.has(key)) shapeError(`the snapshot's events.retiring[${index}] repeats an emitter`);
      seen.add(key);
      if (!Object.hasOwn(events.emitters, key)) shapeError(`the snapshot's events.retiring[${index}] names no registered emitter`);
    }
  }
  if (events.dispatch === null) return;
  const dispatch = recordAt(events.dispatch, "events.dispatch");
  stringAt(dispatch.emitter, "events.dispatch.emitter");
  liveEvent(dispatch.event, "events.dispatch.event");
  const order = arrayAt(dispatch.order, "events.dispatch.order");
  for (const [index, id] of order.entries()) {
    const listed = numberAt(id, `events.dispatch.order[${index}]`);
    if (listed < 1 || listed >= next) shapeError(`the snapshot's events.dispatch.order[${index}] is not an id below events.nextListener`);
  }
  const position = numberAt(dispatch.index, "events.dispatch.index");
  if (position < 0 || position > order.length) shapeError("the snapshot's events.dispatch.index is outside events.dispatch.order");
  if (dispatch.thread !== null) {
    if (!threads.has(numberAt(dispatch.thread, "events.dispatch.thread"))) shapeError("the snapshot's events.dispatch.thread names no thread");
    if (position >= order.length) shapeError("the snapshot's events.dispatch.index must name a listener while a thread runs");
  }
}

function validateSurfacesShape(value: unknown): void {
  const surfaces = recordAt(value, "surfaces");
  if (Object.keys(surfaces).length === 0) return;
  const nextId = numberAt(surfaces.nextId, "surfaces.nextId");
  if (nextId < 1) shapeError("the snapshot's surfaces.nextId must be positive");
  const entries = recordAt(surfaces.entries, "surfaces.entries");
  for (const rawId of Object.keys(entries)) {
    const item = recordAt(entries[rawId], `surfaces.entries.${rawId}`);
    numberAt(item.id, `surfaces.entries.${rawId}.id`);
    numberAt(item.rev, `surfaces.entries.${rawId}.rev`);
    const bitmap = recordAt(item.bitmap, `surfaces.entries.${rawId}.bitmap`);
    if (bitmap.t !== "rgba") shapeError(`the snapshot's surfaces.entries.${rawId}.bitmap.t must be "rgba"`);
    numberAt(bitmap.w, `surfaces.entries.${rawId}.bitmap.w`);
    numberAt(bitmap.h, `surfaces.entries.${rawId}.bitmap.h`);
    stringAt(bitmap.b64, `surfaces.entries.${rawId}.bitmap.b64`);
  }
  const slots = recordAt(surfaces.slots, "surfaces.slots");
  for (const slot of Object.keys(slots)) numberAt(slots[slot], `surfaces.slots.${slot}`);
  const colours = recordAt(surfaces.colours, "surfaces.colours");
  for (const colour of Object.keys(colours)) numberAt(colours[colour], `surfaces.colours.${colour}`);
}

function validateSpritesShape(value: unknown): void {
  const sprites = asSpritesSection(value);
  if (sprites === null || sprites.version !== SPRITES_SCHEMA_VERSION) shapeError("the snapshot's `sprites` section has an invalid schema");
}

function validateActorsShape(value: unknown): void {
  const actors = asActorsSection(value);
  if (actors === null || actors.version !== ACTORS_SCHEMA_VERSION) shapeError("the snapshot's `actors` section has an invalid schema");
}

function validateTriggersShape(value: unknown): void {
  const triggers = recordAt(value, "triggers");
  if (numberAt(triggers.version, "triggers.version") !== TRIGGERS_SCHEMA_VERSION) {
    shapeError("the snapshot's `triggers` section has an invalid schema");
  }
  arrayAt(triggers.suppressed, "triggers.suppressed");
  arrayAt(triggers.deactivated, "triggers.deactivated");
  recordAt(triggers.fired, "triggers.fired");
  recordAt(triggers.repeat, "triggers.repeat");
}

/** One fade descriptor or `null` (docs/spec/engine/audio-media.md#audio-state). */
function validateAudioFade(value: unknown, path: string): void {
  if (value === null) return;
  const fade = recordAt(value, path);
  for (const key of ["fromVolume", "targetVolume", "startTick", "durationTicks"]) numberAt(fade[key], `${path}.${key}`);
}

function validateNullableNumber(value: unknown, path: string): void {
  if (value !== null) numberAt(value, path);
}

/** The `audio` section's shape, schema v2 (docs/spec/engine/audio-media.md#audio-state). */
function validateAudioShape(value: unknown): void {
  const audio = recordAt(value, "audio");
  if (numberAt(audio.schema, "audio.schema") !== AUDIO_SCHEMA_VERSION) shapeError(`the snapshot's audio.schema must be ${AUDIO_SCHEMA_VERSION}`);
  if (numberAt(audio.cueId, "audio.cueId") < 1) shapeError("the snapshot's audio.cueId must be at least 1");
  if (audio.soundFont !== null) stringAt(audio.soundFont, "audio.soundFont");
  for (const [index, trackValue] of arrayAt(audio.tracks, "audio.tracks").entries()) {
    const path = `audio.tracks[${index}]`;
    const track = recordAt(trackValue, path);
    stringAt(track.name, `${path}.name`);
    if (numberAt(track.voiceCount, `${path}.voiceCount`) < 1) shapeError(`the snapshot's ${path}.voiceCount must be at least 1`);
    if (!["stopped", "playing", "paused"].includes(stringAt(track.state, `${path}.state`))) shapeError(`the snapshot's ${path}.state is invalid`);
    numberAt(track.flags, `${path}.flags`);
    numberAt(track.positionTicks, `${path}.positionTicks`);
    if (track.file !== null) stringAt(track.file, `${path}.file`);
    validateNullableNumber(track.lengthTicks, `${path}.lengthTicks`);
    validateAudioFade(track.fade, `${path}.fade`);
    for (const [voiceIndex, voiceValue] of arrayAt(track.voices, `${path}.voices`).entries()) {
      const voicePath = `${path}.voices[${voiceIndex}]`;
      const voice = recordAt(voiceValue, voicePath);
      for (const key of ["index", "cueId", "priority", "volume", "startTick", "positionTicks"]) numberAt(voice[key], `${voicePath}.${key}`);
      if (!["playing", "paused"].includes(stringAt(voice.state, `${voicePath}.state`))) shapeError(`the snapshot's ${voicePath}.state is invalid`);
      stringAt(voice.file, `${voicePath}.file`);
      if (typeof voice.loop !== "boolean") shapeError(`the snapshot's ${voicePath}.loop must be a boolean`);
      for (const key of ["lengthTicks", "endTick", "pausedTick"]) validateNullableNumber(voice[key], `${voicePath}.${key}`);
      validateAudioFade(voice.fade, `${voicePath}.fade`);
    }
  }
  const settings = recordAt(audio.settings, "audio.settings");
  numberAt(settings.masterVolume, "audio.settings.masterVolume");
  for (const [index, entryValue] of arrayAt(settings.trackVolumes, "audio.settings.trackVolumes").entries()) {
    const path = `audio.settings.trackVolumes[${index}]`;
    const entry = recordAt(entryValue, path);
    stringAt(entry.name, `${path}.name`);
    numberAt(entry.volume, `${path}.volume`);
    validateAudioFade(entry.fade, `${path}.fade`);
  }
}
function validateShape(record: Record<string, unknown>): void {
  const schema = recordAt(record.schema, "schema");
  for (const key of Object.keys(SCHEMA_VERSIONS)) numberAt(schema[key], `schema.${key}`);
  stringAt(schema.compiler, "schema.compiler");
  for (const key of Object.keys(SCHEMA_VERSIONS)) {
    if (key === "schema" || key === "vm" || key === "rng" || key === "time") continue;
    if (key === "battle") {
      if (record.battle !== null) recordAt(record[key], key);
      continue;
    }
    recordAt(record[key], key);
    if (key === "sprites") validateSpritesShape(record[key]);
    if (key === "actors") validateActorsShape(record[key]);
    if (key === "triggers") validateTriggersShape(record[key]);
    if (key === "audio") validateAudioShape(record[key]);
  }
  const rng = recordAt(record.rng, "rng");
  for (const key of ["s0", "s1", "s2", "s3"]) numberAt(rng[key], `rng.${key}`);
  numberAt(recordAt(record.time, "time").tick, "time.tick");
  validateVmShape(recordAt(record.vm, "vm"));
  validateEventsShape(record.events, recordAt(record.vm, "vm"));
  validateSurfacesShape(record.surfaces);
}

/** Parse and check a snapshot's canonical form (see the file header). */
export function restoreGameState(json: string, diagnostics: Diagnostic[] = []): GameState {
  let parsed: unknown;
  try {
    parsed = reviveNonFinite(JSON.parse(json));
  } catch {
    throw new ScriptError("restore.shape", "a snapshot must be valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ScriptError("restore.shape", "a snapshot must be a JSON object");
  }
  const record = parsed as Record<string, unknown>;

  const schema = record.schema;
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    throw new ScriptError("restore.shape", "the snapshot has no `schema` section");
  }
  const compiler = (schema as Record<string, unknown>).compiler;
  if (compiler !== COMPILER_VERSION) {
    throw new ScriptError(
      "restore.compiler-mismatch",
      `the snapshot's compiler ${String(compiler)} does not match ${COMPILER_VERSION}`,
    );
  }

  migrateEvents(record, schema as Record<string, unknown>);
  migrateActors(record, schema as Record<string, unknown>);
  validateActorsShape(record.actors);
  migrateBattle(record, schema as Record<string, unknown>);
  migrateMenuSections(record, schema as Record<string, unknown>);
  for (const key of Object.keys(SCHEMA_VERSIONS)) {
    if (!Object.hasOwn(record, key)) {
      throw new ScriptError("restore.shape", `the snapshot is missing the "${key}" section`);
    }
  }

  migrateVm(record, schema as Record<string, unknown>);
  migrateSprites(record, schema as Record<string, unknown>);
  migrateInput(record, schema as Record<string, unknown>);
  migrateTriggers(record, schema as Record<string, unknown>);
  migrateAudio(record, schema as Record<string, unknown>);
  const battleIssues = validateBattleSection(record.battle, record.actors as GameState["actors"]);
  for (const issue of battleIssues) {
    if (issue.recoverable) {
      diagnostics.push({ code: "restore.battle-fighter", file: "battle", line: 0, message: `${issue.path}: ${issue.message}` });
    } else {
      shapeError(`the snapshot's ${issue.path} ${issue.message}`);
    }
  }
  validateShape(record);
  return parsed as GameState;
}
