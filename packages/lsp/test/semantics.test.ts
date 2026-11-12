import { deepEqual, equal, ok, throws } from "node:assert/strict";
import test from "node:test";
import {
  commandDocumentation,
  compileProgram,
  createAssetIndex,
  assetKey,
  FIRST_PARTY_PLUGINS,
  IR_VERSION,
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
  open(uri: string, text: string, languageId?: string): void;
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
    onSignatureHelp: () => absent,
    onCodeAction: (handler) => {
      codeActionHandler = handler;
      return absent;
    },
    sendDiagnostics: (params) => published.push(params.diagnostics),
  };
  return {
    connection,
    published,
    open: (uri, text, languageId = "rpgcode") => openHandler({ textDocument: { uri, languageId, version: 1, text } }),
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

test("Toolkit 2 conversion previews an unsaved 3.1 copy without editing the project", () => {
  const text = "#Mwin(hello, world)\n#threadSleep(1, 2)\n";
  const started = server({ "main.prg": text });
  started.open("file:///main.prg", text, "rpgcode-tk2");
  const actions = started.codeActions("file:///main.prg");
  equal(actions.length, 1);
  equal(actions[0]!.edit, undefined);
  equal(actions[0]!.command?.command, "rpgcode.previewTk2Conversion");
  deepEqual(actions[0]!.command?.arguments, ['Mwin("hello", "world")\nthreadSleep(1, 2)\n']);
});

test("Toolkit 2 conversion keeps a bare index as a variable and flags it in the preview (#2050)", () => {
  const text = "#m[key!] = 1\n";
  const started = server({ "main.prg": text });
  started.open("file:///main.prg", text, "rpgcode-tk2");
  const actions = started.codeActions("file:///main.prg");
  equal(actions.length, 1);
  equal(actions[0]!.title, "Preview Toolkit 2.x conversion in an unsaved 3.1 file (1 bare index to review)");
  deepEqual(actions[0]!.command?.arguments, ['m[key] = 1 // TKR review: [key] reads the variable key; write ["key"] if a literal key was meant\n']);
});

test("Toolkit 2 conversion refuses unresolved project dependencies even when the project loader can read them", () => {
  const main = "#lib.hello()";
  const projectLoader = loader({ "main.prg": main, "lib.prg": "#Method hello() {\n  #Mwin(Hello there)\n}" });
  const original = compileProgram({ kind: "inline", text: main, ir: IR_VERSION, dialect: "tk2" }, { loader: projectLoader });
  equal(original.units.length, 2);
  throws(() => compileProgram({ kind: "inline", text: "lib.hello()", ir: IR_VERSION }, { loader: projectLoader }));
  const started = server({ "main.prg": main, "lib.prg": "#Method hello() {\n  #Mwin(Hello there)\n}" });
  started.open("file:///main.prg", main, "rpgcode-tk2");
  deepEqual(started.codeActions("file:///main.prg"), []);
});

test("3.1 editor mode does not offer an in-place edit that changes TK2 dialogue", () => {
  const text = "foo(name$)";
  const started = server({ "main.prg": text });
  started.open("file:///main.prg", text, "rpgcode");
  deepEqual(started.codeActions("file:///main.prg"), []);
});

test("ordinary 3.1 mode never guesses that assignment is Toolkit 2 equality", () => {
  const text = "if (x = 5) {\n  y = 1\n}\n";
  const started = server({ "main.prg": text });
  started.open("file:///main.prg", text);
  deepEqual(started.codeActions("file:///main.prg"), []);
  started.open("file:///legacy.prg", text, "rpgcode-tk2");
  equal(started.codeActions("file:///legacy.prg").length, 1);
});
