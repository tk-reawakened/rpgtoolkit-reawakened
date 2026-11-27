/** A safe, deliberately small projection of the TOOL-5 source forms owned by the fixture editor. */
export interface VisualFixtureDefinition {
  readonly board: string;
  readonly party: readonly string[];
  readonly x: number;
  readonly y: number;
  readonly layer?: number;
  readonly facing?: string;
  readonly seed?: number;
  /**
   * Authored fields the cards cannot show (`stats`, `inventory`, `gold`, `variables`, `files`, anything a newer
   * runner adds). They are kept verbatim so saving one card never drops another.
   */
  readonly extra?: Readonly<Record<string, unknown>>;
  /** The authored `party` shape: the runner accepts both `{ length, "0": … }` and a plain array. */
  readonly partyForm?: "object" | "array";
  /** The authored key order, so a rewrite keeps the fixture's own field order. */
  readonly order?: readonly string[];
}

export interface VisualFixtureLine {
  readonly line: number;
  readonly from: number;
  readonly to: number;
  readonly definition: VisualFixtureDefinition;
}

export interface VisualFixtureAction {
  readonly line: number;
  readonly from: number;
  readonly to: number;
  readonly action: string;
  readonly ticks: number;
}

export interface VisualFixtureCase {
  readonly name: string;
  readonly startLine: number;
  readonly actions: readonly VisualFixtureAction[];
}

/** A `describe` body: a fixture declared in one applies only to that group, so new cases belong inside it. */
export interface VisualFixtureGroup {
  readonly name: string;
  readonly startLine: number;
  readonly endLine: number | null;
  readonly bodyIndent: string;
  /** Start offset of the group's closing line: where a new case is inserted. */
  readonly insertFrom: number;
}

export interface VisualFixtureProjection {
  readonly fixture: VisualFixtureLine | null;
  readonly cases: readonly VisualFixtureCase[];
  readonly groups: readonly VisualFixtureGroup[];
  readonly opaque: readonly { readonly line: number; readonly text: string }[];
  /** Where a new case belongs: inside the innermost group holding the fixture or the first case, else at the end. */
  readonly insert: { readonly from: number; readonly indent: string };
}

export interface FixtureCaseSpec {
  readonly name: string;
  readonly actions: readonly { readonly action: string; readonly ticks: number }[];
  readonly assertPath: string;
  readonly expected: string | number;
  readonly waitTicks: number;
  /** Wait for the value with `specWait` instead of advancing a fixed number of ticks. */
  readonly waitForValue?: boolean;
  readonly insert?: { readonly from: number; readonly indent: string };
}

interface SourceLine {
  readonly text: string;
  readonly from: number;
  readonly to: number;
  readonly number: number;
}
const EDITABLE_ACTIONS: Readonly<Record<string, true>> = { up: true, down: true, left: true, right: true, confirm: true, cancel: true, menu: true };
const MODELLED_FIELDS: Readonly<Record<string, true>> = { board: true, party: true, x: true, y: true, layer: true, seed: true, facing: true };
const FACINGS: Readonly<Record<string, true>> = { N: true, NE: true, E: true, SE: true, S: true, SW: true, W: true, NW: true };

function sourceLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let from = 0;
  let number = 1;
  while (from < source.length) {
    const newline = source.indexOf("\n", from);
    const end = newline === -1 ? source.length : newline;
    const to = end > from && source.charCodeAt(end - 1) === 13 ? end - 1 : end;
    lines.push({ text: source.slice(from, to), from, to, number });
    from = newline === -1 ? source.length : newline + 1;
    number += 1;
  }
  if (source.length === 0) return [];
  return lines;
}

function projectPath(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 255
    && !value.includes("\n") && !value.includes("\r") && !value.includes("\0")
    && !value.startsWith("/") && !/^[A-Za-z]:/.test(value)
    && !value.replaceAll("\\", "/").split("/").includes("..")
    ? value
    : null;
}

/** The runner accepts `party` as an array or as `{ length, "0": …, "1": … }`; both shapes round-trip. */
function fixtureParty(value: unknown): { party: string[]; partyForm: "object" | "array" } | null {
  if (Array.isArray(value)) {
    const party = value.map((entry) => projectPath(entry));
    return party.every((entry) => entry !== null) ? { party: party as string[], partyForm: "array" } : null;
  }
  if (typeof value !== "object" || value === null) return null;
  const members = value as Record<string, unknown>;
  const keys = Object.keys(members).filter((key) => /^\d+$/.test(key)).sort((left, right) => Number(left) - Number(right));
  const declared = members["length"];
  if (declared !== undefined && (typeof declared !== "number" || !Number.isInteger(declared) || declared !== keys.length)) return null;
  const party = keys.map((key) => projectPath(members[key]));
  return party.every((entry) => entry !== null) ? { party: party as string[], partyForm: "object" } : null;
}


/**
 * Read a fixture call's plain literal: an RPGCode dictionary literal (bare or quoted keys, nested dictionaries,
 * arrays, strings, finite numbers). Strings use RPGCode's no-escape, single-line syntax.
 * Every field a card cannot show survives this parse.
 */
function literalValue(text: string): unknown {
  let at = 0;
  const space = (): void => {
    while (at < text.length && /\s/.test(text[at]!)) at += 1;
  };
  const fail = (): never => {
    throw new Error("not a plain literal");
  };
  const skipString = (): string => {
    if (text[at] !== '"') fail();
    at += 1;
    const start = at;
    while (at < text.length && text[at] !== '"') {
      if (/[\r\n\0]/.test(text[at]!)) fail();
      at += 1;
    }
    if (at >= text.length) fail();
    const value = text.slice(start, at);
    at += 1;
    return value;
  };
  const value = (): unknown => {
    space();
    const char = text[at];
    if (char === "{") {
      at += 1;
      const members: Record<string, unknown> = {};
      space();
      if (text[at] === "}") {
        at += 1;
        return members;
      }
      for (;;) {
        space();
        const key = text[at] === '"' ? skipString() : (() => {
          const start = at;
          while (at < text.length && /[A-Za-z0-9_$]/.test(text[at]!)) at += 1;
          if (at === start) fail();
          return text.slice(start, at);
        })();
        space();
        if (text[at] !== ":") fail();
        at += 1;
        members[key] = value();
        space();
        if (text[at] === ",") {
          at += 1;
          continue;
        }
        if (text[at] === "}") {
          at += 1;
          return members;
        }
        fail();
      }
    }
    if (char === "[") {
      at += 1;
      const entries: unknown[] = [];
      space();
      if (text[at] === "]") {
        at += 1;
        return entries;
      }
      for (;;) {
        entries.push(value());
        space();
        if (text[at] === ",") {
          at += 1;
          continue;
        }
        if (text[at] === "]") {
          at += 1;
          return entries;
        }
        fail();
      }
    }
    if (char === '"') return skipString();
    const rest = text.slice(at);
    const literal = /^(?:-?\d+(?:\.\d+)?(?:e[+-]?\d+)?|true|false|null)/.exec(rest);
    if (literal !== null) {
      at += literal[0].length;
      if (literal[0] === "true") return true;
      if (literal[0] === "false") return false;
      if (literal[0] === "null") return null;
      const number = Number(literal[0]);
      return Number.isFinite(number) ? number : fail();
    }
    return fail();
  };
  const parsed = value();
  space();
  if (at !== text.length) fail();
  return parsed;
}

function fixtureDefinition(line: string): VisualFixtureDefinition | null {
  const match = /^\s*specFixture\((\{.*\})\)\s*;?\s*$/.exec(line);
  if (match === null) return null;
  let parsed: unknown;
  try {
    parsed = literalValue(match[1]!);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const item = parsed as Record<string, unknown>;
  const board = projectPath(item["board"]);
  if (board === null || !board.toLowerCase().endsWith(".brd")) return null;
  const party = fixtureParty(item["party"]);
  if (party === null) return null;
  const position = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000 ? value : null;
  const x = position(item["x"]);
  const y = position(item["y"]);
  if (x === null || y === null) return null;
  const layer = item["layer"];
  if (layer !== undefined && !(typeof layer === "number" && Number.isSafeInteger(layer) && layer >= 1 && layer <= 1_000_000)) return null;
  const seed = item["seed"];
  if (seed !== undefined && !(typeof seed === "number" && Number.isSafeInteger(seed) && seed >= 0 && seed <= 4_294_967_295)) return null;
  const rawFacing = item["facing"];
  const facing = rawFacing === undefined ? undefined : typeof rawFacing === "string" ? rawFacing.toUpperCase() : null;
  if (facing !== undefined && (facing === null || !Object.hasOwn(FACINGS, facing))) return null;
  const extra: Record<string, unknown> = {};
  for (const key of Object.keys(item)) if (!Object.hasOwn(MODELLED_FIELDS, key)) extra[key] = item[key];
  return {
    board,
    party: party.party,
    x,
    y,
    ...(layer === undefined ? {} : { layer: layer as number }),
    ...(facing === undefined ? {} : { facing }),
    ...(seed === undefined ? {} : { seed: seed as number }),
    extra,
    partyForm: party.partyForm,
    order: Object.keys(item),
  };
}

function actionCall(line: string): { action: string; ticks: number } | null {
  const match = /^\s*specAction\(("[^"\r\n\0]*"),\s*(-?\d+)\)\s*;?\s*$/.exec(line);
  if (match === null) return null;
  const action = match[1]!.slice(1, -1).toLowerCase();
  const ticks = Number(match[2]);
  return Object.hasOwn(EDITABLE_ACTIONS, action) && Number.isInteger(ticks) && ticks >= 1 && ticks <= 1_000 ? { action, ticks } : null;
}

function quotedName(line: string): string | null {
  const match = /^\s*(?:it|test)\(("[^"\r\n\0]*"),\s*\(\)\s*=>\s*\{\s*$/.exec(line);
  return match === null ? null : match[1]!.slice(1, -1);
}

function describeName(line: string): string | null {
  const match = /^(\s*)(?:\w+\.)?describe\(("[^"\r\n\0]*"),\s*\(\)\s*=>\s*\{\s*$/.exec(line);
  return match === null ? null : match[2]!.slice(1, -1);
}

/** Recognise only unambiguous single-line TOOL-5 cards; every other source line remains opaque and untouched. */
export function projectVisualFixtureSource(source: string): VisualFixtureProjection {
  const lines = sourceLines(source);
  let fixture: VisualFixtureLine | null = null;
  const cases: VisualFixtureCase[] = [];
  const groups: VisualFixtureGroup[] = [];
  const opaque: { line: number; text: string }[] = [];
  const open: { kind: "describe"; name: string; startLine: number; bodyIndent: string; insertFrom: number }[] = [];
  let activeCase: { name: string; startLine: number; actions: VisualFixtureAction[] } | null = null;
  for (const line of lines) {
    const definition = fixtureDefinition(line.text);
    if (definition !== null && fixture === null) {
      fixture = { line: line.number, from: line.from, to: line.to, definition };
      continue;
    }
    const group = describeName(line.text);
    if (group !== null) {
      open.push({ kind: "describe", name: group, startLine: line.number, bodyIndent: `${/^\s*/.exec(line.text)?.[0] ?? ""}  `, insertFrom: source.length });
      continue;
    }
    const name = quotedName(line.text);
    if (name !== null) {
      activeCase = { name, startLine: line.number, actions: [] };
      continue;
    }
    const action = actionCall(line.text);
    if (action !== null && activeCase !== null) {
      activeCase.actions.push({ ...action, line: line.number, from: line.from, to: line.to });
      continue;
    }
    if (/^\s*\}\)\s*;?\s*$/.test(line.text)) {
      if (activeCase !== null) {
        cases.push({ name: activeCase.name, startLine: activeCase.startLine, actions: activeCase.actions });
        activeCase = null;
        continue;
      }
      const closed = open.pop();
      if (closed !== undefined) {
        groups.push({ name: closed.name, startLine: closed.startLine, endLine: line.number, bodyIndent: closed.bodyIndent, insertFrom: line.from });
      }
      continue;
    }
    opaque.push({ line: line.number, text: line.text });
  }
  if (activeCase !== null) {
    const unfinished = activeCase;
    opaque.push(...lines.filter((line) => line.number >= unfinished.startLine).map(({ number, text }) => ({ line: number, text })));
  }
  const anchor = fixture?.line ?? cases[0]?.startLine ?? 0;
  const enclosing = groups
    .filter((entry) => entry.endLine !== null && entry.startLine < anchor && (anchor === 0 || entry.endLine > anchor))
    .sort((left, right) => right.startLine - left.startLine)[0];
  const insert = enclosing === undefined
    ? { from: source.length, indent: "" }
    : { from: enclosing.insertFrom, indent: enclosing.bodyIndent };
  return { fixture, cases, groups: groups.sort((left, right) => left.startLine - right.startLine), opaque, insert };
}

export function codeString(value: string): string | null {
  return /["\r\n\0]/.test(value) ? null : `"${value}"`;
}

function fixtureLiteral(value: unknown): string {
  if (typeof value === "string") {
    const literal = codeString(value);
    if (literal === null) throw new Error("fixture contains text RPGCode cannot represent");
    return literal;
  }
  if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return String(value);
  if (Array.isArray(value)) return `[${value.map(fixtureLiteral).join(",")}]`;
  if (typeof value === "object") {
    const members = Object.entries(value).map(([key, item]) => {
      const literalKey = codeString(key);
      if (literalKey === null) throw new Error("fixture contains a key RPGCode cannot represent");
      return `${literalKey}:${fixtureLiteral(item)}`;
    });
    return `{${members.join(",")}}`;
  }
  throw new Error("fixture contains a value RPGCode cannot represent");
}

export function fixtureSource(definition: VisualFixtureDefinition): string {
  const party = definition.partyForm === "array"
    ? [...definition.party]
    : { length: definition.party.length, ...Object.fromEntries(definition.party.map((path, index) => [String(index), path])) };
  const values: Record<string, unknown> = { ...(definition.extra ?? {}) };
  values["board"] = definition.board;
  values["party"] = party;
  values["x"] = definition.x;
  values["y"] = definition.y;
  if (definition.layer !== undefined) values["layer"] = definition.layer;
  if (definition.seed !== undefined) values["seed"] = definition.seed;
  if (definition.facing !== undefined) values["facing"] = definition.facing;
  const authored = (definition.order ?? []).filter((key) => Object.hasOwn(values, key));
  const keys = [...authored, ...Object.keys(values).filter((key) => !authored.includes(key))];
  return `specFixture(${fixtureLiteral(Object.fromEntries(keys.map((key) => [key, values[key]])))})`;
}

/** Replace one recognised card line only; offsets and every other source byte stay with the document. */
export function replaceFixtureLine(source: string, from: number, to: number, replacement: string): string {
  return source.slice(0, from) + replacement + source.slice(to);
}

function newlineOf(source: string): string {
  return source.includes("\r\n") ? "\r\n" : "\n";
}

/** The card's own lines: one `it` with ordered actions, then a wait or fixed tick count and the assertion. */
function fixtureCaseLines(spec: FixtureCaseSpec, newline: string, indent: string): string {
  const name = codeString(spec.name);
  const path = codeString(spec.assertPath);
  if (name === null || path === null) throw new Error("Case names and assertion paths cannot hold quotes, line breaks or NUL.");
  const expected = typeof spec.expected === "number" ? String(spec.expected) : codeString(spec.expected);
  if (expected === null) throw new Error("An expected text value cannot hold quotes, line breaks or NUL.");
  const inner = `${indent}  `;
  const lines = [
    `${indent}it(${name}, () => {`,
    ...spec.actions.map(({ action, ticks }) => `${inner}specAction(${codeString(action) ?? `"${action}"`}, ${ticks})`),
  ];
  if (spec.waitForValue === true) {
    lines.push(`${inner}specWait(${path}, ${expected}, ${spec.waitTicks})`);
    lines.push(`${inner}expect(specValue(${path})).toBe(${expected})`);
  } else {
    lines.push(`${inner}specTicks(${spec.waitTicks})`);
    lines.push(`${inner}expect(specValue(${path})).toBe(${expected})`);
  }
  lines.push(`${indent}})`);
  return lines.join(newline);
}

export function appendFixtureCase(source: string, spec: FixtureCaseSpec): string {
  if (spec.name.trim().length === 0) throw new Error("A case needs a name.");
  const body = fixtureCaseLines(spec, newlineOf(source), spec.insert?.indent ?? "");
  if (spec.insert === undefined) return source.length === 0 ? body : `${source}${source.endsWith("\n") ? "" : newlineOf(source)}${body}`;
  const at = spec.insert.from;
  const prefix = source.slice(0, at);
  const suffix = source.slice(at);
  const newline = newlineOf(source);
  const separator = prefix.length === 0 || prefix.endsWith("\n") ? "" : newline;
  return `${prefix}${separator}${body}${suffix.length === 0 ? "" : `${newline}${suffix}`}`;
}
