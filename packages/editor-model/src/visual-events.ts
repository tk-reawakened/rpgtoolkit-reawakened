import { encodeCp1252, tokenizeObjects, type Token } from "@tk-reawakened/core";
import type { TextEdit } from "./program-document.ts";

/** A source-backed Show message card. Offsets use the program snapshot's LF-only UTF-16 text. */
export interface ShowMessageCard {
  readonly type: "show-message";
  readonly message: string;
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

export type VisualProgramRegion = ShowMessageCard | OpaqueProgramRegion;

/** A projection of one source snapshot; the original string is retained for guarded mutations. */
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

function tokenize(source: string): Token[] | null {
  try {
    return tokenizeObjects(source);
  } catch {
    return null;
  }
}

const STATEMENT_END = 1;
const MESSAGE = 2;
const WAIT = 4;
const CLEAR = 8;

function classifyLines(tokens: readonly Token[], lines: readonly string[]): Uint8Array {
  const flags = new Uint8Array(lines.length);
  let depth = 0;
  for (const token of tokens) {
    if (token.kind === "op") {
      if (token.text === "(" || token.text === "[") depth += 1;
      if (token.text === ")" || token.text === "]") depth -= 1;
    }
    if (depth !== 0) continue;
    const index = token.line - 1;
    const bit = token.kind === "end" ? token.col === lines[index]!.length + 1 ? STATEMENT_END : 0
      : token.kind !== "identifier" ? 0
        : token.name === "mwin" ? MESSAGE : token.name === "wait" ? WAIT : token.name === "mwincls" ? CLEAR : 0;
    flags[index] = flags[index]! | bit;
  }
  return flags;
}

function opaque(source: string, compiled: boolean, lexicalError: boolean): VisualProgramProjection {
  return {
    source,
    compiled,
    lexicalError,
    regions: source.length === 0 ? [] : [{ type: "opaque", text: source, from: 0, to: source.length, line: 1 }],
  };
}

/**
 * Recognise only an exact, standalone three-line message sequence. Token boundaries come from the core lexer
 * (docs/spec/engine/rpgcode-tooling.md#tool-12-visual-events); unsupported source is never normalised.
 */
export function projectVisualProgram(source: string, compiled = false): VisualProgramProjection {
  if (compiled) return opaque(source, true, false);
  const tokens = tokenize(source);
  if (tokens === null) return opaque(source, false, true);
  const lines = source.split("\n");
  const flags = classifyLines(tokens, lines);
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const regions: VisualProgramRegion[] = [];
  let opaqueStart = 0;
  let opaqueLine = 1;
  const flushOpaque = (end: number, endLine: number): void => {
    if (end <= opaqueStart) return;
    regions.push({ type: "opaque", text: source.slice(opaqueStart, end), from: opaqueStart, to: end, line: opaqueLine });
    opaqueStart = end;
    opaqueLine = endLine;
  };
  for (let line = 0; line + 2 < lines.length; line += 1) {
    if ((flags[line]! & (MESSAGE | STATEMENT_END)) !== (MESSAGE | STATEMENT_END)
      || (flags[line + 1]! & (WAIT | STATEMENT_END)) !== (WAIT | STATEMENT_END)
      || !(flags[line + 2]! & CLEAR) || (line > 0 && !(flags[line - 1]! & STATEMENT_END))) continue;
    const messageMatch = MESSAGE_LINE.exec(lines[line]!);
    if (messageMatch === null || !WAIT_LINE.test(lines[line + 1]!) || !CLOSE_LINE.test(lines[line + 2]!)) continue;
    const message = messageMatch[1]!;
    const firstLine = line + 1;
    const from = starts[line]!;
    const after = starts[line + 2]! + lines[line + 2]!.length;
    const hasBreakAfter = line + 3 < lines.length;
    const to = after + (hasBreakAfter ? 1 : 0);
    flushOpaque(from, firstLine);
    regions.push({ type: "show-message", message, from, to, line: firstLine });
    opaqueStart = to;
    opaqueLine = firstLine + 3;
    line += 2;
  }
  flushOpaque(source.length, lines.length);
  return { source, compiled: false, lexicalError: false, regions };
}

function messageEdit(message: string): { readonly literal: string } | { readonly reason: string } {
  if (message.includes('"') || message.includes("\r") || message.includes("\n")) {
    return { reason: "A Show message cannot contain a double quote or line break." };
  }
  const encoded = encodeCp1252(message);
  return encoded.ok ? { literal: message } : { reason: `The message cannot be saved in Windows-1252: ${encoded.error.message}` };
}

function safeEnd(projection: VisualProgramProjection): string | null {
  if (projection.compiled) return "Compiled programs cannot be visually edited.";
  if (projection.lexicalError) return "The program has a lexical error; fix it in the text editor before adding a visual event.";
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

/** Add a canonical sequence at EOF without changing prior source; refuses unsafe EOFs and compiled input. */
export function addShowMessage(projection: VisualProgramProjection, message = ""): VisualEventEditResult {
  const refusal = safeEnd(projection);
  if (refusal !== null) return { ok: false, reason: refusal };
  const checked = messageEdit(message);
  if ("reason" in checked) return { ok: false, reason: checked.reason };
  const trailingBreak = projection.source.endsWith("\n");
  const prefix = projection.source.length === 0 || trailingBreak ? "" : "\n";
  return {
    ok: true,
    edit: { from: projection.source.length, to: projection.source.length, text: `${prefix}mwin("${checked.literal}")\nwait()\nmwincls()${trailingBreak ? "\n" : ""}` },
  };
}

/** Replace only the message literal after verifying the expected card's source position is still current. */
export function editShowMessage(projection: VisualProgramProjection, from: number, message: string): VisualEventEditResult {
  if (projection.compiled || projection.lexicalError) return { ok: false, reason: "This program cannot be safely edited as a visual event." };
  const card = projection.regions.find((region) => region.type === "show-message" && region.from === from);
  if (card === undefined || card.type !== "show-message") return { ok: false, reason: "The program changed since this card was opened. Reopen the visual view before editing." };
  const checked = messageEdit(message);
  if ("reason" in checked) return { ok: false, reason: checked.reason };
  const quote = projection.source.indexOf('"', card.from);
  const literalFrom = quote + 1;
  return { ok: true, edit: { from: literalFrom, to: literalFrom + card.message.length, text: checked.literal } };
}

/** Delete exactly the current card lines, preserving every other line break and byte. */
export function deleteShowMessage(projection: VisualProgramProjection, from: number): VisualEventEditResult {
  if (projection.compiled || projection.lexicalError) return { ok: false, reason: "This program cannot be safely edited as a visual event." };
  const card = projection.regions.find((region) => region.type === "show-message" && region.from === from);
  if (card === undefined || card.type !== "show-message") return { ok: false, reason: "The program changed since this card was opened. Reopen the visual view before editing." };
  return { ok: true, edit: { from: card.from, to: card.to, text: "" } };
}
