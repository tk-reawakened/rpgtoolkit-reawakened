/**
 * The pictures behind the spec matcher helpers (TOOL-5, docs/spec/engine/rpgcode-tooling.md#tool-5-natives).
 *
 * `specCapture` turns what `expect` was given into a **snapshot**: a plain tree that records the value's runtime
 * type, its full stored value (a double is never truncated, SEM-3), and for an object or an element array the
 * identity a strict `toBe` compares. The matcher helpers compare and print snapshots. A snapshot is passed as
 * JSON text only between `expect` and the helpers; no script may read it, it is never saved, and no promise covers
 * its shape.
 *
 * Reference identities are small numbers handed out in capture order. The first capture of a variable (a global
 * array, a member array of an object, a local array in one frame) or of a live object takes the next number and
 * later captures of the same thing reuse it, so two runs of one case give identical snapshots and no host address
 * ever enters one. The numbers live beside the case's `VmState` and so start again for every case.
 */

import {
  isCallableValue,
  isDictionary,
  type Arg,
  type CommandView,
  type ElementArray,
  type ObjectRecord,
  type Value,
} from "@tk-reawakened/core";

/** One element of an array: its index text, the value stored at exactly that index (if any), and its sub-elements. */
export type ArrayNode = readonly [index: string, own: Snap | null, kids: readonly ArrayNode[]];

export type Snap =
  /** A number: its IEEE-754 text (`String(value)`, so `NaN` and `±Infinity` survive) with `-0` written as `0`. */
  | readonly ["n", text: string]
  | readonly ["s", text: string]
  /** A callable: its definition, its closure cells and its receiver. */
  | readonly ["f", def: string, captures: readonly string[], receiver: string | null]
  /** A class instance, or a host object: identity, class name, live handle. */
  | readonly ["o", identity: number, className: string, handle: number]
  /** A dictionary: identity, live handle, members in canonical key order. */
  | readonly ["d", identity: number, handle: number, members: readonly (readonly [string, Snap])[]]
  /** An element array: identity and its elements in canonical index order. */
  | readonly ["a", identity: number, nodes: readonly ArrayNode[]]
  /** A dictionary met again while it is being captured (a cycle). */
  | readonly ["r", identity: number];

const identities = new WeakMap<object, Map<string, number>>();

/** The reference identity of `key`: the position of its first capture in this case's capture order, from 1. */
function identityOf(view: CommandView, key: string): number {
  const owner: object = view.state?.vm ?? view;
  let seen = identities.get(owner);
  if (seen === undefined) {
    seen = new Map();
    identities.set(owner, seen);
  }
  let identity = seen.get(key);
  if (identity === undefined) {
    identity = seen.size + 1;
    seen.set(key, identity);
  }
  return identity;
}

const NUMERIC_KEY = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

/** Canonical key order: numeric keys first, by value; every other key after them, by code unit. */
export function compareKeys(left: string, right: string): number {
  const leftNumeric = NUMERIC_KEY.test(left);
  const rightNumeric = NUMERIC_KEY.test(right);
  if (leftNumeric && rightNumeric) {
    const difference = Number(left) - Number(right);
    if (difference !== 0) return difference;
  } else if (leftNumeric !== rightNumeric) {
    return leftNumeric ? -1 : 1;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

type Capture = {
  readonly view: CommandView;
  readonly objects: readonly ObjectRecord[];
  /** Dictionaries being captured, so a cycle ends at a back reference. */
  readonly visiting: Set<number>;
};

function captureValue(capture: Capture, value: Value): Snap {
  if (value === null) return ["n", "0"];
  if (typeof value === "number") return ["n", Object.is(value, -0) ? "0" : String(value)];
  if (typeof value === "string") return ["s", value];
  if (isCallableValue(value)) return ["f", value.def, [...value.captures], value.receiver];
  const record = capture.objects.find((item) => item.handle === value.handle);
  const identity = identityOf(capture.view, `object:${value.handle}`);
  if (record === undefined) return ["o", identity, value.className, value.handle];
  // A host object (an actor, a media track) and a class instance are compared by handle, never member by member.
  if (!isDictionary(record) || record.hostType !== undefined) return ["o", identity, record.className, record.handle];
  if (capture.visiting.has(record.handle)) return ["r", identity];
  capture.visiting.add(record.handle);
  const members = [...record.keys]
    .sort(compareKeys)
    .map((key): readonly [string, Snap] => [key, captureValue(capture, Object.hasOwn(record.members, key) ? record.members[key]! : 0)]);
  capture.visiting.delete(record.handle);
  return ["d", identity, record.handle, members];
}

/** The index texts of `[a][b]...`, nested brackets inside one index counted; `null` when the text is not that form. */
function splitIndices(text: string): readonly string[] | null {
  const parts: string[] = [];
  let at = 0;
  while (at < text.length) {
    if (text[at] !== "[") return null;
    let depth = 0;
    let end = -1;
    for (let index = at; index < text.length; index += 1) {
      if (text[index] === "[") depth += 1;
      else if (text[index] === "]") {
        depth -= 1;
        if (depth === 0) {
          end = index;
          break;
        }
      }
    }
    if (end < 0) return null;
    parts.push(text.slice(at + 1, end));
    at = end + 1;
  }
  return parts;
}

type MutableNode = { own: Snap | null; readonly kids: Map<string, MutableNode> };

function freezeNodes(level: ReadonlyMap<string, MutableNode>): readonly ArrayNode[] {
  return [...level.keys()]
    .sort(compareKeys)
    .map((index): ArrayNode => {
      const node = level.get(index)!;
      return [index, node.own, freezeNodes(node.kids)];
    });
}

/** The name of the variable a reference names: `global:a` and `local:a` give `a`, `object:7:a` gives `a`. */
function referencedName(ref: string): string {
  const scope = ref.slice(0, ref.indexOf(":"));
  const rest = ref.slice(ref.indexOf(":") + 1);
  return scope === "object" ? rest.slice(rest.indexOf(":") + 1) : rest;
}

function captureArray(capture: Capture, ref: string, array: ElementArray): Snap {
  const name = referencedName(ref);
  const root = new Map<string, MutableNode>();
  for (const entry of array.entries) {
    const rest = entry.name.slice(name.length);
    const path = splitIndices(rest) ?? [rest.slice(1, rest.endsWith("]") ? -1 : undefined)];
    let level = root;
    let node: MutableNode | undefined;
    for (const index of path) {
      node = level.get(index);
      if (node === undefined) {
        node = { own: null, kids: new Map() };
        level.set(index, node);
      }
      level = node.kids;
    }
    if (node !== undefined) node.own = captureValue(capture, entry.value);
  }
  return ["a", identityOf(capture.view, `array:${array.table}/${name}`), freezeNodes(root)];
}

/**
 * Take the snapshot of one argument of a native call. When its reference names a variable that owns element
 * variables `name[...]` (SEM-5) the whole sparse, nested array is captured in canonical index order, whatever the
 * scope; otherwise the stored value is, with its own type and no truncation.
 */
export function captureArg(view: CommandView, arg: Arg): Snap {
  const capture: Capture = { view, objects: view.state?.vm.objects ?? [], visiting: new Set() };
  if (arg.ref !== null && view.elementArray !== undefined) {
    const array = view.elementArray(arg.ref);
    if (array.entries.length > 0) return captureArray(capture, arg.ref, array);
  }
  return captureValue(capture, arg.value);
}

const TAGS: Record<string, true> = { n: true, s: true, f: true, o: true, d: true, a: true, r: true };

/** Read a snapshot back from the text `specCapture` returned, or `null` when the text is not one. */
export function parseSnap(text: Value): Snap | null {
  if (typeof text !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) && typeof parsed[0] === "string" && Object.hasOwn(TAGS, parsed[0]) ? (parsed as unknown as Snap) : null;
  } catch {
    return null;
  }
}

function nodesEqual(left: readonly ArrayNode[], right: readonly ArrayNode[], seen: Set<string>): boolean {
  if (left.length !== right.length) return false;
  for (let at = 0; at < left.length; at += 1) {
    const [leftIndex, leftOwn, leftKids] = left[at]!;
    const [rightIndex, rightOwn, rightKids] = right[at]!;
    if (leftIndex !== rightIndex) return false;
    if ((leftOwn === null) !== (rightOwn === null)) return false;
    if (leftOwn !== null && rightOwn !== null && !snapsEqual(leftOwn, rightOwn, false, seen)) return false;
    if (!nodesEqual(leftKids, rightKids, seen)) return false;
  }
  return true;
}

/**
 * Whether two snapshots are the same value, with no number/string conversion (`5` is never `"5"`). Value equality
 * (`strict` false, `toEqual`) compares numbers by IEEE-754 text, strings code unit by code unit, arrays over the
 * same index keys element by element and dictionaries key by key, to any depth; instances match by live handle
 * and callables by definition, closure cells and receiver. Strict equality (`toBe`) is the same for numbers,
 * strings and callables but compares dictionaries, instances and arrays by identity.
 */
export function snapsEqual(left: Snap, right: Snap, strict: boolean, seen: Set<string> = new Set()): boolean {
  if (left[0] !== right[0]) return false;
  switch (left[0]) {
    case "n":
    case "s":
      return left[1] === (right as typeof left)[1];
    case "f": {
      const other = right as typeof left;
      return left[1] === other[1] && left[3] === other[3]
        && left[2].length === other[2].length && left[2].every((cell, at) => cell === other[2][at]);
    }
    case "o":
    case "r":
      return left[1] === (right as typeof left)[1];
    case "d": {
      const other = right as typeof left;
      if (left[1] === other[1]) return true;
      if (strict) return false;
      const pair = `${left[1]}|${other[1]}`;
      if (seen.has(pair)) return true;
      seen.add(pair);
      const leftMembers = left[3];
      const rightMembers = other[3];
      return leftMembers.length === rightMembers.length
        && leftMembers.every(([key, member], at) => key === rightMembers[at]![0] && snapsEqual(member, rightMembers[at]![1], false, seen));
    }
    case "a": {
      const other = right as typeof left;
      if (left[1] === other[1]) return true;
      return !strict && nodesEqual(left[2], other[2], seen);
    }
  }
}

function matchesNode(node: ArrayNode, needle: Snap): boolean {
  const [, own, kids] = node;
  if (own !== null && snapsEqual(own, needle, false)) return true;
  return kids.length > 0 && needle[0] === "a" && nodesEqual(kids, needle[2], new Set());
}

/**
 * Whether `actual` holds `needle`: a string holds a string that occurs in it (case-sensitive); an element array
 * holds a direct element (a nested sub-array included) equal to it under `toEqual`; a list, a dictionary with a
 * whole-number `length`, holds an entry under the keys `"0"` to `"<length - 1>"` and never `length` itself.
 */
export function snapContains(actual: Snap, needle: Snap): boolean {
  switch (actual[0]) {
    case "s":
      return needle[0] === "s" && actual[1].includes(needle[1]);
    case "a":
      return actual[2].some((node) => matchesNode(node, needle));
    case "d": {
      const length = actual[3].find(([key]) => key === "length")?.[1];
      if (length === undefined || length[0] !== "n") return false;
      const count = Number(length[1]);
      if (!Number.isInteger(count) || count < 0) return false;
      const members = new Map(actual[3]);
      for (let at = 0; at < count; at += 1) {
        const member = members.get(String(at));
        if (member !== undefined && snapsEqual(member, needle, false)) return true;
      }
      return false;
    }
    default:
      return false;
  }
}

/** The number a snapshot holds, or `null` when it is not a finite number. */
export function finiteNumber(snap: Snap): number | null {
  if (snap[0] !== "n") return null;
  const value = Number(snap[1]);
  return Number.isFinite(value) ? value : null;
}

function nodeDisplay(node: ArrayNode): string {
  const [index, own, kids] = node;
  const parts: string[] = [];
  // Indexing `a[0][1]` makes `a[0]` an element holding the unset value 0; that 0 says nothing about the sub-array.
  const defaulted = kids.length > 0 && own !== null && own[0] === "n" && own[1] === "0";
  if (own !== null && !defaulted) parts.push(display(own));
  if (kids.length > 0) parts.push(`array[${kids.map(nodeDisplay).join(", ")}]`);
  return `${index}: ${parts.length === 0 ? "unset" : parts.join(" ")}`;
}

/** Human-readable text of a snapshot for a failure message; a string is quoted, so `5` and `"5"` read apart. */
export function display(snap: Snap): string {
  switch (snap[0]) {
    case "n":
      return snap[1];
    case "s":
      return JSON.stringify(snap[1]);
    case "f":
      return `<function ${snap[1]}>`;
    case "o":
      return `<${snap[2] === "" ? "object" : snap[2]} #${snap[3]}>`;
    case "r":
      return "<cycle>";
    case "d":
      return `{${snap[3].map(([key, member]) => `${JSON.stringify(key)}: ${display(member)}`).join(", ")}}`;
    case "a":
      return `array[${snap[2].map(nodeDisplay).join(", ")}]`;
  }
}
