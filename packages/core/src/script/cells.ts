/**
 * Closure cells and the places a script value lives (FUN-8; ADR 0004 decision 8;
 * entry 18.6, docs/spec/engine/rpgcode-language.md#keywords-and-structure).
 *
 * `vm.cells` holds the private storage of the closures, by id, and a callable
 * value names its cells in `captures`. Four things need to know where a value
 * or a cell reference can sit in the `vm` section, so they share one walker,
 * `eachRootValue`: the cell collector below, the load-time shape check
 * (`core/save/handles.ts`) and the program-aware check (`restore-check.ts`).
 *
 * Everything here is a plain function over plain data (G1) with no clock, no
 * randomness and no iteration order the language leaves open (G3).
 */

import type { CallableValue, Value } from "../ports/value.ts";
import { fnv1a64 } from "../canon/fnv1a.ts";
import { programKey, type ProgramRef } from "./program.ts";
import type { VmState } from "./state.ts";

/** The text of a cell reference's scope, `cell:<id>` (see `cellRef`). */
const CELL_REF_PREFIX = "cell:";

/** The id a cell number is written as: `cell` and a positive whole number with no leading zero. */
const CELL_ID = /^cell[1-9][0-9]*$/;

/** The cell number of `id` (`cell12` is 12), or `null` when `id` is not an id the VM issues. */
export function cellNumber(id: string): number | null {
  if (!CELL_ID.test(id)) return null;
  const number = Number(id.slice(4));
  return Number.isSafeInteger(number) ? number : null;
}

/** The cell id a `cell:<id>` reference names, or `null` when `ref` is not one. */
export function cellIdOfRef(ref: unknown): string | null {
  return typeof ref === "string" && ref.startsWith(CELL_REF_PREFIX) ? ref.slice(CELL_REF_PREFIX.length) : null;
}

/** Whether `value` is a plain JSON object (not `null`, not an array); its fields stay `unknown`. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether `value`, which may be a raw parsed snapshot value, is a callable record
 * with the two fields the cell walkers read, a `def` text and a `captures` list.
 * The load-time shape check has already refused anything less whole.
 */
export function isCallableRecord(value: unknown): value is CallableValue {
  return (
    isRecord(value) &&
    value.type === "callable" &&
    typeof value.def === "string" &&
    Array.isArray(value.captures)
  );
}

/**
 * Visit every place outside the cell table where a script `Value` or a
 * variable reference sits in a `vm` section, with the path that names the place
 * (`vm.threads[0].frames[1].locals.n.value`). These are the roots a cell is
 * reached from: the globals, the members of every object, and each frame's
 * locals, operands and return value, plus a wait's resume references and
 * stored reply. `vm.cells` is not visited: a cell's value is reached only
 * through the cell.
 *
 * It reads a state that may be a raw parsed snapshot, so it skips whatever is
 * not the expected container instead of throwing; the shape check reports it.
 */
export function eachRootValue(
  vm: Readonly<Record<string, unknown>>,
  onValue: (path: string, value: unknown) => void,
  onRef: (path: string, ref: unknown) => void,
): void {
  walkRoots(vm, onValue, onRef, true, true);
}

/**
 * The same walk without the members of the objects: the places a running script
 * reaches an object from (R-34, entry 19.5), where the members of an object count
 * only once the object itself is reached. It runs every tick, so it names no place:
 * every `path` it passes is `""`.
 */
export function eachLiveRoot(
  vm: Readonly<Record<string, unknown>>,
  onValue: (path: string, value: unknown) => void,
  onRef: (path: string, ref: unknown) => void,
): void {
  walkRoots(vm, onValue, onRef, false, false);
}

function walkRoots(
  vm: Readonly<Record<string, unknown>>,
  onValue: (path: string, value: unknown) => void,
  onRef: (path: string, ref: unknown) => void,
  objectMembers: boolean,
  paths: boolean,
): void {
  const table = (base: string, entries: unknown): void => {
    if (!isRecord(entries)) return;
    for (const name of Object.keys(entries)) onValue(paths ? `${base}.${name}` : "", entries[name]);
  };
  table("vm.globals", vm.globals);
  if (objectMembers && Array.isArray(vm.objects)) {
    vm.objects.forEach((record: unknown, index) => {
      if (isRecord(record)) table(`vm.objects[${index}].members`, record.members);
    });
  }
  if (!Array.isArray(vm.threads)) return;
  vm.threads.forEach((thread: unknown, threadIndex) => {
    if (!isRecord(thread)) return;
    const base = paths ? `vm.threads[${threadIndex}]` : "";
    const wait = thread.wait;
    if (isRecord(wait)) {
      if (Array.isArray(wait.resumeRefs)) {
        wait.resumeRefs.forEach((ref: unknown, index) => onRef(paths ? `${base}.wait.resumeRefs[${index}]` : "", ref));
      }
      if (isRecord(wait.reply) && Object.hasOwn(wait.reply, "value")) {
        onValue(paths ? `${base}.wait.reply.value` : "", wait.reply.value);
      }
      if (wait.kind === "audio.track" && Array.isArray(wait.payload)) {
        // Return value and pending-start voice are both saveable object roots.
        for (let index = 1; index < wait.payload.length; index += 1) {
          onValue(paths ? `${base}.wait.payload[${index}]` : "", wait.payload[index]);
        }
      }
    }
    if (!Array.isArray(thread.frames)) return;
    thread.frames.forEach((frame: unknown, frameIndex) => {
      if (!isRecord(frame)) return;
      const at = paths ? `${base}.frames[${frameIndex}]` : "";
      if (isRecord(frame.locals)) {
        for (const name of Object.keys(frame.locals)) {
          const slot = frame.locals[name];
          if (!isRecord(slot)) continue;
          onValue(paths ? `${at}.locals.${name}.value` : "", slot.value);
          onRef(paths ? `${at}.locals.${name}.ref` : "", slot.ref);
        }
      }
      if (Array.isArray(frame.operands)) {
        frame.operands.forEach((arg: unknown, index) => {
          if (!isRecord(arg)) return;
          onValue(paths ? `${at}.operands[${index}].value` : "", arg.value);
          onRef(paths ? `${at}.operands[${index}].ref` : "", arg.ref);
        });
      }
      if (Object.hasOwn(frame, "returnValue")) onValue(paths ? `${at}.returnValue` : "", frame.returnValue);
    });
  });
}

/**
 * Each reference's cache identity (`programKey`) and `vm.programs` key, computed once per reference
 * object: a program reference is immutable once made, and its identity can be hundreds of kilobytes.
 */
const identities = new WeakMap<object, string>();
const tableKeys = new WeakMap<object, string>();

function identityOf(ref: ProgramRef): string {
  let identity = identities.get(ref);
  if (identity === undefined) {
    identity = programKey(ref);
    identities.set(ref, identity);
  }
  return identity;
}

/**
 * The `vm.programs` key of `ref` (FUN-8; entry 18.6, #2767): the 16-digit FNV-1a 64-bit hash of the
 * program's cache identity, prefixed `<owner>:` when the reference names an owning package. Two
 * references with the same cache identity share a key; a key already taken by another program is
 * resolved by `internProgram`.
 */
export function programTableKey(ref: ProgramRef): string {
  let key = tableKeys.get(ref);
  if (key === undefined) {
    const hash = fnv1a64(identityOf(ref));
    key = ref.owner === undefined ? hash : `${ref.owner}:${hash}`;
    tableKeys.set(ref, key);
  }
  return key;
}

/**
 * Store `ref` once in `programs` and return its key: the key of an entry with the same cache identity
 * when there is one, else the first free key of `programTableKey(ref)`, `~2`, `~3`, … The first
 * reference stored for a program stays.
 */
function internProgram(programs: { [key: string]: ProgramRef }, ref: ProgramRef): string {
  const base = programTableKey(ref);
  for (let n = 1; ; n += 1) {
    const key = n === 1 ? base : `${base}~${n}`;
    if (!Object.hasOwn(programs, key)) {
      Object.defineProperty(programs, key, { value: ref, writable: true, enumerable: true, configurable: true });
      return key;
    }
    const existing = programs[key]!;
    if (existing === ref || identityOf(existing) === identityOf(ref)) return key;
  }
}

/**
 * Record `ref` as the program that owns the definition `def` (FUN-8; entry
 * 18.6), unless one is already recorded: the first owner stays. A callable
 * names its definition only by `def`, and a restore rebuilds only the programs
 * its frames name, so this is what lets it find the program of a callable whose
 * creating program has ended. The reference is stored once in `vm.programs`
 * however many definitions it owns, and `vm.defOwners` maps `def` to its key
 * (#2767). With `replace`, an owner already recorded for `def` is replaced; the
 * entry it named is dropped by the next `collectCells` pass if nothing else names it.
 */
export function recordOwner(vm: VmState, def: string, ref: ProgramRef, replace = false): void {
  const owners = (vm.defOwners ??= {});
  const programs = (vm.programs ??= {});
  if (!replace && Object.hasOwn(owners, def)) return;
  const key = internProgram(programs, ref);
  Object.defineProperty(owners, def, { value: key, writable: true, enumerable: true, configurable: true });
}

/** The recorded owner program of `def` (FUN-8; entry 18.6), or `undefined` when none is recorded. */
export function ownerProgram(vm: VmState, def: string): ProgramRef | undefined {
  const owners = vm.defOwners;
  if (owners === undefined || !Object.hasOwn(owners, def)) return undefined;
  const programs = vm.programs;
  const key = owners[def]!;
  return programs !== undefined && Object.hasOwn(programs, key) ? programs[key] : undefined;
}

/** Drop every `vm.programs` entry that no `vm.defOwners` entry names (#2767). */
export function pruneOwnerPrograms(vm: VmState): void {
  const programs = vm.programs;
  if (programs === undefined) return;
  const named = new Set(Object.values(vm.defOwners ?? {}));
  for (const key of Object.keys(programs)) {
    if (!named.has(key)) delete programs[key];
  }
}

/**
 * Free every closure cell that no script can reach any more, and drop the
 * `vm.defOwners` entry of every definition no reachable callable names (FUN-8;
 * entry 18.6). Run once per tick, just before the object pass, so a cell that
 * only a dead cell's callable named goes with it and an object that only a freed
 * cell named is freed by the same tick's object pass (R-34).
 *
 * A cell is reachable when a root names it — a callable's `captures` entry or a
 * `cell:` reference in a frame slot, an operand or a wait's resume references —
 * or when another reachable cell's value is a callable that captures it.
 * Reachability, not a count, decides it, so a recursive local lambda, whose
 * cell holds a callable that captures that same cell, is freed with nothing
 * outside naming it. `vm.cellSeq` is not touched, so an id is never issued
 * twice. A state with no cell and no `vm.defOwners` is left alone. `roots` are
 * script values kept outside the `vm` section (the listener table of the `events`
 * section, EMIT-14), which count as roots too.
 */
export function collectCells(vm: VmState, roots: readonly unknown[] = []): void {
  const owners = vm.defOwners;
  const cells = vm.cells;
  if (cells === undefined && owners === undefined) return;
  const table: { [id: string]: Value } = cells ?? {};
  const live = new Set<string>();
  const liveDefs = new Set<string>();
  const pending: string[] = [];
  const reach = (id: string | null): void => {
    if (id === null || id === "" || live.has(id) || !Object.hasOwn(table, id)) return;
    live.add(id);
    pending.push(id);
  };
  const visit = (value: unknown): void => {
    if (!isCallableRecord(value)) return;
    liveDefs.add(value.def);
    for (const id of value.captures) reach(id);
  };
  eachRootValue(
    vm,
    (_path, value) => visit(value),
    (_path, ref) => reach(cellIdOfRef(ref)),
  );
  for (const root of roots) visit(root);
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) visit(table[id]);
  for (const id of Object.keys(table)) {
    if (!live.has(id)) delete table[id];
  }
  if (owners !== undefined) {
    for (const def of Object.keys(owners)) {
      if (!liveDefs.has(def)) delete owners[def];
    }
    pruneOwnerPrograms(vm);
  }
}
