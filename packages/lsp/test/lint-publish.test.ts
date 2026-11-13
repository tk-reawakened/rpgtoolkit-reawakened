import { deepEqual, equal, match } from "node:assert/strict";
import test from "node:test";
import { newProjectMainFile, writeMainFile } from "@tk-reawakened/core";
import type { Diagnostic, DidChangeTextDocumentParams, DidCloseTextDocumentParams, DidOpenTextDocumentParams } from "vscode-languageserver-protocol";
import { createServer, LINT_UNASSESSED_CODE, PROJECT_NOTIFICATION, UNASSESSED_CODE, type ServerConnection } from "../src/index.ts";
import { mainFileBytes, memoryProject, type MemoryProject } from "./project-support.ts";

/**
 * #2074: the project's lint findings are published with its `tkr-lint.json`,
 * only for an assessed document, and only against the file they are in
 * (docs/spec/engine/rpgcode-tooling.md#tool-1-project, #tool-3).
 */

type Client = {
  open(uri: string, text: string, languageId?: string): Diagnostic[];
  change(uri: string, text: string): void;
  close(uri: string): void;
  project(project: MemoryProject, revision?: number): void;
  readonly published: Map<string, Diagnostic[]>;
};

function client(): Client {
  const published = new Map<string, Diagnostic[]>();
  let open: (params: DidOpenTextDocumentParams) => void = () => {};
  let change: (params: DidChangeTextDocumentParams) => void = () => {};
  let close: (params: DidCloseTextDocumentParams) => void = () => {};
  const notifications = new Map<string, (params: unknown) => void>();
  const absent = { dispose: () => {} };
  const connection: ServerConnection = {
    onInitialize: () => absent,
    onDidOpenTextDocument: (handler) => {
      open = handler;
      return absent;
    },
    onDidChangeTextDocument: (handler) => { change = handler; return absent; },
    onDidCloseTextDocument: (handler) => { close = handler; return absent; },
    onHover: () => absent,
    onCompletion: () => absent,
    onDefinition: () => absent,
    onDocumentSymbol: () => absent,
    onSignatureHelp: () => absent,
    onDocumentFormatting: () => absent,
    showMessage: () => {},
    onCodeAction: () => absent,
    onNotification: (method, handler) => {
      notifications.set(method, handler);
      return absent;
    },
    sendDiagnostics: (params) => published.set(params.uri, params.diagnostics),
  };
  createServer(connection);
  return {
    published,
    open: (uri, text, languageId = "rpgcode") => {
      open({ textDocument: { uri, languageId, version: 1, text } });
      return published.get(uri) ?? [];
    },
    project: (project, revision = 1) => notifications.get(PROJECT_NOTIFICATION)?.(project.snapshot(revision)),
    change: (uri, text) => change({ textDocument: { uri, version: 2 }, contentChanges: [{ text }] }),
    close: (uri) => close({ textDocument: { uri } }),
  };
}

const MAIN = 'nope()\nmwin("hi")\n';

function modern(files: Readonly<Record<string, string>> = { "Prg/main.prg": MAIN }, lintConfig?: string): MemoryProject {
  return memoryProject({ "Main/game.gam": mainFileBytes("tk3"), ...files }, "Main/game.gam", lintConfig === undefined ? {} : { lintConfig });
}

function codes(diagnostics: readonly Diagnostic[]): (string | number | undefined)[] {
  return diagnostics.map((item) => item.code);
}

test("a 3.1 project publishes the unknown command and not the registered one", () => {
  const project = modern();
  const server = client();
  server.project(project);
  const found = server.open(project.uri("Prg/main.prg"), MAIN);
  deepEqual(codes(found), ["lint/unknown-command"]);
  deepEqual(found[0]?.range, { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } });
  equal(found[0]?.severity, 1, "the rule's default severity, error");
});

test("scan publishes arity warnings only for invalid calls", () => {
  const text = "scan(1, 2, 0)\nscan(1, 2)\nscan(1, 2, 0, 4)\n";
  const project = modern({ "Prg/main.prg": text });
  const server = client();
  server.project(project);
  const found = server.open(project.uri("Prg/main.prg"), text).filter((item) => item.code === "lint/command-arity");
  deepEqual(found.map((item) => item.range.start.line), [1, 2]);
  for (const item of found) match(item.message, /`scan` takes 3 parameter/);
});

test("in a Toolkit 2 project nope() is dialogue and 3.1-only rules are unassessed", () => {
  const project = memoryProject({ "Main/legacy.gam": mainFileBytes("tk2"), "Prg/main.prg": MAIN }, "Main/legacy.gam");
  const server = client();
  server.project(project);
  // Quote-free: quoted loose text is a separate Toolkit 2 frontend defect (#2100).
  const found = server.open(project.uri("Prg/main.prg"), "nope()\n", "rpgcode");
  deepEqual(codes(found), [LINT_UNASSESSED_CODE]);
  match(found[0]!.message, /style\/format \(unsupported-dialect\)/);
});

test("the selected 3.1 project publishes scoped findings, style and rule assessment", () => {
  const text = 'function helper() {\n    local(x) = 1\n    MWIN("hi")\n}\n';
  const project = modern({ "Prg/main.prg": text }, JSON.stringify({ severity: { "lint/unused-variable": "error" } }));
  const server = client();
  server.project(project);
  const found = server.open(project.uri("Prg/main.prg"), text, "rpgcode-tk2");
  deepEqual(found.map(({ code, severity }) => [code, severity]), [
    ["lint/unused-variable", 1],
    ["style/format", 4],
    [LINT_UNASSESSED_CODE, 3],
  ]);
  deepEqual(found[0]!.range, { start: { line: 1, character: 4 }, end: { line: 1, character: 9 } });
  deepEqual(found[2]!.data, [{ file: "Prg/main.prg", rule: "lint/unused-function", reason: "incomplete-project" }]);
});

test("an unassessed document is not linted, in either language mode", () => {
  const server = client();
  deepEqual(codes(server.open("file:///loose/main.prg", MAIN)), [UNASSESSED_CODE]);
  deepEqual(codes(server.open("file:///loose/tk2.prg", "nope()\n", "rpgcode-tk2")), [UNASSESSED_CODE]);
});

test("a buffer that does not compile publishes its parse error and no lint", () => {
  const project = modern({ "Prg/main.prg": "nope()\nx = )\n" });
  const server = client();
  server.project(project);
  deepEqual(codes(server.open(project.uri("Prg/main.prg"), "nope()\nx = )\n")), ["syntax.error"]);
});

test("a broken include leaves the including document's parsed lint rules unassessed", () => {
  const text = '#include "lib.prg"\nMWIN("hi")\n';
  const project = modern({ "Prg/main.prg": text, "Prg/lib.prg": "x = )\n" });
  const server = client();
  server.project(project);
  const found = server.open(project.uri("Prg/main.prg"), text);
  deepEqual(codes(found), [LINT_UNASSESSED_CODE]);
  match(found[0]!.message, /style\/format \(invalid-program\)/);
  deepEqual(codes(server.open(project.uri("Prg/lib.prg"), "x = )\n")), ["syntax.error"]);
});

test("closed .gam lint follows references in other buffers and returns to disk when they close", () => {
  const main = writeMainFile({ ...newProjectMainFile(), startupPrg: "start.prg", initBoard: "", menuPlugin: "", fightPlugin: "", packagePlugins: [] });
  if (!main.ok) throw new Error(main.error.message);
  const declarations = "function spare() { return 1 }\nfunction used() { return 2 }\n";
  const project = memoryProject({
    "Main/game.gam": main.value,
    "Prg/start.prg": "tools.used()\n",
    "Prg/tools.prg": declarations,
  }, "Main/game.gam");
  const server = client();
  server.project(project);
  const start = project.uri("Prg/start.prg");
  const tools = project.uri("Prg/tools.prg");
  const unused = () => (server.published.get(tools) ?? []).filter((item) => item.code === "lint/unused-function").map((item) => item.range.start.line);
  server.open(tools, declarations);
  deepEqual(unused(), [0], "only spare is unused in the disk inventory");
  server.open(start, "tools.used()\n");
  server.change(start, "tools.spare()\n");
  deepEqual(unused(), [1], "an unsaved reference refreshes other buffers");
  server.change(start, '#include "missing.prg"\n');
  deepEqual(unused(), [], "a missing include invalidates the closed project");
  match((server.published.get(tools) ?? []).find((item) => item.code === LINT_UNASSESSED_CODE)?.message ?? "", /lint\/unused-function \(incomplete-project\)/);
  server.close(start);
  deepEqual(unused(), [0], "closing the buffer restores the disk reference");
  deepEqual(server.published.get(start), []);
});

test("tkr-lint.json sets a rule's severity or turns it off, as in tkr script check", () => {
  const warn = modern(undefined, JSON.stringify({ severity: { "lint/unknown-command": "warning" } }));
  const server = client();
  server.project(warn);
  const found = server.open(warn.uri("Prg/main.prg"), MAIN);
  deepEqual(codes(found), ["lint/unknown-command"]);
  equal(found[0]?.severity, 2);

  const off = modern(undefined, JSON.stringify({ severity: { "lint/unknown-command": "off" } }));
  server.project(off, 2);
  deepEqual(server.published.get(off.uri("Prg/main.prg")), [], "a new snapshot republishes with the new configuration");
});

test("an ignore entry names the file by its project path, the name the CLI uses", () => {
  const project = modern(undefined, JSON.stringify({ ignore: [{ rule: "lint/unknown-command", file: "Prg/main.prg", line: 1 }] }));
  const server = client();
  server.project(project);
  deepEqual(server.open(project.uri("Prg/main.prg"), MAIN), []);
});

test("an invalid tkr-lint.json is reported instead of silently linting with the defaults", () => {
  for (const [text, reason] of [["{ not json", /not valid JSON/], [JSON.stringify({ severity: { "lint/no-such-rule": "error" } }), /unknown rule/]] as const) {
    const project = modern(undefined, text);
    const server = client();
    server.project(project);
    const found = server.open(project.uri("Prg/main.prg"), MAIN);
    deepEqual(codes(found), ["tkr.config"]);
    equal(found[0]?.severity, 1);
    match(found[0]?.message ?? "", reason);
  }
});

test("a finding inside an included file is published for that file, never for the includer", () => {
  const main = '#include "lib.prg"\ny = helper(1)\n';
  const lib = "function helper(a) {\n    nope()\n    return a\n}\n";
  const project = modern({ "Prg/main.prg": main, "Prg/lib.prg": lib });
  const server = client();
  server.project(project);
  deepEqual(codes(server.open(project.uri("Prg/main.prg"), main)), [LINT_UNASSESSED_CODE], "no findings in the includer; helper resolves through the include");
  const own = server.open(project.uri("Prg/lib.prg"), lib);
  deepEqual(codes(own), ["lint/unknown-command", LINT_UNASSESSED_CODE]);
  deepEqual(own[0]?.range.start, { line: 1, character: 4 });
});

test("an include the project cannot serve is reported where it is written", () => {
  const main = '#include "missing.prg"\n';
  const project = modern({ "Prg/main.prg": main });
  const server = client();
  server.project(project);
  const found = server.open(project.uri("Prg/main.prg"), main);
  deepEqual(codes(found), ["lint/unresolved-include"]);
  equal(found[0]?.range.start.line, 0);
});
