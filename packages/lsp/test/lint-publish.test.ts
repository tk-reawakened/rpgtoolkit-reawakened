import { deepEqual, equal, match } from "node:assert/strict";
import test from "node:test";
import type { Diagnostic, DidOpenTextDocumentParams } from "vscode-languageserver-protocol";
import { createServer, PROJECT_NOTIFICATION, UNASSESSED_CODE, type ServerConnection } from "../src/index.ts";
import { mainFileBytes, memoryProject, type MemoryProject } from "./project-support.ts";

/**
 * #2074: the project's lint findings are published with its `tkr-lint.json`,
 * only for an assessed document, and only against the file they are in
 * (docs/spec/engine/rpgcode-tooling.md#tool-1-project, #tool-3).
 */

type Client = {
  open(uri: string, text: string, languageId?: string): Diagnostic[];
  project(project: MemoryProject, revision?: number): void;
  readonly published: Map<string, Diagnostic[]>;
};

function client(): Client {
  const published = new Map<string, Diagnostic[]>();
  let open: (params: DidOpenTextDocumentParams) => void = () => {};
  const notifications = new Map<string, (params: unknown) => void>();
  const absent = { dispose: () => {} };
  const connection: ServerConnection = {
    onInitialize: () => absent,
    onDidOpenTextDocument: (handler) => {
      open = handler;
      return absent;
    },
    onDidChangeTextDocument: () => absent,
    onHover: () => absent,
    onCompletion: () => absent,
    onDefinition: () => absent,
    onDocumentSymbol: () => absent,
    onSignatureHelp: () => absent,
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

test("in a Toolkit 2 project nope() is dialogue, so nothing is published", () => {
  const project = memoryProject({ "Main/legacy.gam": mainFileBytes("tk2"), "Prg/main.prg": MAIN }, "Main/legacy.gam");
  const server = client();
  server.project(project);
  // Quote-free: quoted loose text is a separate Toolkit 2 frontend defect (#2100).
  deepEqual(server.open(project.uri("Prg/main.prg"), "nope()\n", "rpgcode"), []);
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
  const lib = "function helper(a) {\n  nope()\n  return a\n}\n";
  const project = modern({ "Prg/main.prg": main, "Prg/lib.prg": lib });
  const server = client();
  server.project(project);
  deepEqual(server.open(project.uri("Prg/main.prg"), main), [], "the includer is clean; helper resolves through the include");
  const own = server.open(project.uri("Prg/lib.prg"), lib);
  deepEqual(codes(own), ["lint/unknown-command"]);
  deepEqual(own[0]?.range.start, { line: 1, character: 2 });
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
