/**
 * The effect record: what one built-in call did, as plain data in the `vm`
 * section (ticket 3.21; AD-7/AD-10/AD-11/AD-23; decision U1).
 *
 * Ticket 3.3 gave `ScriptServices` a temporary `effects` sink — a function the
 * VM called with each reported `CommandEffect`. That sink is not state: its
 * records carried no tick, no thread and no sequence, could not be saved or
 * restored, and vanished in a headless run. This module replaces it. A command
 * still never touches game state (AD-8/AD-10); it reports `CommandEffect`s, and
 * the VM stamps each into an `EffectRecord` and appends it to `vm.effects`,
 * where the section owners of later epics drain it (`drainEffects`) and apply
 * the change.
 *
 * The record is exactly the eleven fields the ticket fixes — `{ seq, tick,
 * thread, name, kind, args, out, result, patch, wait, request }` — and stays
 * `PlainData` (G1 rule 2, AD-11): no `undefined`, no `-0`, explicit `null` for
 * an absent value (AD-14). `AssertPlainData<EffectRecord>` proves it at build
 * time.
 *
 * Storage is one list, `vm.effects`, bounded by `EFFECT_LOG_CAP` (a ring: the
 * oldest record is evicted when the list is full), with a strictly monotonic
 * `vm.effectSeq` counter that is never reset — so `canon(save)` stays stable
 * across re-runs (G5).
 *
 * docs/adr/0004; discovery/command-effect-catalogue.md (sections 5–6).
 */

import type { AssertPlainData, PlainData } from "../ports/plain-data.ts";
import type { Wait } from "../ports/wait.ts";
import type { SectionKey } from "../save/state.ts";
import type { CommandRequest } from "./plugin.ts";

/**
 * The catalogue's effect kinds (command-effect-catalogue.md:17-27). A command
 * that only reads is `pure`; one that reports a change to a state section is
 * `state-write` or `draw-audio-cue`; the rest belong to entries 9, 13 and 22
 * and are not stubbed generically.
 */
export type EffectKind =
  | "pure"
  | "state-write"
  | "request"
  | "wait"
  | "spawn-thread"
  | "flow-control"
  | "draw-audio-cue"
  | "mixed"
  | "diagnostic"
  | "emit";

/** How an effect patch indexes into its owning section (command-effect-catalogue.md:580-588). */
export type EffectPatchOp = "set" | "append" | "remove" | "add" | "merge";

/**
 * A change-addressed index into one state section: the section, a path of
 * string segments (numeric indices are decimal strings), the operation and its
 * value. A generic stub has no datum-level target, so it names the section as a
 * whole — `path: []`, `op: "merge"`, `value: null`.
 */
export type EffectPatch = {
  section: SectionKey;
  path: string[];
  op: EffectPatchOp;
  value: PlainData;
};

/**
 * One recorded built-in call. `seq` is strictly monotonic and never reused;
 * `tick` is the injected clock's tick at the call; `thread` is the calling
 * thread's id; `name` is the called (already case-folded) name; `kind` is the
 * catalogue kind; `args` are the supplied argument values; `out` maps each
 * by-reference write-back to its parameter index as a decimal string; `result`
 * is the value the call returned; `patch` names the section it wrote (or
 * `null` for a `pure` getter); `wait` and `request` are `null` for a stub and
 * are entries 9 and 22's.
 */
export type EffectRecord = {
  seq: number;
  tick: number;
  thread: number;
  name: string;
  kind: EffectKind;
  args: PlainData[];
  out: { [index: string]: PlainData };
  result: PlainData;
  patch: EffectPatch | null;
  wait: Wait | null;
  request: CommandRequest | null;
};

/** Build-time proof that an effect record stays plain data (G1 rule 2, AD-11). */
export type EffectRecordIsPlainData = AssertPlainData<EffectRecord>;

/**
 * The bound on `vm.effects`: a long run (or a loop) cannot grow the record list,
 * and therefore the snapshot, without limit. Section owners drain their records
 * each tick; until those epics land this cap is the hard bound.
 */
export const EFFECT_LOG_CAP = 256;

/**
 * Stamp `record` with the next `seq`, append it to `vm.effects`, and evict the
 * oldest records when the list exceeds `EFFECT_LOG_CAP`. `vm.effectSeq` counts
 * every record ever appended (it never resets), so eviction is deterministic
 * and the surviving records keep their monotonic order.
 */
export function recordEffect(vm: EffectState, record: Omit<EffectRecord, "seq">): EffectRecord {
  vm.effectSeq += 1;
  const stamped: EffectRecord = { seq: vm.effectSeq, ...record };
  vm.effects.push(stamped);
  EFFECT_OBSERVERS.get(vm)?.(stamped);
  const excess = vm.effects.length - EFFECT_LOG_CAP;
  if (excess > 0) vm.effects.splice(0, excess);
  return stamped;
}

const EFFECT_OBSERVERS = new WeakMap<object, (record: EffectRecord) => void>();

/**
 * Observe every record produced on `vm`'s effect log at the moment it is produced, before any owner can drain it or
 * the ring can evict it (ADR 0010, effect observer). Observation only. Passing `undefined` detaches. The registry is
 * keyed by the log object, so a host that replaces its state re-attaches to the new log.
 */
export function observeEffects(vm: object, observer: ((record: EffectRecord) => void) | undefined): void {
  if (observer === undefined) EFFECT_OBSERVERS.delete(vm);
  else EFFECT_OBSERVERS.set(vm, observer);
}

/**
 * Record a located diagnostic (AD-24; ERR-2): a `diagnostic` effect named
 * `vm.diagnostic` whose args are `[code, file, line, message]`. The host drains
 * it beside the other effects, so a failure is visible to the harness even when
 * the script survives it (a request that timed out, for instance).
 */
export function recordDiagnostic(
  vm: EffectState,
  tick: number,
  thread: number,
  code: string,
  file: string,
  line: number,
  message: string,
): EffectRecord {
  return recordEffect(vm, {
    tick,
    thread,
    name: "vm.diagnostic",
    kind: "diagnostic",
    args: [code, file, line, message],
    out: {},
    result: null,
    patch: null,
    wait: null,
    request: null,
  });
}

/**
 * Take the recorded effects out of `vm.effects` and return them, in order. With
 * a `section`, only records whose patch names it are taken; the rest stay
 * untouched, with their `seq` numbers unchanged. With no section, every record
 * is taken. `vm.effectSeq` is never affected.
 */
export function drainEffects(vm: EffectState, section?: SectionKey): EffectRecord[] {
  const taken: EffectRecord[] = [];
  const kept: EffectRecord[] = [];
  for (const record of vm.effects) {
    if (section === undefined || record.patch?.section === section) taken.push(record);
    else kept.push(record);
  }
  if (taken.length > 0) vm.effects.splice(0, vm.effects.length, ...kept);
  return taken;
}

/** The slice of `VmState` the effect log lives on (avoids an import cycle). */
type EffectState = {
  effects: EffectRecord[];
  effectSeq: number;
};
