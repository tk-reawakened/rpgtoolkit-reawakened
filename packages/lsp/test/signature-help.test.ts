import { deepEqual, equal, ok } from "node:assert/strict";
import test from "node:test";
import { FIRST_PARTY_PLUGINS } from "@tk-reawakened/core";
import { projectHelp } from "@tk-reawakened/script-tools";
import type { DidOpenTextDocumentParams, InitializeParams, InitializeResult, SignatureHelp, SignatureHelpParams } from "vscode-languageserver-protocol";
import { createServer, type ServerConnection } from "../src/index.ts";

const uri = "file:///main.prg";
const documentation = projectHelp(FIRST_PARTY_PLUGINS.map((definition) => ({ definition })));

function session() {
  const disposable = { dispose() {} };
  let initialize: (params: InitializeParams) => InitializeResult = () => ({ capabilities: {} });
  let open: (params: DidOpenTextDocumentParams) => void = () => {};
  let signature: (params: SignatureHelpParams) => SignatureHelp | null = () => null;
  const connection: ServerConnection = {
    onInitialize: (handler) => { initialize = handler; return disposable; },
    onDidOpenTextDocument: (handler) => { open = handler; return disposable; },
    onDidChangeTextDocument: () => disposable,
    onHover: () => disposable,
    onCompletion: () => disposable,
    onDefinition: () => disposable,
    onDocumentSymbol: () => disposable,
    onCodeAction: () => disposable,
    onNotification: () => disposable,
    onSignatureHelp: (handler) => { signature = handler; return disposable; },
    sendDiagnostics: () => {},
  };
  createServer(connection);
  return {
    initialize: () => initialize({ capabilities: {}, processId: null, rootUri: null }),
    request: (text: string, languageId = "rpgcode") => {
      open({ textDocument: { uri, version: 1, languageId, text } });
      const lines = text.split("\n");
      return signature({ textDocument: { uri }, position: { line: lines.length - 1, character: lines.at(-1)!.length } });
    },
  };
}

test("signature help registers and uses command catalogue on incomplete calls", () => {
  const server = session();
  deepEqual(server.initialize().capabilities.signatureHelpProvider?.triggerCharacters, ["(", ","]);
  const result = server.request("threadSleep(");
  ok(result);
  equal(result.activeParameter, 0);
  const entry = documentation.find((item) => item.name === "threadsleep");
  ok(entry);
  deepEqual(result.signatures[0]!.parameters?.map((param) => param.label), entry.params.map((param) => param.name));
  deepEqual(result.signatures[0]!.documentation, {
    kind: "markdown",
    value: entry.behaviour === null ? (entry.summary ?? "") : `${entry.summary ?? ""}\n\n${entry.behaviour}`,
  });
  const documented = server.request("sleep(")?.signatures[0]?.documentation;
  const sleep = documentation.find((item) => item.name === "sleep");
  ok(sleep);
  deepEqual(documented, { kind: "markdown", value: `${sleep.summary}\n\n${sleep.behaviour}` });
});

test("active argument ignores nested, quoted and commented commas", () => {
  const server = session();
  for (const source of [
    'threadSleep(concat("a,b", "c"), ',
    'threadSleep(foo(1, 2), ',
    'threadSleep(arr[1, 2], ',
    'threadSleep({ a: 1, b: 2 }, ',
    'threadSleep(1 /* , */, ',
    'threadSleep(1, // ,\n ',
  ]) {
    const result = server.request(source);
    ok(result, source);
    equal(result.activeParameter, 1, source);
  }
  const inner = server.request("threadSleep(mwin(");
  ok(inner);
  equal(inner.signatures[0]!.label.toLowerCase().startsWith("mwin("), true);
});

test("unknown, qualified and comment calls do not guess built-in signatures", () => {
  const server = session();
  for (const source of ["unknown(", "obj.mwin(", "obj->mwin(", "threadSleep(obj.mwin(", "threadSleep(unknown(", "// mwin(", "/* mwin(", "* mwin(", "** mwin(", "#mwin("]) {
    equal(server.request(source), null, source);
  }
  equal(server.request("threadSleep(1, 2)"), null);
  ok(server.request("#mwin(", "rpgcode-tk2"));
  equal(server.request("#mwin(hello) * threadSleep(", "rpgcode-tk2"), null);
  equal(server.request("threadSleep(1 _\n * 2, ")?.activeParameter, 1);
  ok(server.request("THREADSLEEP!("));
});

test("comparison is not a member access", () => {
  ok(session().request("if (x > threadSleep("));
});

test("member qualification survives comments", () => {
  equal(session().request("obj. /* comment */ mwin("), null);
  equal(session().request("obj -> /* comment */ mwin("), null);
});

test("a broken earlier statement does not suppress a later call", () => {
  ok(session().request('"unterminated\nthreadSleep('));
  ok(session().request(")\nthreadSleep("));
});

test("comment markers inside strings do not disrupt continuation", () => {
  equal(session().request('threadSleep(1, "http://site" _\n * 2')?.activeParameter, 1);
});

test("Toolkit 2 loose dialogue does not produce a call tip", () => {
  equal(session().request("Hello threadSleep(", "rpgcode-tk2"), null);
  ok(session().request("#threadSleep(", "rpgcode-tk2"));
});

test("multiline comments preserve member qualification", () => {
  equal(session().request("obj. /* multi\nline */ mwin("), null);
});

test("qualified method declarations are not built-in calls", () => {
  equal(session().request("method MyClass::mwin("), null);
});

test("Toolkit 2 loose text is dialogue even when it starts with a keyword or contains equals", () => {
  const server = session();
  equal(server.request("if I say threadSleep(", "rpgcode-tk2"), null);
  equal(server.request("x = threadSleep(", "rpgcode-tk2"), null);
  ok(server.request("#If(threadSleep(", "rpgcode-tk2"));
});
