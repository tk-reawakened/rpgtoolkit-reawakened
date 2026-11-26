import { encodeCp1252, tokenizeObjects, type AssetKind, type Token } from "@tk-reawakened/core";
import type { TextEdit } from "./program-document.ts";

export type VisualEventValue = string | number;
export type VisualEventFieldType = "number" | "string" | "variable" | "asset" | "condition";

/** The asset folder and extensions an `asset` field offers through the shared picker (T-05). */
export interface VisualEventAsset {
  readonly kind: AssetKind;
  readonly extensions: readonly string[];
}

export interface VisualEventField {
  readonly label: string;
  readonly type: VisualEventFieldType;
  readonly unit?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly integer?: boolean;
  readonly asset?: VisualEventAsset;
}

/** Where a command puts something on the screen: which fields are its coordinates, and in what unit. */
export interface VisualEventPlacement {
  readonly xField: number;
  readonly yField: number;
  /** `cells` are square cells one current font size on a side, 1-based; `pixels` are logical pixels. */
  readonly unit: "cells" | "pixels";
  readonly textField: number;
}

export interface VisualEventTemplate {
  readonly id: string;
  readonly category: "Text" | "Display" | "Player" | "Fight" | "Control" | "Items" | "Variables" | "Input" | "Info";
  readonly label: string;
  readonly command: string;
  readonly fields: readonly VisualEventField[];
  readonly defaults: readonly VisualEventValue[];
  readonly kind: "call" | "assignment" | "condition";
  readonly placement?: VisualEventPlacement;
}

const IMAGE_EXTENSIONS = [".png", ".bmp", ".gif", ".jpg", ".jpeg", ".tbm"] as const;
const CELL_UNIT = "font-size cells, the first cell is 1";

/**
 * The reviewed admission list (TOOL-12): a command is here only because its generated line reads back as the same card.
 * It is deliberately not the legacy builder's claimed ~160 templates; every other command stays opaque source.
 */
export const VISUAL_EVENT_TEMPLATES: readonly VisualEventTemplate[] = [
  { id: "text", category: "Text", label: "Draw text", command: "text", kind: "call",
    fields: [{ label: "X", type: "number", unit: CELL_UNIT, minimum: 1 }, { label: "Y", type: "number", unit: CELL_UNIT, minimum: 1 }, { label: "Text", type: "string" }],
    defaults: [1, 1, "Text"], placement: { xField: 0, yField: 1, unit: "cells", textField: 2 } },
  { id: "pixel-text", category: "Text", label: "Draw text at pixels", command: "pixeltext", kind: "call",
    fields: [{ label: "X", type: "number", unit: "pixels", integer: true }, { label: "Y", type: "number", unit: "pixels", integer: true }, { label: "Text", type: "string" }],
    defaults: [8, 8, "Text"], placement: { xField: 0, yField: 1, unit: "pixels", textField: 2 } },
  { id: "font-size", category: "Text", label: "Set font size", command: "fontsize", kind: "call",
    fields: [{ label: "Size", type: "number", unit: "pixels", integer: true, minimum: 1, maximum: 256 }], defaults: [16] },
  { id: "bitmap", category: "Display", label: "Draw bitmap", command: "bitmap", kind: "call",
    fields: [{ label: "Bitmap file", type: "asset", asset: { kind: "bitmaps", extensions: IMAGE_EXTENSIONS } }], defaults: ["title.png"] },
  { id: "player-stance", category: "Player", label: "Play player stance", command: "playerstance", kind: "call",
    fields: [{ label: "Player handle", type: "number", integer: true }, { label: "Stance", type: "string" }], defaults: [0, "wave"] },
  { id: "fight", category: "Fight", label: "Start a skill fight", command: "fight", kind: "call",
    fields: [{ label: "Skill", type: "number", integer: true, minimum: 0 }, { label: "Background", type: "asset", asset: { kind: "backgrounds", extensions: [".bkg"] } }],
    defaults: [1, "field.bkg"] },
  { id: "condition", category: "Control", label: "If condition", command: "if", kind: "condition",
    fields: [{ label: "Condition", type: "condition" }], defaults: ["gold > 10"] },
  { id: "give-item", category: "Items", label: "Give item", command: "giveitem", kind: "call",
    fields: [{ label: "Item file", type: "asset", asset: { kind: "items", extensions: [".itm"] } }], defaults: ["potion.itm"] },
  { id: "take-item", category: "Items", label: "Take item", command: "takeitem", kind: "call",
    fields: [{ label: "Item file", type: "asset", asset: { kind: "items", extensions: [".itm"] } }], defaults: ["potion.itm"] },
  { id: "set-variable", category: "Variables", label: "Set variable", command: "=", kind: "assignment",
    fields: [{ label: "Variable", type: "variable" }, { label: "Number", type: "number" }], defaults: ["gold", 0] },
  { id: "wait-key", category: "Input", label: "Wait for key", command: "wait", kind: "call", fields: [], defaults: [] },
  { id: "delay", category: "Input", label: "Delay", command: "delay", kind: "call",
    fields: [{ label: "Seconds", type: "number", unit: "seconds", minimum: 0 }], defaults: [1] },
  { id: "prompt", category: "Input", label: "Ask for text", command: "prompt", kind: "call",
    fields: [{ label: "Question", type: "string" }, { label: "Result variable", type: "variable" }], defaults: ["Your name?", "answer"] },
  { id: "get-gold", category: "Info", label: "Read gold", command: "getgp", kind: "call",
    fields: [{ label: "Result variable", type: "variable" }], defaults: ["gold"] },
  { id: "get-level", category: "Info", label: "Read player level", command: "getlevel", kind: "call",
    fields: [{ label: "Player handle", type: "number", integer: true }, { label: "Result variable", type: "variable" }], defaults: [0, "level"] },
];

/** The default cell size of script text until a `fontsize` card changes it (the engine's UI default). */
export const DEFAULT_VISUAL_FONT_SIZE = 8;
/** The preview screen the layout canvas draws; it is a preview only and is never saved. */
export const VISUAL_PREVIEW_SCREEN = { width: 640, height: 480 } as const;

/** A source-backed Show message card. Offsets use the program snapshot's LF-only UTF-16 text. */
export interface ShowMessageCard {
  readonly type: "show-message";
  readonly message: string;
  readonly from: number;
  readonly to: number;
  readonly line: number;
}

/** A supported one-line command or assignment. */
export interface VisualEventCard {
  readonly type: "event";
  readonly templateId: string;
  readonly values: readonly VisualEventValue[];
  readonly from: number;
  readonly to: number;
  readonly line: number;
  readonly source: string;
}

/** A simple condition header plus its complete brace-delimited body. The body remains read-only source. */
export interface VisualConditionCard {
  readonly type: "condition";
  readonly condition: string;
  readonly body: string;
  readonly conditionFrom: number;
  readonly conditionTo: number;
  readonly from: number;
  readonly to: number;
  readonly line: number;
}

/** Unsupported contiguous source. It remains visible and is never rewritten by card operations. */
export interface OpaqueProgramRegion {
  readonly type: "opaque";
  readonly text: string;
  readonly from: number;
  readonly to: number;
  readonly line: number;
}

export type VisualProgramRegion = ShowMessageCard | VisualEventCard | VisualConditionCard | OpaqueProgramRegion;
export type EditableVisualEvent = ShowMessageCard | VisualEventCard | VisualConditionCard;

/** All visual edits act on the source document; hosts apply the returned edit through its shared undo stack. */
export type VisualEventAction =
  | { readonly type: "add"; readonly message: string; readonly at?: number }
  | { readonly type: "add-template"; readonly templateId: string; readonly at?: number }
  | { readonly type: "message"; readonly from: number; readonly message: string }
  | { readonly type: "edit"; readonly from: number; readonly values: readonly VisualEventValue[] }
  | { readonly type: "condition"; readonly from: number; readonly condition: string }
  | { readonly type: "delete"; readonly from: number }
  | { readonly type: "move"; readonly from: number; readonly x: number; readonly y: number }
  | { readonly type: "nudge"; readonly from: number; readonly dx: number; readonly dy: number }
  | { readonly type: "reorder"; readonly from: number; readonly direction: "up" | "down" }
  | { readonly type: "open"; readonly from: number };

export interface VisualProgramProjection {
  readonly source: string;
  readonly compiled: boolean;
  readonly regions: readonly VisualProgramRegion[];
  readonly lexicalError: boolean;
}

export type VisualEventEditResult =
  | { readonly ok: true; readonly edit: TextEdit }
  | { readonly ok: false; readonly reason: string };

const MESSAGE_LINE = /^[ \t]*mwin\("([^"\r\n]*)"\)[ \t]*$/i;
const WAIT_LINE = /^[ \t]*wait\(\)[ \t]*$/i;
const CLOSE_LINE = /^[ \t]*mwincls\(\)[ \t]*$/i;
const CALL_LINE = /^([ \t]*)([A-Za-z_][A-Za-z0-9_]*)[ \t]*\((.*)\)[ \t]*$/;
const ASSIGNMENT_LINE = /^[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)[ \t]*$/;
const CONDITION_LINE = /^[ \t]*if[ \t]*\(([^()\r\n]*)\)[ \t]*\{[ \t]*$/i;
const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const CONDITION_VALUE = `(?:[A-Za-z_][A-Za-z0-9_]*|[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?|"[^"\\r\\n]*")`;
const CONDITION = new RegExp(`^\\s*${CONDITION_VALUE}\\s*(?:==|!=|<=|>=|<|>)\\s*${CONDITION_VALUE}\\s*$`);
const KEYWORDS_AFTER_BLOCK = new Set(["else", "elseif"]);

function tokenize(source: string): Token[] | null {
  try { return tokenizeObjects(source); } catch { return null; }
}

interface LineFacts {
  /** Identifiers outside any bracket, in order; commands and assignment targets are recognised from these, never from text. */
  readonly names: readonly (readonly string[])[];
  /** Whether the line's own line break ends a statement (false inside a continued statement or open bracket). */
  readonly ends: Uint8Array;
  /** Brace depth where the line starts: only depth 0 source is offered as cards. */
  readonly depth: Int32Array;
}

function classifyLines(tokens: readonly Token[], lines: readonly string[]): LineFacts {
  const names: string[][] = lines.map(() => []);
  const ends = new Uint8Array(lines.length);
  const depth = new Int32Array(lines.length);
  let brackets = 0;
  let braces = 0;
  let filled = 0;
  for (const token of tokens) {
    const index = token.line - 1;
    for (; filled <= index && filled < lines.length; filled += 1) depth[filled] = braces;
    if (token.kind === "op") {
      if (token.text === "(" || token.text === "[") brackets += 1;
      else if (token.text === ")" || token.text === "]") brackets -= 1;
      else if (token.text === "{") braces += 1;
      else if (token.text === "}") braces -= 1;
    }
    if (brackets !== 0 || index < 0 || index >= lines.length) continue;
    if (token.kind === "identifier") names[index]!.push(token.name.toLowerCase());
    else if ((token.kind === "end" || token.kind === "eof") && token.col === lines[index]!.length + 1) ends[index] = 1;
  }
  for (; filled < lines.length; filled += 1) depth[filled] = braces;
  return { names, ends, depth };
}

function opaque(source: string, compiled: boolean, lexicalError: boolean): VisualProgramProjection {
  return { source, compiled, lexicalError, regions: source.length === 0 ? [] : [{ type: "opaque", text: source, from: 0, to: source.length, line: 1 }] };
}

function startsOf(lines: readonly string[]): number[] {
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) { starts.push(offset); offset += line.length + 1; }
  return starts;
}

function splitArguments(text: string): readonly string[] | null {
  if (text.trim() === "") return [];
  const parts: string[] = [];
  let quoted = false;
  let partStart = 0;
  for (let index = 0; index <= text.length; index += 1) {
    const character = text[index];
    if (character === '"') quoted = !quoted;
    if (index === text.length || (character === "," && !quoted)) {
      const raw = text.slice(partStart, index).trim();
      if (raw === "") return null;
      parts.push(raw);
      partStart = index + 1;
    }
  }
  return quoted ? null : parts;
}

function parseValue(field: VisualEventField, raw: string): VisualEventValue | null {
  if (field.type === "string" || field.type === "asset") {
    if (raw.length < 2 || raw[0] !== '"' || raw.at(-1) !== '"') return null;
    const value = raw.slice(1, -1);
    if (value.includes('"') || encodeCp1252(value).ok === false) return null;
    return field.type === "asset" && value.trim() === "" ? null : value;
  }
  if (field.type === "variable") return VARIABLE.test(raw) ? raw : null;
  if (!NUMBER.test(raw)) return null;
  const value = Number(raw);
  return numberProblem(field, value) === null ? value : null;
}

function numberProblem(field: VisualEventField, value: number): string | null {
  const unit = field.unit === undefined ? "" : ` (${field.unit})`;
  if (!Number.isFinite(value)) return `${field.label} must be a number.`;
  if (field.integer === true && !Number.isInteger(value)) return `${field.label} must be a whole number${unit}.`;
  if (field.minimum !== undefined && value < field.minimum) return `${field.label} must be at least ${field.minimum}${unit}.`;
  if (field.maximum !== undefined && value > field.maximum) return `${field.label} must be at most ${field.maximum}${unit}.`;
  return null;
}

function parseCall(template: VisualEventTemplate, line: string): readonly VisualEventValue[] | null {
  const match = CALL_LINE.exec(line);
  if (match === null || match[2]!.toLowerCase() !== template.command) return null;
  const args = splitArguments(match[3]!);
  if (args === null || args.length !== template.fields.length) return null;
  const values: VisualEventValue[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = parseValue(template.fields[index]!, args[index]!);
    if (value === null) return null;
    values.push(value);
  }
  return values;
}

const CALL_TEMPLATES = new Map(VISUAL_EVENT_TEMPLATES.filter((item) => item.kind === "call").map((item) => [item.command, item]));
const ASSIGN_TEMPLATE = VISUAL_EVENT_TEMPLATES.find((item) => item.kind === "assignment")!;

function conditionCard(
  source: string,
  lines: readonly string[],
  starts: readonly number[],
  tokens: readonly Token[],
  line: number,
): VisualConditionCard | null {
  const match = CONDITION_LINE.exec(lines[line]!);
  if (match === null || !CONDITION.test(match[1]!)) return null;
  const openIndex = tokens.findIndex((token) => token.kind === "op" && token.text === "{" && token.line === line + 1);
  if (openIndex === -1) return null;
  let depth = 0;
  let closeIndex = -1;
  for (let index = openIndex; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.kind !== "op") continue;
    if (token.text === "{") depth += 1;
    else if (token.text === "}") {
      depth -= 1;
      if (depth === 0) { closeIndex = index; break; }
    }
  }
  if (closeIndex === -1) return null;
  const close = tokens[closeIndex]!;
  // A following `else` would be orphaned by editing or deleting this block, so the whole chain stays opaque.
  const after = tokens.slice(closeIndex + 1).find((token) => token.kind !== "end");
  if (after?.kind === "identifier" && KEYWORDS_AFTER_BLOCK.has(after.name.toLowerCase())) return null;
  const closeLine = close.line - 1;
  if (!/^[ \t]*\}[ \t]*$/.test(lines[closeLine]!)) return null;
  const from = starts[line]!;
  const to = starts[closeLine]! + lines[closeLine]!.length + (closeLine + 1 < lines.length ? 1 : 0);
  const conditionFrom = from + lines[line]!.indexOf("(") + 1;
  return {
    type: "condition", condition: match[1]!.trim(), body: source.slice(starts[line]! + lines[line]!.length + 1, starts[closeLine]!),
    conditionFrom, conditionTo: conditionFrom + match[1]!.length, from, to, line: line + 1,
  };
}

/**
 * Recognise only the reviewed templates whose saved source can be read back into the same card, at the top level of
 * the program. Token boundaries come from the core lexer; everything else stays in its original opaque region.
 */
export function projectVisualProgram(source: string, compiled = false): VisualProgramProjection {
  if (compiled) return opaque(source, true, false);
  const tokens = tokenize(source);
  if (tokens === null) return opaque(source, false, true);
  const lines = source.split("\n");
  const starts = startsOf(lines);
  const facts = classifyLines(tokens, lines);
  const regions: VisualProgramRegion[] = [];
  let opaqueStart = 0;
  let opaqueLine = 1;
  const flushOpaque = (end: number, endLine: number): void => {
    if (end <= opaqueStart) return;
    regions.push({ type: "opaque", text: source.slice(opaqueStart, end), from: opaqueStart, to: end, line: opaqueLine });
    opaqueStart = end;
    opaqueLine = endLine;
  };
  const only = (line: number, name: string): boolean => facts.names[line]!.length === 1 && facts.names[line]![0] === name && facts.ends[line] === 1;
  const lineTo = (line: number): number => starts[line]! + lines[line]!.length + (line + 1 < lines.length ? 1 : 0);
  for (let line = 0; line < lines.length; line += 1) {
    if (facts.depth[line] !== 0 || (line > 0 && facts.ends[line - 1] !== 1)) continue;
    if (only(line, "mwin") && MESSAGE_LINE.test(lines[line]!)
      && line + 2 < lines.length && only(line + 1, "wait") && WAIT_LINE.test(lines[line + 1]!)
      && only(line + 2, "mwincls") && CLOSE_LINE.test(lines[line + 2]!)) {
      const to = lineTo(line + 2);
      flushOpaque(starts[line]!, line + 1);
      regions.push({ type: "show-message", message: MESSAGE_LINE.exec(lines[line]!)![1]!, from: starts[line]!, to, line: line + 1 });
      opaqueStart = to;
      opaqueLine = line + 4;
      line += 2;
      continue;
    }
    const condition = conditionCard(source, lines, starts, tokens, line);
    if (condition !== null) {
      flushOpaque(condition.from, condition.line);
      regions.push(condition);
      opaqueStart = condition.to;
      opaqueLine = condition.line + condition.body.split("\n").length + 1;
      while (line + 1 < lines.length && starts[line + 1]! < condition.to) line += 1;
      continue;
    }
    if (facts.ends[line] !== 1 || facts.names[line]!.length !== 1) continue;
    const name = facts.names[line]![0]!;
    const call = CALL_TEMPLATES.get(name);
    let template: VisualEventTemplate | undefined;
    let values: readonly VisualEventValue[] | null = null;
    if (call !== undefined) {
      template = call;
      values = parseCall(call, lines[line]!);
    } else {
      const assignment = ASSIGNMENT_LINE.exec(lines[line]!);
      if (assignment !== null && assignment[1]!.toLowerCase() === name && name !== "if") {
        const number = Number(assignment[2]);
        if (Number.isFinite(number)) { template = ASSIGN_TEMPLATE; values = [assignment[1]!, number]; }
      }
    }
    if (template === undefined || values === null) continue;
    const from = starts[line]!;
    const to = lineTo(line);
    flushOpaque(from, line + 1);
    regions.push({ type: "event", templateId: template.id, values, from, to, line: line + 1, source: lines[line]! });
    opaqueStart = to;
    opaqueLine = line + 2;
  }
  flushOpaque(source.length, lines.length);
  return { source, compiled: false, lexicalError: false, regions };
}

function safeString(value: string): string | null {
  if (value.includes('"') || value.includes("\r") || value.includes("\n")) return null;
  const encoded = encodeCp1252(value);
  return encoded.ok ? value : null;
}

type Encoded = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly reason: string };

function encodeValue(field: VisualEventField, value: VisualEventValue): Encoded {
  if (field.type === "condition") {
    if (typeof value !== "string" || !CONDITION.test(value)) return { ok: false, reason: "Use a simple comparison between a variable, number or quoted string, such as gold > 10." };
    return /[\r\n]/.test(value) || !encodeCp1252(value).ok
      ? { ok: false, reason: "The condition must be Windows-1252 text without line breaks." }
      : { ok: true, text: value.trim() };
  }
  if (field.type === "string" || field.type === "asset") {
    if (typeof value !== "string") return { ok: false, reason: `${field.label} must be text.` };
    if (field.type === "asset" && value.trim() === "") return { ok: false, reason: `${field.label} must name a project file.` };
    return safeString(value) === null
      ? { ok: false, reason: `${field.label} must be Windows-1252 text without a double quote or line break.` }
      : { ok: true, text: `"${value}"` };
  }
  if (field.type === "variable") {
    return typeof value === "string" && VARIABLE.test(value) ? { ok: true, text: value }
      : { ok: false, reason: `${field.label} must be a variable name: letters, digits and underscores, not starting with a digit.` };
  }
  if (typeof value !== "number") return { ok: false, reason: `${field.label} must be a number.` };
  const problem = numberProblem(field, value);
  return problem === null ? { ok: true, text: String(value) } : { ok: false, reason: problem };
}

function encodeAll(template: VisualEventTemplate, values: readonly VisualEventValue[]): { readonly ok: true; readonly texts: readonly string[] } | { readonly ok: false; readonly reason: string } {
  if (values.length !== template.fields.length) return { ok: false, reason: "The event fields do not match this supported template." };
  const texts: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const encoded = encodeValue(template.fields[index]!, values[index]!);
    if (!encoded.ok) return encoded;
    texts.push(encoded.text);
  }
  return { ok: true, texts };
}

function generate(template: VisualEventTemplate, texts: readonly string[]): string {
  return template.kind === "condition" ? `if (${texts[0]}) {\n}`
    : template.kind === "assignment" ? `${texts[0]} = ${texts[1]}`
      : `${template.command}(${texts.join(", ")})`;
}

const STALE = "The program changed since this card was opened. Reopen the visual view before editing.";

function event(projection: VisualProgramProjection, from: number): EditableVisualEvent | undefined {
  return projection.regions.find((region): region is EditableVisualEvent => region.type !== "opaque" && region.from === from);
}

function refusal(projection: VisualProgramProjection): string | null {
  if (projection.compiled) return "Compiled programs cannot be visually edited.";
  if (projection.lexicalError) return "The program has a lexical error; fix it in the text editor before editing a visual event.";
  return null;
}

function safeEnd(projection: VisualProgramProjection): string | null {
  const blocked = refusal(projection);
  if (blocked !== null) return blocked;
  const source = projection.source;
  if (source.length === 0) return null;
  const tokens = tokenize(source.endsWith("\n") ? source : `${source}\n`);
  if (tokens === null) return "The program has a lexical error; fix it in the text editor before adding a visual event.";
  const unclosed: string[] = [];
  const closing = { ")": "(", "]": "[", "}": "{" } as const;
  for (const token of tokens) {
    if (token.kind !== "op") continue;
    if (token.text === "{" || token.text === "(" || token.text === "[") unclosed.push(token.text);
    if ((token.text === "}" || token.text === ")" || token.text === "]") && unclosed.pop() !== closing[token.text]) {
      return "The program has an unmatched delimiter; fix it in the text editor before adding a visual event.";
    }
  }
  if (unclosed.length !== 0) return "Finish the open block or expression before adding a visual event.";
  const end = source.endsWith("\n") ? source.length - 1 : source.length;
  const lastLine = tokens.at(-1)!.line - 1;
  const endColumn = end === 0 ? 1 : end - source.lastIndexOf("\n", end - 1);
  return tokens.some((token) => token.kind === "end" && token.line === lastLine && token.col === endColumn)
    ? null : "Finish the continued statement before adding a visual event.";
}

/**
 * Insert whole lines at the end of the program or at a card boundary (`at`). A boundary is the start of the program or
 * of a supported card: always a statement boundary at the top level, so no handwritten construct is split.
 */
function insert(projection: VisualProgramProjection, text: string, at?: number): VisualEventEditResult {
  if (at === undefined || at === projection.source.length) {
    const unsafe = safeEnd(projection);
    if (unsafe !== null) return { ok: false, reason: unsafe };
    const trailingBreak = projection.source.endsWith("\n");
    const prefix = projection.source.length === 0 || trailingBreak ? "" : "\n";
    return { ok: true, edit: { from: projection.source.length, to: projection.source.length, text: `${prefix}${text}${trailingBreak ? "\n" : ""}` } };
  }
  const blocked = refusal(projection);
  if (blocked !== null) return { ok: false, reason: blocked };
  if (at !== 0 && !projection.regions.some((region) => region.type !== "opaque" && region.from === at)) return { ok: false, reason: STALE };
  return { ok: true, edit: { from: at, to: at, text: `${text}\n` } };
}

/** Add the canonical runnable message sequence at the end or before a card without changing other source. */
export function addShowMessage(projection: VisualProgramProjection, message = "", at?: number): VisualEventEditResult {
  const checked = safeString(message);
  if (checked === null) return { ok: false, reason: "A Show message must be Windows-1252 text without a double quote or line break." };
  return insert(projection, `mwin("${checked}")\nwait()\nmwincls()`, at);
}

/** Add one of the reviewed command templates, with its documented defaults, at the end or before a card. */
export function addVisualTemplate(projection: VisualProgramProjection, templateId: string, at?: number): VisualEventEditResult {
  const template = VISUAL_EVENT_TEMPLATES.find((item) => item.id === templateId);
  if (template === undefined) return { ok: false, reason: "This visual event template is not supported." };
  const encoded = encodeAll(template, template.defaults);
  if (!encoded.ok) return { ok: false, reason: "This visual event template has invalid defaults." };
  return insert(projection, generate(template, encoded.texts), at);
}

/** Replace only a Show message literal after verifying its source position is still current. */
export function editShowMessage(projection: VisualProgramProjection, from: number, message: string): VisualEventEditResult {
  const blocked = refusal(projection);
  if (blocked !== null) return { ok: false, reason: blocked };
  const card = event(projection, from);
  if (card?.type !== "show-message") return { ok: false, reason: STALE };
  const checked = safeString(message);
  if (checked === null) return { ok: false, reason: "A Show message must be Windows-1252 text without a double quote or line break." };
  const literalFrom = projection.source.indexOf('"', card.from) + 1;
  return { ok: true, edit: { from: literalFrom, to: literalFrom + card.message.length, text: checked } };
}

/** Edit all typed fields of one supported card as one undoable replacement of that card's own statement. */
export function editVisualEvent(projection: VisualProgramProjection, from: number, values: readonly VisualEventValue[]): VisualEventEditResult {
  const blocked = refusal(projection);
  if (blocked !== null) return { ok: false, reason: blocked };
  const card = event(projection, from);
  if (card?.type !== "event") return { ok: false, reason: STALE };
  const template = VISUAL_EVENT_TEMPLATES.find((item) => item.id === card.templateId);
  if (template === undefined) return { ok: false, reason: STALE };
  const encoded = encodeAll(template, values);
  if (!encoded.ok) return encoded;
  const indent = /^[ \t]*/.exec(card.source)![0].length;
  return { ok: true, edit: { from: card.from + indent, to: card.from + card.source.length, text: generate(template, encoded.texts) } };
}

/** Change only the parsed condition expression; its complete body remains byte-for-byte source. */
export function editVisualCondition(projection: VisualProgramProjection, from: number, condition: string): VisualEventEditResult {
  const blocked = refusal(projection);
  if (blocked !== null) return { ok: false, reason: blocked };
  const card = event(projection, from);
  if (card?.type !== "condition") return { ok: false, reason: "The program changed since this condition was opened. Reopen the visual view before editing." };
  if (!CONDITION.test(condition)) return { ok: false, reason: "Use a simple comparison between a variable, number or quoted string, such as gold > 10." };
  if (/[\r\n]/.test(condition) || !encodeCp1252(condition).ok) return { ok: false, reason: "The condition must be Windows-1252 text without line breaks." };
  return { ok: true, edit: { from: card.conditionFrom, to: card.conditionTo, text: condition.trim() } };
}

/** Delete exactly one card or condition block; other source, including opaque bytes, remains untouched. */
export function deleteVisualEvent(projection: VisualProgramProjection, from: number): VisualEventEditResult {
  const blocked = refusal(projection);
  if (blocked !== null) return { ok: false, reason: blocked };
  const card = event(projection, from);
  if (card === undefined) return { ok: false, reason: STALE };
  return { ok: true, edit: { from: card.from, to: card.to, text: "" } };
}

/** A command that is placed on the screen, as the layout canvas shows it. */
export interface PlacedVisualEvent {
  readonly from: number;
  readonly line: number;
  readonly templateId: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly unit: VisualEventPlacement["unit"];
  /** Pixels per unit for this card: the font size in force for cells, 1 for pixels. */
  readonly cell: number;
  /** Logical-pixel origin by the command's own rule: `trunc((x - 1) * size)` for cells (E-56), x for pixels. */
  readonly pixelX: number;
  readonly pixelY: number;
  readonly text: string;
}

/** The layout canvas's items, in program order, with the font size each one is drawn at. */
export function placedVisualEvents(projection: VisualProgramProjection, initialFontSize = DEFAULT_VISUAL_FONT_SIZE): readonly PlacedVisualEvent[] {
  const placed: PlacedVisualEvent[] = [];
  let size = initialFontSize;
  for (const region of projection.regions) {
    if (region.type !== "event") continue;
    const template = VISUAL_EVENT_TEMPLATES.find((item) => item.id === region.templateId);
    if (template?.id === "font-size") size = Number(region.values[0]);
    const placement = template?.placement;
    if (template === undefined || placement === undefined) continue;
    const x = Number(region.values[placement.xField]);
    const y = Number(region.values[placement.yField]);
    const cells = placement.unit === "cells";
    placed.push({
      from: region.from, line: region.line, templateId: template.id, label: template.label, x, y, unit: placement.unit,
      cell: cells ? size : 1,
      pixelX: cells ? Math.trunc((x - 1) * size) : x,
      pixelY: cells ? Math.trunc((y - 1) * size) : y,
      text: String(region.values[placement.textField]),
    });
  }
  return placed;
}

function placedCard(projection: VisualProgramProjection, from: number): { readonly card: VisualEventCard; readonly placement: VisualEventPlacement } | null {
  const card = event(projection, from);
  if (card?.type !== "event") return null;
  const placement = VISUAL_EVENT_TEMPLATES.find((item) => item.id === card.templateId)?.placement;
  return placement === undefined ? null : { card, placement };
}

/** Move a placed card from the canvas or its numeric inputs, preserving its command and all neighboring source. */
export function moveVisualEvent(projection: VisualProgramProjection, from: number, x: number, y: number): VisualEventEditResult {
  const blocked = refusal(projection);
  if (blocked !== null) return { ok: false, reason: blocked };
  const target = placedCard(projection, from);
  if (target === null) return { ok: false, reason: "This event has no screen position to move." };
  const values = [...target.card.values];
  values[target.placement.xField] = x;
  values[target.placement.yField] = y;
  return editVisualEvent(projection, from, values);
}

/** Nudge a placed event by whole units (one, or ten with Shift) through the same validated path as pointer placement. */
export function nudgeVisualEvent(projection: VisualProgramProjection, from: number, dx: number, dy: number): VisualEventEditResult {
  const target = placedCard(projection, from);
  if (target === null) return { ok: false, reason: "This event has no screen position to move." };
  const { xField, yField } = target.placement;
  const sum = (a: VisualEventValue | undefined, b: number): number => Number((Number(a) + b).toFixed(6));
  return moveVisualEvent(projection, from, sum(target.card.values[xField], dx), sum(target.card.values[yField], dy));
}

/** Swap a card with its neighbour inside one contiguous run of supported cards; opaque source is never crossed. */
export function reorderVisualEvent(projection: VisualProgramProjection, from: number, direction: "up" | "down"): VisualEventEditResult {
  const blocked = refusal(projection);
  if (blocked !== null) return { ok: false, reason: blocked };
  const index = projection.regions.findIndex((region) => region.type !== "opaque" && region.from === from);
  const card = projection.regions[index];
  const neighbour = projection.regions[index + (direction === "up" ? -1 : 1)];
  if (index < 0 || card === undefined || neighbour === undefined || card.type === "opaque" || neighbour.type === "opaque") {
    return { ok: false, reason: "Events can be reordered only beside another supported event; opaque source stays in place." };
  }
  const first = direction === "up" ? neighbour : card;
  const second = direction === "up" ? card : neighbour;
  const firstText = projection.source.slice(first.from, first.to);
  const secondText = projection.source.slice(second.from, second.to);
  // Only the last statement of a program may lack its line break; it keeps that property in its new position.
  const replacement = secondText.endsWith("\n") ? secondText + firstText : `${secondText}\n${firstText.slice(0, -1)}`;
  return { ok: true, edit: { from: first.from, to: second.to, text: replacement } };
}

/** Apply an action that edits this projection; navigation is handled by the host without writing source. */
export function applyVisualEventAction(projection: VisualProgramProjection, action: VisualEventAction): VisualEventEditResult {
  switch (action.type) {
    case "add": return addShowMessage(projection, action.message, action.at);
    case "add-template": return addVisualTemplate(projection, action.templateId, action.at);
    case "message": return editShowMessage(projection, action.from, action.message);
    case "edit": return editVisualEvent(projection, action.from, action.values);
    case "condition": return editVisualCondition(projection, action.from, action.condition);
    case "delete": return deleteVisualEvent(projection, action.from);
    case "move": return moveVisualEvent(projection, action.from, action.x, action.y);
    case "nudge": return nudgeVisualEvent(projection, action.from, action.dx, action.dy);
    case "reorder": return reorderVisualEvent(projection, action.from, action.direction);
    case "open": return { ok: false, reason: "Navigation does not edit program text." };
  }
}

/** A short label for an action, used as its undo-history entry. */
export function visualEventActionLabel(action: VisualEventAction): string {
  switch (action.type) {
    case "add": return "Add Show message";
    case "add-template": return `Add ${VISUAL_EVENT_TEMPLATES.find((item) => item.id === action.templateId)?.label ?? "visual event"}`;
    case "message": return "Edit Show message";
    case "edit": return "Edit visual event";
    case "condition": return "Edit visual condition";
    case "delete": return "Remove visual event";
    case "move": return "Place visual event";
    case "nudge": return "Nudge visual event";
    case "reorder": return "Reorder visual event";
    case "open": return "Open visual event source";
  }
}
