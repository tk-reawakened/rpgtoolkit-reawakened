import { deepEqual, equal, match, ok } from "node:assert/strict";
import test from "node:test";
import type {
  DidChangeTextDocumentParams,
  DidOpenTextDocumentParams,
  InitializeParams,
  InitializeResult,
  PublishDiagnosticsParams,
} from "vscode-languageserver-protocol";
import { createServer, PROJECT_NOTIFICATION, UNASSESSED_CODE, type ServerConnection } from "../src/index.ts";
import { mainFileBytes, memoryProject } from "./project-support.ts";

/**
 * The diagnostics path over an in-memory connection pair
 * (docs/spec/engine/rpgcode-tooling.md#tool-1): the client end records what the
 * server publishes and drives its handler registrations directly, so no stream
 * or socket is involved and the server itself still knows no transport.
 */

type Pair = {
  readonly connection: ServerConnection;
  readonly published: PublishDiagnosticsParams[];
  initialize(params: InitializeParams): InitializeResult;
  open(params: DidOpenTextDocumentParams): void;
  change(params: DidChangeTextDocumentParams): void;
  notify(method: string, params: unknown): void;
};

function pair(): Pair {
  const published: PublishDiagnosticsParams[] = [];
  let initialize: (params: InitializeParams) => InitializeResult = () => ({ capabilities: {} });
  let open: (params: DidOpenTextDocumentParams) => void = () => {};
  let change: (params: DidChangeTextDocumentParams) => void = () => {};
  const notifications = new Map<string, (params: unknown) => void>();
  const disposable = { dispose: () => {} };
  const connection: ServerConnection = {
    onInitialize: (handler) => {
      initialize = handler;
      return disposable;
    },
    onDidOpenTextDocument: (handler) => {
      open = handler;
      return disposable;
    },
    onDidChangeTextDocument: (handler) => {
      change = handler;
      return disposable;
    },
    onHover: () => disposable,
    onCompletion: () => disposable,
    onDefinition: () => disposable,
    onDocumentSymbol: () => disposable,
    onSignatureHelp: () => disposable,
    onDocumentFormatting: () => disposable,
    showMessage: () => {},
    onCodeAction: () => disposable,
    onNotification: (method, handler) => {
      notifications.set(method, handler);
      return disposable;
    },
    sendDiagnostics: (params) => published.push(params),
  };
  return {
    connection,
    published,
    initialize: (params) => initialize(params),
    open: (params) => open(params),
    change: (params) => change(params),
    notify: (method, params) => notifications.get(method)?.(params),
  };
}

const INITIALIZE: InitializeParams = { processId: null, rootUri: null, capabilities: {} };

/** A 3.1 project whose only program is Prg/startup.prg, so its diagnostics are assessed. */
const TK3 = memoryProject({ "Main/game.gam": mainFileBytes("tk3"), "Prg/startup.prg": "" }, "Main/game.gam");
const URI = TK3.uri("Prg/startup.prg");

/** A server already told about `project`, as a client does after initialize. */
function started(project = TK3): Pair & { readonly server: ReturnType<typeof createServer> } {
  const client = pair();
  const server = createServer(client.connection);
  client.initialize(INITIALIZE);
  client.notify(PROJECT_NOTIFICATION, project.snapshot());
  return { ...client, server };
}

test("initialize advertises full document sync", () => {
  const { connection, initialize } = pair();
  createServer(connection);
  const result = initialize(INITIALIZE);
  deepEqual(result.capabilities.textDocumentSync, { openClose: true, change: 1 });
});

test("didOpen publishes the located TOOL-3 diagnostic for a buffer with an error", () => {
  const { published, open } = started();
  open({ textDocument: { uri: URI, languageId: "rpgcode", version: 1, text: "x = 1\r\nx = )\r\n" } });
  equal(published.length, 1);
  const [params] = published;
  equal(params?.uri, URI);
  equal(params?.diagnostics.length, 1);
  const [diagnostic] = params?.diagnostics ?? [];
  equal(diagnostic?.code, "syntax.error");
  equal(diagnostic?.source, "rpgcode");
  equal(diagnostic?.severity, 1, "an error");
  deepEqual(diagnostic?.range, { start: { line: 1, character: 4 }, end: { line: 1, character: 5 } });
  equal(typeof diagnostic?.message, "string");
});

test("didChange re-analyses the buffer and clears the diagnostic when it compiles", () => {
  const { published, open, change } = started();
  open({ textDocument: { uri: URI, languageId: "rpgcode", version: 1, text: "x = )\n" } });
  equal(published[0]?.diagnostics.length, 1);
  change({ textDocument: { uri: URI, version: 2 }, contentChanges: [{ text: "x = 1\n" }] });
  equal(published[1]?.version, 2);
  deepEqual(published[1]?.diagnostics, []);
});

test("an incremental change edits the buffer the server holds", () => {
  const { server, published, open, change } = started();
  open({ textDocument: { uri: URI, languageId: "rpgcode", version: 1, text: "x = 1\n" } });
  change({
    textDocument: { uri: URI, version: 2 },
    contentChanges: [{ range: { start: { line: 0, character: 4 }, end: { line: 0, character: 5 } }, text: "2" }],
  });
  equal(server.text(URI), "x = 2\n");
  deepEqual(published[1]?.diagnostics, []);
});

// #2089: the project's dialect, never the language mode, decides how a program parses.

const TK2 = memoryProject({ "Main/legacy.gam": mainFileBytes("tk2"), "Prg/talk.prg": "" }, "Main/legacy.gam");

test("a Toolkit 2 project accepts loose dialogue that 3.1 rejects", () => {
  for (const languageId of ["rpgcode-tk2", "rpgcode"]) {
    const { published, open } = started(TK2);
    open({ textDocument: { uri: TK2.uri("Prg/talk.prg"), languageId, version: 1, text: "Hello there\n" } });
    deepEqual(published[0]?.diagnostics, [], `assessed TK2 project in ${languageId} mode`);
  }
});

test("a 3.1 project keeps the genuine parse error for the same text, in either language mode", () => {
  for (const languageId of ["rpgcode-tk2", "rpgcode"]) {
    const { published, open } = started();
    open({ textDocument: { uri: URI, languageId, version: 1, text: "Hello there\n" } });
    deepEqual(published[0]?.diagnostics.map((item) => item.code), ["syntax.error"], `assessed 3.1 project in ${languageId} mode`);
    deepEqual(published[0]?.diagnostics[0]?.range, { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } });
  }
});

test("a Toolkit 2 project still reports a genuine Toolkit 2 parse error", () => {
  const { published, open } = started(TK2);
  open({ textDocument: { uri: TK2.uri("Prg/talk.prg"), languageId: "rpgcode-tk2", version: 1, text: "#If (x = 1) {\n" } });
  deepEqual(published[0]?.diagnostics.map((item) => item.code), ["syntax.error"]);
});

test("without a running project a document is marked unassessed and read provisionally from its language mode", () => {
  const client = pair();
  createServer(client.connection);
  client.initialize(INITIALIZE);
  client.open({ textDocument: { uri: "file:///loose/talk.prg", languageId: "rpgcode-tk2", version: 1, text: "Hello there\n" } });
  const [marker, ...rest] = client.published[0]?.diagnostics ?? [];
  equal(marker?.code, UNASSESSED_CODE);
  equal(marker?.severity, 3, "information, not an error");
  match(marker?.message ?? "", /no running project \(\.gam\) is selected/);
  match(marker?.message ?? "", /Toolkit 2\.x/);
  deepEqual(rest, [], "the TK2 reading accepts the dialogue");
  client.open({ textDocument: { uri: "file:///loose/code.prg", languageId: "rpgcode", version: 1, text: "Hello there\n" } });
  deepEqual(client.published[1]?.diagnostics.map((item) => item.code), [UNASSESSED_CODE, "syntax.error"], "provisional 3.1 reading");
});

test("a document outside the running project is unassessed even when a project is selected", () => {
  const { published, open } = started(TK2);
  open({ textDocument: { uri: "file:///elsewhere/talk.prg", languageId: "rpgcode", version: 1, text: "x = 1\n" } });
  const codes = published[0]?.diagnostics.map((item) => item.code);
  deepEqual(codes, [UNASSESSED_CODE]);
  match(published[0]?.diagnostics[0]?.message ?? "", /not a program of the running project/);
});

test("a new snapshot republishes open documents, and an older revision is ignored", () => {
  const client = pair();
  createServer(client.connection);
  client.initialize(INITIALIZE);
  const uri = TK2.uri("Prg/talk.prg");
  client.open({ textDocument: { uri, languageId: "rpgcode", version: 1, text: "Hello there\n" } });
  equal(client.published[0]?.diagnostics[0]?.code, UNASSESSED_CODE);
  client.notify(PROJECT_NOTIFICATION, TK2.snapshot(2));
  deepEqual(client.published[1]?.diagnostics, [], "assessed as Toolkit 2 once the project arrives");
  client.notify(PROJECT_NOTIFICATION, { revision: 1, main: null });
  equal(client.published.length, 2, "a stale snapshot changes nothing");
  client.notify(PROJECT_NOTIFICATION, { revision: 3, main: null });
  equal(client.published[2]?.diagnostics[0]?.code, UNASSESSED_CODE, "deselecting the project unassesses the document");
});

test("an unreadable main file or a malformed snapshot leaves documents unassessed with the reason", () => {
  const cases: [unknown, RegExp][] = [
    [{ revision: 1, main: { uri: "file:///game/Main/game.gam", bytes: "AAAA" }, files: [] }, /not a readable main file/],
    [{ revision: 1, main: { uri: "file:///game/Main/game.gam" } }, /malformed \(main\)/],
    [{ revision: 1, main: null, problem: "permission denied" }, /could not be read: permission denied/],
  ];
  for (const [snapshot, reason] of cases) {
    const client = pair();
    createServer(client.connection);
    client.initialize(INITIALIZE);
    client.notify(PROJECT_NOTIFICATION, snapshot);
    client.open({ textDocument: { uri: "file:///game/Prg/a.prg", languageId: "rpgcode", version: 1, text: "x = 1\n" } });
    const marker = client.published[0]?.diagnostics[0];
    equal(marker?.code, UNASSESSED_CODE);
    match(marker?.message ?? "", reason);
  }
  const client = pair();
  createServer(client.connection);
  client.notify(PROJECT_NOTIFICATION, { main: null });
  ok(true, "a snapshot without a revision is ignored without throwing");
});
