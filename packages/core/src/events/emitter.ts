/**
 * The emitter operations over the `events` section (EMIT-2, EMIT-4, EMIT-14, EMIT-19 to
 * EMIT-22; docs/spec/engine/rpgcode-modules-and-objects.md#emit-14): add a listener,
 * remove one or all of a type, queue an event, register a built-in emitter, apply a
 * TypeScript plugin's emit effect and queue the game `error` event. Every function is a
 * plain function over plain data (G1): no clock, no randomness, no closure in state.
 *
 * Delivery is `dispatch.ts`'s; this file never runs a listener.
 */

import type { ObjectValue, Value } from "../ports/value.ts";
import type { PlainData } from "../ports/plain-data.ts";
import { CALLABLE_NOT_CALLABLE, OBJECT_INVALID, ScriptError } from "../script/errors.ts";
import { createObject, findObject, isDictionary, readMember, writeMember } from "../script/objects.ts";
import type { ObjectRecord, VmState } from "../script/state.ts";
import { isCallableValue } from "../script/values.ts";
import type { CallableValue } from "../ports/value.ts";
import { emitterHandle, GAME_EMITTER, objectEmitter, type EventsSection } from "./model.ts";

/** The emitter methods every object has (EMIT-2): the names, folded as the lexer folds them. */
const EMITTER_METHODS: Record<string, true> = { on: true, once: true, off: true, emit: true, emitcancelable: true };

/** The built-in a bound `cancel` member names (EMIT-16, EMIT-17): `event.cancel()` is `cancelEvent(event)`. */
export const CANCEL_EVENT = "cancelevent";

/** The wait kind of a thread parked on a cancelable emit (EMIT-16). */
export const EVENT_DISPATCH_WAIT = "event.dispatch";

/** The catchable errors of a cancelable emit and of `cancel` (EMIT-17, EMIT-18). */
export const EMIT_REENTRANT = "emit.reentrant";
export const EVENT_NOT_CANCELABLE = "event.not-cancelable";
export const EVENT_NOT_DISPATCHING = "event.not-dispatching";

/** The type of the game's runtime-error event (EMIT-9, EMIT-22). */
export const ERROR_EVENT = "error";

/** Whether `name` is one of the host-provided emitter methods of every object (OOP-12, EMIT-2). */
export function isEmitterMethod(name: string): boolean {
  return Object.hasOwn(EMITTER_METHODS, name);
}

/**
 * Whether a callable bound to an object takes that object as its first argument when it
 * names `def`: an emitter method, or the `cancel` of an event (EMIT-2, EMIT-16).
 */
export function isHostMethodDef(def: string): boolean {
  return def === CANCEL_EVENT || isEmitterMethod(def);
}

/** The one supported listener pattern: every actor emitter of the session (EMIT-21). */
export const ACTOR_EMITTER_PATTERN = "actor:*";

/**
 * Whether a declared listener emitter covers the emitter key an event was sent on
 * (EMIT-21): an exact key, or the one pattern `actor:*` for every actor emitter.
 */
export function listenerCoversEmitter(declared: string, key: string): boolean {
  if (declared === key) return true;
  return declared === ACTOR_EMITTER_PATTERN && key.startsWith("actor:");
}

/** Whether `emitter` is the one supported listener pattern `actor:*` (EMIT-21). */
export function isEmitterPattern(emitter: string): boolean {
  return emitter === ACTOR_EMITTER_PATTERN;
}

/** Whether two callables are the same listener for `off` (EMIT-4): same `def`, `captures` and receiver. */
export function callablesEqual(left: CallableValue, right: CallableValue): boolean {
  if (left.def !== right.def || left.receiver !== right.receiver || left.captures.length !== right.captures.length) return false;
  return left.captures.every((id, index) => id === right.captures[index]);
}

function badArg(op: string, message: string): ScriptError {
  return new ScriptError("builtin.bad-arg", `${op}: ${message}`);
}

function isObjectValue(value: Value | undefined): value is ObjectValue {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "object";
}

function objectValueOf(record: ObjectRecord): ObjectValue {
  return { kind: "object", handle: record.handle, className: record.className };
}

/**
 * The listener-table key of the object with `handle` (EMIT-15, EMIT-20): the key it is
 * registered under as a built-in emitter, else `object:<handle>`.
 */
export function emitterKeyOf(events: Pick<EventsSection, "emitters">, handle: number): string {
  const emitters = events.emitters;
  if (emitters !== undefined) {
    for (const key of Object.keys(emitters)) if (emitters[key] === handle) return key;
  }
  return objectEmitter(handle);
}

/**
 * Register the built-in emitter `key` (EMIT-20) and return its object: the one already
 * registered under that key, else a new dictionary recorded in `events.emitters`. The
 * engine keeps it alive while it is registered (`eventRoots`).
 */
export function registerEmitter(
  vm: Pick<VmState, "objects">,
  events: EventsSection,
  key: string,
  existing?: ObjectRecord,
): ObjectRecord {
  const emitters = events.emitters;
  if (emitters !== undefined && Object.hasOwn(emitters, key)) {
    const current = findObject(vm, emitters[key]!);
    if (current !== undefined) return current;
    delete emitters[key];
  }
  const record = existing ?? createObject(vm, null);
  const table = events.emitters ?? {};
  Object.defineProperty(table, key, { value: record.handle, writable: true, enumerable: true, configurable: true });
  events.emitters = table;
  return record;
}

/**
 * Hydrate a built-in emitter with its host object without dropping its listener
 * key or queued notifications. Audio can queue `started` before its returned
 * voice is bound; those notifications must target that same voice object.
 */
export function adoptEmitter(vm: VmState, events: EventsSection, key: string, record: ObjectRecord): void {
  const provisional = objectEmitter(record.handle);
  for (const listener of events.listeners) if (listener.emitter === provisional) listener.emitter = key;
  for (const queued of events.queue) if (queued.emitter === provisional) queued.emitter = key;
  if (events.dispatch?.emitter === provisional) events.dispatch.emitter = key;
  const current = registerEmitter(vm, events, key, record);
  if (current === record) return;
  events.emitters![key] = record.handle;
  for (const queued of events.queue) {
    if (queued.emitter !== key) continue;
    const event = findObject(vm, queued.event);
    if (event !== undefined) writeMember(event, "target", objectValueOf(record));
  }
}

/**
 * Unregister the built-in emitter `key` (EMIT-20): drop its listeners, stale
 * queued events and in-progress cursor, and stop keeping its object alive.
 * A key that is not registered does nothing.
 */
export function unregisterEmitter(events: EventsSection, key: string): void {
  const emitters = events.emitters;
  if (emitters === undefined || !Object.hasOwn(emitters, key)) return;
  delete emitters[key];
  if (Object.keys(emitters).length === 0) delete events.emitters;
  events.listeners = events.listeners.filter((listener) => listener.emitter !== key);
  const stale = events.queue.filter((queued) => queued.emitter === key);
  events.queue = events.queue.filter((queued) => queued.emitter !== key);
  for (const queued of stale) forgetNativeDetail(events, queued.event);
  if (events.dispatch?.emitter === key) {
    forgetNativeDetail(events, events.dispatch.event);
    events.dispatch = null;
  }
  if (events.retiring !== undefined) {
    events.retiring = events.retiring.filter((retiring) => retiring !== key);
    if (events.retiring.length === 0) delete events.retiring;
  }
}

/** Retire a board after its transition `left` event has passed through the shared queue. */
export function deferUnregisterEmitter(events: EventsSection, key: string, leftEvent: number): void {
  const stale = events.queue.filter((queued) => queued.emitter === key && queued.event !== leftEvent);
  events.queue = events.queue.filter((queued) => queued.emitter !== key || queued.event === leftEvent);
  for (const queued of stale) forgetNativeDetail(events, queued.event);
  const retiring = events.retiring ?? [];
  if (!retiring.includes(key)) events.retiring = [...retiring, key];
}


/** The live object `value` names, or the catchable `object.invalid` (EMIT-14). */
function liveEmitter(vm: VmState, op: string, value: Value | undefined): ObjectRecord {
  const record = isObjectValue(value) ? findObject(vm, value.handle) : undefined;
  if (record === undefined) throw new ScriptError(OBJECT_INVALID, `${op}: the emitter is not a live object`);
  return record;
}

function eventType(op: string, value: Value | undefined): string {
  if (typeof value !== "string") throw badArg(op, "the event type must be a string");
  return value;
}

function listenerCallable(op: string, value: Value | undefined): CallableValue {
  if (!isCallableValue(value)) throw new ScriptError(CALLABLE_NOT_CALLABLE, `${op}: the listener must be a callable`);
  return value;
}

/**
 * Apply one emitter command (EMIT-14, EMIT-16, EMIT-17). `op` is `on`, `once`,
 * `off`, `emit`, `emitcancelable` or `cancel`; `emitter` is the object it is
 * applied to (the event, for `cancel`) and `rest` its other arguments in order:
 * the type, then the callable (`on`, `once`, `off`) or the detail (`emit`,
 * `emitcancelable`). `thread` is the id of the thread making the call. The method
 * form and the free-function form both land here.
 *
 * Returns the handle of the cancelable event the calling thread must now park on
 * (EMIT-16), or `null` when the call does not wait.
 */
export function applyEmitterOp(
  vm: VmState,
  events: EventsSection,
  op: string,
  emitter: Value | undefined,
  rest: readonly Value[],
  thread: number | null,
): number | null {
  if (op === "cancel") {
    cancelEvent(vm, events, emitter);
    return null;
  }
  const record = liveEmitter(vm, op, emitter);
  const key = emitterKeyOf(events, record.handle);
  const type = eventType(op, rest[0]);
  if (op === "on" || op === "once") {
    addListener(events, key, type, listenerCallable(op, rest[1]), op === "once");
    return null;
  }
  if (op === "off") {
    removeListeners(events, key, type, rest.length > 1 ? listenerCallable(op, rest[1]) : undefined);
    return null;
  }
  if (op === "emit") {
    queueEvent(vm, events, record, key, type, rest.length > 1 ? detailFields(vm, op, rest[1]) : [], false);
    return null;
  }
  if (op === "emitcancelable") {
    const detail = rest.length > 1 ? detailFields(vm, op, rest[1]) : [];
    if (thread === null) throw badArg(op, "a cancelable emit needs a script thread to park (an engine phase's own emits are EMIT-11)");
    if (events.dispatch !== null && events.dispatch.thread === thread) {
      throw new ScriptError(EMIT_REENTRANT, `${op}: a listener cannot wait for a cancelable event; its own delivery would wait for it (EMIT-18)`);
    }
    return queueEvent(vm, events, record, key, type, detail, true);
  }
  throw badArg(op, "is not an emitter command");
}

/**
 * `cancel()` (EMIT-17): set `canceled` on the cancelable event being delivered. The
 * argument must be an event object (a dictionary with the keys `cancelable` and
 * `canceled`, EMIT-6), the event must be cancelable and it must be the delivery in progress.
 */
function cancelEvent(vm: VmState, events: EventsSection, value: Value | undefined): void {
  const record = isObjectValue(value) ? findObject(vm, value.handle) : undefined;
  if (record === undefined || !isDictionary(record) || !Object.hasOwn(record.members, "cancelable") || !Object.hasOwn(record.members, "canceled")) {
    throw badArg("cancel", "the argument must be an event object");
  }
  if (readMember(record, "cancelable") !== 1) throw new ScriptError(EVENT_NOT_CANCELABLE, "cancel: the event is not cancelable (EMIT-17)");
  if (events.dispatch === null || events.dispatch.event !== record.handle) {
    throw new ScriptError(EVENT_NOT_DISPATCHING, "cancel: the event is not being delivered now (EMIT-17)");
  }
  writeMember(record, "canceled", 1);
}

/** The fields of the dictionary a script gave as `detail`, in key order (EMIT-6: the copy is made when the event is made). */
function detailFields(vm: VmState, op: string, value: Value | undefined): Array<readonly [string, Value]> {
  const record = isObjectValue(value) ? findObject(vm, value.handle) : undefined;
  if (record === undefined || !isDictionary(record)) throw badArg(op, "the detail must be a dictionary");
  return record.keys.map((name) => [name, record.members[name]!] as const);
}

/** Append a listener to the one table, so registration order is the order of the table (EMIT-4). */
export function addListener(events: EventsSection, emitter: string, type: string, callable: CallableValue, once: boolean): void {
  events.listeners.push({ id: events.nextListener, emitter, type, once, callable });
  events.nextListener += 1;
}

/**
 * Remove the first listener of `emitter` and `type` whose callable equals `fn`,
 * or every listener of that type when `fn` is absent (EMIT-4). A call that
 * matches nothing does nothing.
 */
function removeListeners(events: EventsSection, emitter: string, type: string, fn: CallableValue | undefined): void {
  if (fn === undefined) {
    events.listeners = events.listeners.filter((listener) => listener.emitter !== emitter || listener.type !== type);
    return;
  }
  const at = events.listeners.findIndex(
    (listener) => listener.emitter === emitter && listener.type === type && callablesEqual(listener.callable, fn),
  );
  if (at >= 0) events.listeners.splice(at, 1);
}

function cloneNativeData(value: PlainData): PlainData {
  if (Array.isArray(value)) return value.map((entry) => cloneNativeData(entry));
  if (value === null || typeof value !== "object") return value;
  const copy: { [key: string]: PlainData } = {};
  for (const name of Object.keys(value)) {
    Object.defineProperty(copy, name, {
      value: cloneNativeData(value[name]!),
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  return copy;
}

function cloneNativeDetail(detail: Readonly<Record<string, PlainData>>): { [field: string]: PlainData } {
  return cloneNativeData(detail) as { [field: string]: PlainData };
}

function rememberNativeDetail(events: EventsSection, event: number, detail: Readonly<Record<string, PlainData>>): void {
  const nativeDetails = events.nativeDetails ?? {};
  Object.defineProperty(nativeDetails, String(event), {
    value: cloneNativeDetail(detail),
    writable: true,
    enumerable: true,
    configurable: true,
  });
  events.nativeDetails = nativeDetails;
}

export function forgetNativeDetail(events: EventsSection, event: number): void {
  const nativeDetails = events.nativeDetails;
  if (nativeDetails === undefined) return;
  delete nativeDetails[String(event)];
  if (Object.keys(nativeDetails).length === 0) delete events.nativeDetails;
}

/**
 * Make the event object now, append it to the queue and return its handle (EMIT-3,
 * EMIT-6, EMIT-14, EMIT-16): a dictionary with `type`, `target`, `detail`,
 * `cancelable`, `canceled` and `cancel`, where `detail` is a new dictionary holding
 * `fields` (an empty one when there are none) and `cancel` is a callable bound to the
 * event itself. `key` is the emitter's listener-table key. Nothing runs.
 */
function queueEvent(
  vm: VmState,
  events: EventsSection,
  emitter: ObjectRecord,
  key: string,
  type: string,
  fields: ReadonlyArray<readonly [string, Value]>,
  cancelable: boolean,
  nativeDetail?: Readonly<Record<string, PlainData>>,
): number {
  const copy = createObject(vm, null);
  for (const [name, value] of fields) writeMember(copy, name, value);
  const event = createObject(vm, null);
  writeMember(event, "type", type);
  writeMember(event, "target", objectValueOf(emitter));
  writeMember(event, "detail", objectValueOf(copy));
  writeMember(event, "cancelable", cancelable ? 1 : 0);
  writeMember(event, "canceled", 0);
  writeMember(event, "cancel", { type: "callable", def: CANCEL_EVENT, captures: [], receiver: String(event.handle) });
  events.queue.push({ emitter: key, event: event.handle });
  if (nativeDetail !== undefined) rememberNativeDetail(events, event.handle, nativeDetail);
  return event.handle;
}

/** The script value of one plain detail field of a TypeScript emit (EMIT-21), or `undefined` when it is not a scalar. */
function plainField(value: PlainData | undefined): Value | undefined {
  if (typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === null) return 0;
  return undefined;
}

/** The emitter a TypeScript emit names (EMIT-21): the game, a registered built-in key or a live `object:<handle>`. */
function nativeEmitter(vm: VmState, events: EventsSection, key: string): { readonly record: ObjectRecord; readonly key: string } {
  if (key === GAME_EMITTER) return { record: registerEmitter(vm, events, key), key };
  const registered = events.emitters !== undefined && Object.hasOwn(events.emitters, key) ? findObject(vm, events.emitters[key]!) : undefined;
  if (registered !== undefined) return { record: registered, key };
  const handle = emitterHandle(key);
  const record = handle === null ? undefined : findObject(vm, handle);
  if (record === undefined || emitterKeyOf(events, record.handle) !== key) {
    throw new ScriptError(OBJECT_INVALID, `emit: "${key}" names no emitter`);
  }
  return { record, key };
}

/**
 * Queue a native event on the shared bus (EMIT-7, EMIT-11, EMIT-21).
 *
 * Engine and core owners use this entry point rather than calling listeners
 * directly. Unlike a plugin `emit` effect, standard-event details may contain
 * nested plain records (for example `leveledUp.applied`); those records are
 * hydrated as ordinary dictionary values in the event object.
 */
export function queueNativeEvent(
  vm: VmState,
  events: EventsSection,
  key: string,
  type: string,
  detail: Readonly<Record<string, PlainData>> = {},
  cancelable = false,
): number {
  if (typeof key !== "string") throw badArg("emit", "the emitter key must be a string");
  if (typeof type !== "string") throw badArg("emit", "the event type must be a string");
  const fields: Array<readonly [string, Value]> = [];
  for (const name of Object.keys(detail)) fields.push([name, nativeField(vm, detail[name] ?? null)]);
  const emitter = nativeEmitter(vm, events, key);
  return queueEvent(vm, events, emitter.record, emitter.key, type, fields, cancelable, detail);
}

function nativeField(vm: VmState, value: PlainData | undefined): Value {
  if (value === undefined || value === null) return 0;
  if (typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (Array.isArray(value)) {
    const record = createObject(vm, null);
    for (let index = 0; index < value.length; index += 1) writeMember(record, String(index), nativeField(vm, value[index] ?? null));
    return objectValueOf(record);
  }
  const record = createObject(vm, null);
  for (const name of Object.keys(value)) writeMember(record, name, nativeField(vm, value[name] ?? null));
  return objectValueOf(record);
}

/**
 * Apply the `emit` effect a TypeScript plugin's command reported (EMIT-21):
 * `args` is `[emitter key, type, detail?]`. Plugin effects retain the
 * documented scalar-only validation; standard-event producers use
 * `queueNativeEvent` above when they need nested plain detail.
 */
export function applyEmitEffect(vm: VmState, events: EventsSection, args: readonly PlainData[]): void {
  const key = args[0];
  const type = args[1];
  const detail = args[2];
  if (typeof key !== "string") throw badArg("emit", "the emitter key must be a string");
  if (typeof type !== "string") throw badArg("emit", "the event type must be a string");
  const fields: Array<readonly [string, Value]> = [];
  if (detail !== undefined && detail !== null) {
    if (typeof detail !== "object" || Array.isArray(detail)) throw badArg("emit", "the detail must be a plain object");
    for (const name of Object.keys(detail)) {
      const value = plainField(detail[name]);
      if (value === undefined) throw badArg("emit", `the detail field "${name}" must be a number, a string, a boolean or null`);
      fields.push([name, value]);
    }
  }
  const emitter = nativeEmitter(vm, events, key);
  queueEvent(vm, events, emitter.record, emitter.key, type, fields, false, detail !== undefined && detail !== null ? detail as { readonly [field: string]: PlainData } : undefined);
}

/** The located failure the game `error` event reports (EMIT-9, EMIT-22). */
export type ErrorEventDetail = {
  readonly code: string;
  readonly message: string;
  readonly file: string;
  readonly line: number;
  readonly handled: boolean;
};

/**
 * Queue the game `error` event for one runtime failure (EMIT-22): a plain emit on `game`
 * whose `detail` holds `code`, `message`, `file`, `line` and `handled` (`1` or `0`), in that
 * order. `thread` is the failing thread; a failure of the thread that is running a listener
 * of an `error` event on the game is not emitted again, so a faulty listener cannot loop.
 * Returns the queued event's object handle, or `null` when none was queued.
 */
export function queueErrorEvent(vm: VmState, events: EventsSection, thread: number, error: ErrorEventDetail): number | null {
  const cursor = events.dispatch;
  if (cursor !== null && cursor.thread === thread && cursor.emitter === GAME_EMITTER) {
    const delivering = findObject(vm, cursor.event);
    if (delivering !== undefined && readMember(delivering, "type") === ERROR_EVENT) return null;
  }
  const game = registerEmitter(vm, events, GAME_EMITTER);
  return queueEvent(
    vm,
    events,
    game,
    GAME_EMITTER,
    ERROR_EVENT,
    [
      ["code", error.code],
      ["message", error.message],
      ["file", error.file],
      ["line", error.line],
      ["handled", error.handled ? 1 : 0],
    ],
    false,
  );
}

/**
 * Remove one event that is queued and not yet being delivered, by its event object's handle. The object itself
 * is left to the end-of-tick collection (R-34), which frees it once nothing names it. Returns whether the event
 * was still queued; an event already delivered is no longer on the queue, so nothing is removed.
 */
export function dequeueEvent(events: EventsSection, handle: number): boolean {
  const at = events.queue.findIndex((queued) => queued.event === handle);
  if (at < 0) return false;
  events.queue.splice(at, 1);
  return true;
}

/** Drop every listener of a freed object (EMIT-14, "A freed emitter"). */
export function forgetEmitter(events: EventsSection, handle: number): void {
  const key = objectEmitter(handle);
  if (events.listeners.some((listener) => listener.emitter === key)) {
    events.listeners = events.listeners.filter((listener) => listener.emitter !== key);
  }
}

/**
 * Drop the listeners of every emitter the handle table no longer holds; returns
 * how many went. Run after the end-of-tick collection (R-34), before any new
 * object can take a freed handle. A built-in emitter's listeners are filed under its
 * key and go with `unregisterEmitter`, not here.
 */
export function pruneDeadEmitters(events: EventsSection, vm: Pick<VmState, "objects">): number {
  if (events.listeners.length === 0) return 0;
  const live = new Set(vm.objects.map((record) => record.handle));
  const kept = events.listeners.filter((listener) => {
    const handle = emitterHandle(listener.emitter);
    return handle === null || live.has(handle);
  });
  const removed = events.listeners.length - kept.length;
  if (removed > 0) events.listeners = kept;
  return removed;
}

/**
 * The script values kept alive outside the `vm` section's own roots: every
 * listener's callable (the cells and receiver it names), the event object of every
 * queued or in-progress event (EMIT-14), the event object of every thread parked
 * on a cancelable emit (EMIT-16) and the object of every registered built-in emitter
 * (EMIT-20). They are extra roots of the end-of-tick pass.
 */
export function eventRoots(events: EventsSection, vm: Pick<VmState, "threads">): Value[] {
  const roots: Value[] = [];
  for (const listener of events.listeners) roots.push(listener.callable);
  for (const queued of events.queue) roots.push({ kind: "object", handle: queued.event, className: "" });
  if (events.dispatch !== null) roots.push({ kind: "object", handle: events.dispatch.event, className: "" });
  for (const thread of vm.threads) {
    const handle = thread.wait?.kind === EVENT_DISPATCH_WAIT ? thread.wait.payload[0] : undefined;
    if (typeof handle === "number") roots.push({ kind: "object", handle, className: "" });
  }
  if (events.emitters !== undefined) {
    for (const key of Object.keys(events.emitters)) roots.push({ kind: "object", handle: events.emitters[key]!, className: "" });
  }
  return roots;
}
