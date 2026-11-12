import { foldAscii } from "@tk-reawakened/core";
import type { HelpEntry } from "@tk-reawakened/script-tools";
import type { SignatureHelp } from "vscode-languageserver-protocol";

export function documentationText(entry: HelpEntry): string {
  return entry.behaviour === null ? (entry.summary ?? "") : `${entry.summary ?? ""}\n\n${entry.behaviour}`;
}

type Frame = { readonly delimiter: "(" | "[" | "{"; readonly name: string | null; readonly legacyStandalone: boolean; argument: number };

type Token = { readonly kind: "name"; readonly name: string; readonly blocked: boolean } | { readonly kind: "member" | "other" };

/** Scan lexical structure only; unlike the parser it accepts unfinished calls. */
function callAt(source: string, offset: number, languageId: string): { readonly name: string; readonly argument: number } | null {
  const stack: Frame[] = [];
  let state: "code" | "string" | "line-comment" | "block-comment" = "code";
  let previous: Token = { kind: "other" };
  let first = true;
  let lineStart = 0;
  let continued = false;
  let continuationToken = false;
  let legacyClose = -1;
  for (let index = 0; index < offset; index++) {
    const char = source[index]!;
    const next = source[index + 1];
    if (char === "\n") {
      if (state === "string") {
        // A broken string is local to its line; a later statement can still have a tip.
        state = "code";
        stack.length = 0;
        continuationToken = false;
      }
      continued = state !== "block-comment" && continuationToken;
      continuationToken = false;
      lineStart = index + 1;
      first = true;
      legacyClose = -1;
      if (!continued) previous = { kind: "other" };
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
    if (char === "/" && next === "*") { state = "block-comment"; continuationToken = false; index++; continue; }
    if (first && !continued && languageId === "rpgcode-tk2") {
      const end = source.indexOf("\n", index);
      const line = source.slice(index, end < 0 ? source.length : end).trim();
      if (!/^(?:[#*:}{]|(?:if|while|until|for|switch|case|default|else|function|return)\b)/i.test(line) && !line.includes("=") && !line.endsWith("{")) {
        state = "line-comment"; // Loose TK2 dialogue is not executable source.
        continue;
      }
    }
    legacyClose = -1;
    first = false;
    if (/[A-Za-z0-9_]/.test(char)) {
      const start = index;
      while (index + 1 < offset && /[A-Za-z0-9_]/.test(source[index + 1]!)) index++;
      const word = source.slice(start, index + 1);
      continuationToken = word === "_" && (start === lineStart || /\s/.test(source[start - 1]!));
      if (/[A-Za-z_]/.test(word)) {
        const blocked: boolean = previous.kind === "member" || (previous.kind === "name" && (previous.name === "function" || previous.name === "method"));
        previous = { kind: "name", name: foldAscii(word), blocked };
        if ((source[index + 1] === "!" || source[index + 1] === "$") && source[index + 2] !== "=") index++;
      } else {
        previous = { kind: "other" };
      }
      continue;
    }
    continuationToken = false;
    if (char === '"') { state = "string"; previous = { kind: "other" }; continue; }
    if (char === "." || (char === "-" && next === ">")) {
      previous = { kind: "member" };
      if (char === "-") index++;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") {
      const name = char === "(" && previous.kind === "name" ? (previous.blocked ? "" : previous.name) : null;
      const legacyStandalone = char === "(" && languageId === "rpgcode-tk2" && /^\s*#\s*[A-Za-z0-9_]+[!$]?\s*$/.test(source.slice(lineStart, index));
      stack.push({ delimiter: char, name, legacyStandalone, argument: 0 });
    } else if (char === ")" || char === "]" || char === "}") {
      const expected = char === ")" ? "(" : char === "]" ? "[" : "{";
      const frame = stack.pop();
      if (frame?.delimiter !== expected) stack.length = 0;
      else if (frame.legacyStandalone) legacyClose = index;
    } else if (char === "," && stack.at(-1)?.delimiter === "(") {
      stack[stack.length - 1]!.argument++;
    }
    previous = { kind: "other" };
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
