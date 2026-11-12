import { foldAscii } from "@tk-reawakened/core";
import type { HelpEntry } from "@tk-reawakened/script-tools";
import type { SignatureHelp } from "vscode-languageserver-protocol";

export function documentationText(entry: HelpEntry): string {
  return entry.behaviour === null ? (entry.summary ?? "") : `${entry.summary ?? ""}\n\n${entry.behaviour}`;
}

type Frame = { readonly delimiter: "(" | "[" | "{"; readonly name: string | null; readonly legacyStandalone: boolean; argument: number };

/** Name immediately before `(`, excluding member calls and declarations. */
function callName(source: string, open: number): string | null {
  let end = open;
  while (end > 0 && (source[end - 1] === " " || source[end - 1] === "\t")) end--;
  if (end > 0 && (source[end - 1] === "!" || source[end - 1] === "$")) end--;
  let start = end;
  while (start > 0 && /[A-Za-z0-9_]/.test(source[start - 1]!)) start--;
  const name = source.slice(start, end);
  if (!/[A-Za-z_]/.test(name)) return null;
  let previous = start;
  while (previous > 0 && (source[previous - 1] === " " || source[previous - 1] === "\t")) previous--;
  if (source[previous - 1] === "." || source[previous - 1] === ">") return "";
  if (/\b(?:function|method)\s+$/i.test(source.slice(0, start))) return "";
  return foldAscii(name);
}

/** Scan lexical structure only; unlike the parser it accepts unfinished calls. */
function callAt(source: string, offset: number, languageId: string): { readonly name: string; readonly argument: number } | null {
  const stack: Frame[] = [];
  let state: "code" | "string" | "line-comment" | "block-comment" = "code";
  let first = true;
  let lineStart = 0;
  let continued = false;
  let legacyClose = -1;
  for (let index = 0; index < offset; index++) {
    const char = source[index]!;
    const next = source[index + 1];
    if (char === "\n") {
      if (state === "string") return null;
      const line = source.slice(lineStart, index).replace(/\/\/.*$/, "");
      continued = /(?:^|\s)_\s*\r?$/.test(line);
      lineStart = index + 1;
      first = true;
      legacyClose = -1;
      if (state === "line-comment") state = "code";
      continue;
    }
    if (state === "line-comment") continue;
    if (state === "block-comment") {
      if (char === "*" && next === "/") { state = "code"; index++; }
      continue;
    }
    if (state === "string") {
      if (char === '"') state = "code";
      continue;
    }
    if (char === " " || char === "\t" || char === "\r") continue;
    if ((char === "/" && next === "/") || (char === "*" && next === "*") || (char === "*" && first && !continued) || (char === "*" && legacyClose >= 0 && index > legacyClose + 1) || (char === "#" && first && languageId !== "rpgcode-tk2")) {
      state = "line-comment";
      continue;
    }
    if (char === "/" && next === "*") { state = "block-comment"; index++; continue; }
    legacyClose = -1;
    first = false;
    if (char === '"') { state = "string"; continue; }
    if (char === "(" || char === "[" || char === "{") {
      const legacyStandalone = char === "(" && languageId === "rpgcode-tk2" && /^\s*#\s*[A-Za-z0-9_]+[!$]?\s*$/.test(source.slice(lineStart, index));
      stack.push({ delimiter: char, name: char === "(" ? callName(source, index) : null, legacyStandalone, argument: 0 });
    } else if (char === ")" || char === "]" || char === "}") {
      const expected = char === ")" ? "(" : char === "]" ? "[" : "{";
      const frame = stack.pop();
      if (frame?.delimiter !== expected) return null;
      if (frame.legacyStandalone) legacyClose = index;
    } else if (char === "," && stack.at(-1)?.delimiter === "(") {
      stack[stack.length - 1]!.argument++;
    }
  }
  if (state === "line-comment" || state === "block-comment") return null;
  for (let index = stack.length - 1; index >= 0; index--) {
    const frame = stack[index]!;
    if (frame.delimiter === "(" && frame.name !== null) return { name: frame.name, argument: frame.argument };
  }
  return null;
}

/** Resolve a call tip from the same registered command documentation as hover. */
export function signatureHelp(source: string, offset: number, languageId: string, help: readonly HelpEntry[]): SignatureHelp | null {
  const call = callAt(source, offset, languageId);
  if (call === null) return null;
  const entry = help.find((item) => foldAscii(item.name) === call.name && item.access === "public");
  if (entry === undefined) return null;
  const parameters = entry.params.map((param) => ({
    label: param.name,
    ...(param.summary === null ? {} : { documentation: param.summary }),
  }));
  const rendered = entry.params.map((param) => {
    const name = `${param.byRef ? "&" : ""}${param.name}${param.variadic ? "..." : ""}`;
    return param.optional ? `[${name}]` : name;
  });
  const last = entry.params.length - 1;
  const activeParameter = call.argument <= last ? call.argument : last >= 0 && entry.params[last]!.variadic ? last : null;
  return {
    signatures: [{
      label: `${entry.name}(${rendered.join(", ")})`,
      documentation: { kind: "markdown", value: documentationText(entry) },
      parameters,
    }],
    activeSignature: 0,
    ...(activeParameter === null ? {} : { activeParameter }),
  };
}
