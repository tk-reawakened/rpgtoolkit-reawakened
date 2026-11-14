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
import { createServer, PROJECT_NOTIFICATION, type ServerConnection } from "../src/index.ts";
import { mainFileBytes, memoryProject } from "./project-support.ts";

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
  notify(method: string, params: unknown): void;
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
  const notifications = new Map<string, (params: unknown) => void>();
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
    onDocumentFormatting: () => absent,
    showMessage: () => {},
    onCodeAction: (handler) => {
      codeActionHandler = handler;
      return absent;
    },
    onNotification: (method, handler) => {
      notifications.set(method, handler);
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
    notify: (method, params) => notifications.get(method)?.(params),
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

const MAIN_URI = "file:///game/Prg/main.prg";
const LEGACY_URI = "file:///game/Prg/legacy.prg";
const MAIN = ['#include "lib.prg"', "function main() {", '  x = mwin("hi")', "}", "y = lib.helper(1)"].join("\n") + "\n";
const IMPLICIT = ["function main() {", "}", "y = lib.helper(1)"].join("\n") + "\n";
const LIB = "function helper(a) { return a }\n";

/** A server running the 3.1 project whose `Prg/` holds `files` (docs/spec/engine/rpgcode-tooling.md#tool-1-project). */
function server(files: Readonly<Record<string, string>>): Pair {
  const started = pair();
  createServer(started.connection, { plugins });
  const project = memoryProject(
    { "Main/game.gam": mainFileBytes("tk3"), ...Object.fromEntries(Object.entries(files).map(([name, text]) => [`Prg/${name}`, text])) },
    "Main/game.gam",
  );
  started.notify(PROJECT_NOTIFICATION, project.snapshot());
  return started;
}

test("hover is the catalogue's summary and behaviour, byte for byte", () => {
  const started = server({ "main.prg": MAIN, "lib.prg": LIB });
  started.open(MAIN_URI, MAIN);
  const hover = started.hover(MAIN_URI, 2, 7);
  ok(hover);
  const doc = commandDocumentation(plugins).find((entry) => entry.name === "mwin");
  ok(doc);
  deepEqual(hover.contents, { kind: "markdown", value: `${doc.summary}\n\n${doc.behaviour}` });
  deepEqual(hover.range, { start: { line: 2, character: 6 }, end: { line: 2, character: 10 } });
});

test("completion offers a catalogue name and a program symbol, and nothing else", () => {
  const text = "function mend() {\n  m\n}\n";
  const started = server({ "main.prg": text });
  started.open(MAIN_URI, text);
  const items = started.completion(MAIN_URI, 1, 3);
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
  started.open(MAIN_URI, MAIN);
  const locations = started.definition(MAIN_URI, 4, 5);
  equal(locations.length, 1);
  // The original document URI from the project inventory, never the folded key (#2081).
  equal(locations[0]?.uri, "file:///game/Prg/lib.prg");
  // The definition's anchor is the `function` keyword (TOOL-3), at column 1 of lib.prg.
  deepEqual(locations[0]?.range, { start: { line: 0, character: 0 }, end: { line: 0, character: 8 } });
});

test("go-to-definition lands on the included function through file.func alone", () => {
  const started = server({ "main.prg": IMPLICIT, "lib.prg": LIB });
  started.open(MAIN_URI, IMPLICIT);
  const locations = started.definition(MAIN_URI, 2, 5);
  equal(locations.length, 1);
  equal(locations[0]?.uri, "file:///game/Prg/lib.prg");
});

test("go-to-definition returns nothing when no file served the include", () => {
  const started = server({ "main.prg": MAIN });
  started.open(MAIN_URI, MAIN);
  deepEqual(started.definition(MAIN_URI, 4, 5), []);
});

test("go-to-definition returns nothing for a call the index cannot resolve", () => {
  const text = "y = nothing(1)\n";
  const started = server({ "main.prg": text });
  started.open(MAIN_URI, text);
  deepEqual(started.definition(MAIN_URI, 0, 5), []);
});

test("the outline is the index's functions, classes and labels", () => {
  const text = ["function solo() {", "  :loop", "}", "class box {", "  var n", "  method m() { return 1 }", "}"].join("\n") + "\n";
  const started = server({ "main.prg": text });
  started.open(MAIN_URI, text);
  const symbols = started.symbols(MAIN_URI);
  const index = buildIndex([{ name: MAIN_URI, ref: { kind: "inline", text, ir: "1" } }]).programs[0];
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
  started.open(MAIN_URI, text, "rpgcode-tk2");
  const actions = started.codeActions(MAIN_URI);
  equal(actions.length, 1);
  equal(actions[0]!.edit, undefined);
  equal(actions[0]!.command?.command, "rpgcode.previewTk2Conversion");
  deepEqual(actions[0]!.command?.arguments, ['Mwin("hello", "world")\nthreadSleep(1, 2)\n']);
});

test("Toolkit 2 conversion explains why quoted loose dialogue cannot be converted", () => {
  const text = 'Hi #there = "friend"';
  const started = server({ "main.prg": text });
  started.open("file:///main.prg", text, "rpgcode-tk2");
  const actions = started.codeActions("file:///main.prg");
  equal(actions.length, 1);
  ok(actions[0]!.disabled?.reason.includes("double quote"));
  equal(actions[0]!.command, undefined);
  equal(actions[0]!.edit, undefined);
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
  started.open(MAIN_URI, main, "rpgcode-tk2");
  deepEqual(started.codeActions(MAIN_URI), []);
});

test("3.1 editor mode does not offer an in-place edit that changes TK2 dialogue", () => {
  const text = "foo(name$)";
  const started = server({ "main.prg": text });
  started.open(MAIN_URI, text, "rpgcode");
  deepEqual(started.codeActions(MAIN_URI), []);
});

test("ordinary 3.1 mode never guesses that assignment is Toolkit 2 equality", () => {
  const text = "if (x = 5) {\n  y = 1\n}\n";
  const started = server({ "main.prg": text });
  started.open(MAIN_URI, text);
  deepEqual(started.codeActions(MAIN_URI), []);
  started.open(LEGACY_URI, text, "rpgcode-tk2");
  equal(started.codeActions(LEGACY_URI).length, 1);
});

// #2081: a definition is a navigable URI in its original spelling, from the running project.

function project(files: Readonly<Record<string, string>>, open: string): { pair: Pair; uri(path: string): string } {
  const started = pair();
  createServer(started.connection, { plugins });
  const memory = memoryProject({ "Main/game.gam": mainFileBytes("tk3"), ...files }, "Main/game.gam");
  started.notify(PROJECT_NOTIFICATION, memory.snapshot());
  started.open(memory.uri(open), files[open]!);
  return { pair: started, uri: memory.uri };
}

test("a definition keeps the target's spelling, folder and spaces, which its folded key loses", () => {
  const main = '#include "tools/my lib.prg"\ny = helper(1)\nz = mine()\nfunction mine() { return 1 }\n';
  const { pair: started, uri } = project({ "Prg/main.prg": main, "Prg/Tools/My Lib.PRG": "\nfunction helper(a) { return a }\n" }, "Prg/main.prg");
  const call = started.definition(uri("Prg/main.prg"), 1, 5);
  deepEqual(call.map((item) => item.uri), ["file:///game/Prg/Tools/My%20Lib.PRG"]);
  deepEqual(call[0]?.range, { start: { line: 1, character: 0 }, end: { line: 1, character: 8 } });
  deepEqual(started.definition(uri("Prg/main.prg"), 0, 3).map((item) => item.uri), ["file:///game/Prg/Tools/My%20Lib.PRG"], "the #include line navigates to the file");
  deepEqual(started.definition(uri("Prg/main.prg"), 2, 5).map((item) => item.uri), [uri("Prg/main.prg")], "a local function is in the open document, not <inline>");
});

test("two paths that fold to one key navigate to the resolver's winner", () => {
  const main = "y = lib.helper(1)\n";
  const { pair: started, uri } = project({ "Prg/main.prg": main, "Prg/Lib.prg": "function helper(a) { return a }\n", "Prg/LIB.PRG": "\n\nfunction helper(a) { return 2 }\n" }, "Prg/main.prg");
  const found = started.definition(uri("Prg/main.prg"), 0, 5);
  deepEqual(found.map((item) => [item.uri, item.range.start.line]), [["file:///game/Prg/Lib.prg", 0]]);
});

test("the outline lists only the open document's own symbols, not those of its includes", () => {
  const main = '#include "lib.prg"\nfunction mine() { return 1 }\n';
  const { pair: started, uri } = project({ "Prg/main.prg": main, "Prg/lib.prg": "function helper(a) { return a }\n:label\n" }, "Prg/main.prg");
  deepEqual(started.symbols(uri("Prg/main.prg")).map((symbol) => symbol.name), ["mine"]);
});

test("an unassessed document resolves no include and invents no location", () => {
  const started = pair();
  createServer(started.connection, { plugins });
  started.open("file:///elsewhere/main.prg", IMPLICIT);
  deepEqual(started.definition("file:///elsewhere/main.prg", 2, 5), []);
});
