import { deepEqual, equal, ok } from "node:assert/strict";
import test from "node:test";
import {
  commandDocumentation,
  createAssetIndex,
  assetKey,
  FIRST_PARTY_PLUGINS,
  PACKAGE_ROOT,
  utf8Encode,
  type ProgramLoader,
  type ResolvedPlugin,
} from "@tk-reawakened/core";
import { buildIndex, projectHelp } from "@tk-reawakened/script-tools";
import type {
  CodeAction,
  CodeActionParams,
  CompletionItem,
  CompletionParams,
  Diagnostic,
  DidChangeTextDocumentParams,
  DidOpenTextDocumentParams,
  DocumentSymbol,
  DocumentSymbolParams,
  Hover,
  HoverParams,
  Location,
} from "vscode-languageserver-protocol";
import { createServer, type ServerConnection } from "../src/index.ts";

/**
 * Slice 2: hover, completion, go-to-definition and the outline are lookups into
 * the TOOL-6 index and the gate-checked catalogue (docs/spec/engine/rpgcode-tooling.md#tool-1).
 * A symbol the index cannot resolve yields no location, never a guess.
 */

type Pair = {
  readonly connection: ServerConnection;
  readonly published: Diagnostic[][];
  open(uri: string, text: string): void;
  hover(uri: string, line: number, character: number): Hover | null;
  completion(uri: string, line: number, character: number): CompletionItem[];
  definition(uri: string, line: number, character: number): Location[];
  symbols(uri: string): DocumentSymbol[];
  codeActions(uri: string): CodeAction[];
};

function pair(): Pair {
  const published: Diagnostic[][] = [];
  let openHandler: (params: DidOpenTextDocumentParams) => void = () => {};
  let hoverHandler: (params: HoverParams) => Hover | null = () => null;
  let completionHandler: (params: CompletionParams) => CompletionItem[] = () => [];
  let definitionHandler: (params: HoverParams) => Location[] = () => [];
  let symbolHandler: (params: DocumentSymbolParams) => DocumentSymbol[] = () => [];
  let codeActionHandler: (params: CodeActionParams) => CodeAction[] = () => [];
  const absent = { dispose: () => {} };
  const connection: ServerConnection = {
    onInitialize: () => absent,
    onDidOpenTextDocument: (handler) => {
      openHandler = handler;
      return absent;
    },
    onDidChangeTextDocument: (_handler: (params: DidChangeTextDocumentParams) => void) => absent,
    onHover: (handler) => {
      hoverHandler = handler;
      return absent;
    },
    onCompletion: (handler) => {
      completionHandler = handler;
      return absent;
    },
    onDefinition: (handler) => {
      definitionHandler = handler;
      return absent;
    },
    onDocumentSymbol: (handler) => {
      symbolHandler = handler;
      return absent;
    },
    onCodeAction: (handler) => {
      codeActionHandler = handler;
      return absent;
    },
    sendDiagnostics: (params) => published.push(params.diagnostics),
  };
  return {
    connection,
    published,
    open: (uri, text) => openHandler({ textDocument: { uri, languageId: "rpgcode", version: 1, text } }),
    hover: (uri, line, character) => hoverHandler({ textDocument: { uri }, position: { line, character } }),
    completion: (uri, line, character) => completionHandler({ textDocument: { uri }, position: { line, character } }),
    definition: (uri, line, character) => definitionHandler({ textDocument: { uri }, position: { line, character } }),
    symbols: (uri) => symbolHandler({ textDocument: { uri } }),
    codeActions: (uri) => codeActionHandler({ textDocument: { uri }, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, context: { diagnostics: [] } }),
  };
}

const plugins: ResolvedPlugin[] = FIRST_PARTY_PLUGINS.map((definition) => ({ definition }));
const help = projectHelp(plugins);

function loader(files: Readonly<Record<string, string>>): ProgramLoader {
  const paths = Object.keys(files).map((name) => `Prg/${name}`);
  const bytes = new Map<string, Uint8Array>();
  for (const [name, text] of Object.entries(files)) bytes.set(assetKey(`Prg/${name}`), utf8Encode(text));
  return { index: createAssetIndex(paths), root: PACKAGE_ROOT, read: (key) => bytes.get(key) };
}

const MAIN = ['#include "lib.prg"', "function main() {", '  x = mwin("hi")', "}", "y = lib.helper(1)"].join("\n") + "\n";
const IMPLICIT = ["function main() {", "}", "y = lib.helper(1)"].join("\n") + "\n";
const LIB = "function helper(a) { return a }\n";

function server(files: Readonly<Record<string, string>>): Pair {
  const started = pair();
  createServer(started.connection, { loader: loader(files), plugins });
  return started;
}

test("hover is the catalogue's summary and behaviour, byte for byte", () => {
  const started = server({ "main.prg": MAIN, "lib.prg": LIB });
  started.open("file:///main.prg", MAIN);
  const hover = started.hover("file:///main.prg", 2, 7);
  ok(hover);
  const doc = commandDocumentation(plugins).find((entry) => entry.name === "mwin");
  ok(doc);
  deepEqual(hover.contents, { kind: "markdown", value: `${doc.summary}\n\n${doc.behaviour}` });
  deepEqual(hover.range, { start: { line: 2, character: 6 }, end: { line: 2, character: 10 } });
});

test("completion offers a catalogue name and a program symbol, and nothing else", () => {
  const text = "function mend() {\n  m\n}\n";
  const started = server({ "main.prg": text });
  started.open("file:///main.prg", text);
  const items = started.completion("file:///main.prg", 1, 3);
  const labels = items.map((item) => item.label);
  ok(labels.includes("mwin"), `catalogue name offered: ${labels.join(", ")}`);
  ok(labels.includes("mend"), `program symbol offered: ${labels.join(", ")}`);
  const known = new Set([
    ...help.map((entry) => entry.name.toLowerCase()),
    "mend",
    "main",
  ]);
  for (const label of labels) ok(known.has(label.toLowerCase()), `unexpected completion ${label}`);
});

test("go-to-definition lands on the included function through an explicit #include", () => {
  const started = server({ "main.prg": MAIN, "lib.prg": LIB });
  started.open("file:///main.prg", MAIN);
  const locations = started.definition("file:///main.prg", 4, 5);
  equal(locations.length, 1);
  equal(locations[0]?.uri, "prg/lib.prg");
  // The definition's anchor is the `function` keyword (TOOL-3), at column 1 of lib.prg.
  deepEqual(locations[0]?.range.start, { line: 0, character: 0 });
});

test("go-to-definition lands on the included function through file.func alone", () => {
  const started = server({ "main.prg": IMPLICIT, "lib.prg": LIB });
  started.open("file:///main.prg", IMPLICIT);
  const locations = started.definition("file:///main.prg", 2, 5);
  equal(locations.length, 1);
  equal(locations[0]?.uri, "prg/lib.prg");
});

test("go-to-definition returns nothing when no file served the include", () => {
  const started = server({ "main.prg": MAIN });
  started.open("file:///main.prg", MAIN);
  deepEqual(started.definition("file:///main.prg", 4, 5), []);
});

test("go-to-definition returns nothing for a call the index cannot resolve", () => {
  const text = "y = nothing(1)\n";
  const started = server({ "main.prg": text });
  started.open("file:///main.prg", text);
  deepEqual(started.definition("file:///main.prg", 0, 5), []);
});

test("the outline is the index's functions, classes and labels", () => {
  const text = ["function solo() {", "  :loop", "}", "class box {", "  var n", "  method m() { return 1 }", "}"].join("\n") + "\n";
  const started = server({ "main.prg": text });
  started.open("file:///main.prg", text);
  const symbols = started.symbols("file:///main.prg");
  const index = buildIndex([{ name: "file:///main.prg", ref: { kind: "inline", text, ir: "1" } }]).programs[0];
  ok(index);
  deepEqual(
    symbols.map((symbol) => symbol.name),
    [...index.functions.map((fn) => fn.qualifiedName), ...index.classes.map((cls) => cls.qualifiedName), ...index.labels.map((label) => label.name)],
  );
  const box = symbols.find((symbol) => symbol.name === "box");
  ok(box);
  deepEqual(box.children?.map((child: DocumentSymbol) => child.name), ["n", "box.m"]);
});

test("one code action per legacy form, each an edit that re-parses", () => {
  const text = ["#Mwin(Hello there)", "#ReturnMethod(1 + 2)", "#Dos", "x! = 1"].join("\n") + "\n";
  const started = server({ "main.prg": text });
  started.open("file:///main.prg", text);
  const actions = started.codeActions("file:///main.prg");
  deepEqual(
    actions.map((action) => action.kind),
    ["quickfix", "quickfix", "quickfix", "quickfix"],
  );
  const titles = actions.map((action) => action.title);
  ok(titles.some((title) => title.includes("#Mwin")));
  ok(titles.some((title) => title.includes("#ReturnMethod")));
  ok(titles.some((title) => title.includes("#Dos")));
  ok(titles.some((title) => title.includes("sigil")));
  for (const action of actions) {
    const edits = action.edit?.changes?.["file:///main.prg"] ?? [];
    ok(edits.length > 0);
    for (const item of edits) equal(typeof item.newText, "string");
  }
});

test("a row whose rewrite would change behaviour gets no code action", () => {
  const text = "if (x = 5) {\n  y = 1\n}\nm[key] = 1\nHello there\n";
  const started = server({ "main.prg": text });
  started.open("file:///main/prg", text);
  deepEqual(started.codeActions("file:///main.prg"), []);
});
