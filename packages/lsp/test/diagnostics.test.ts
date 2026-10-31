import { deepEqual, equal } from "node:assert/strict";
import test from "node:test";
import type {
  DidChangeTextDocumentParams,
  DidOpenTextDocumentParams,
  InitializeParams,
  InitializeResult,
  PublishDiagnosticsParams,
} from "vscode-languageserver-protocol";
import { createServer, type ServerConnection } from "../src/index.ts";

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
};

function pair(): Pair {
  const published: PublishDiagnosticsParams[] = [];
  let initialize: (params: InitializeParams) => InitializeResult = () => ({ capabilities: {} });
  let open: (params: DidOpenTextDocumentParams) => void = () => {};
  let change: (params: DidChangeTextDocumentParams) => void = () => {};
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
    sendDiagnostics: (params) => published.push(params),
  };
  return {
    connection,
    published,
    initialize: (params) => initialize(params),
    open: (params) => open(params),
    change: (params) => change(params),
  };
}

const URI = "file:///startup.prg";
const INITIALIZE: InitializeParams = { processId: null, rootUri: null, capabilities: {} };

test("initialize advertises full document sync", () => {
  const { connection, initialize } = pair();
  createServer(connection);
  const result = initialize(INITIALIZE);
  deepEqual(result.capabilities.textDocumentSync, { openClose: true, change: 1 });
});

test("didOpen publishes the located TOOL-3 diagnostic for a buffer with an error", () => {
  const { connection, published, initialize, open } = pair();
  createServer(connection);
  initialize(INITIALIZE);
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
  const { connection, published, initialize, open, change } = pair();
  createServer(connection);
  initialize(INITIALIZE);
  open({ textDocument: { uri: URI, languageId: "rpgcode", version: 1, text: "x = )\n" } });
  equal(published[0]?.diagnostics.length, 1);
  change({ textDocument: { uri: URI, version: 2 }, contentChanges: [{ text: "x = 1\n" }] });
  equal(published[1]?.version, 2);
  deepEqual(published[1]?.diagnostics, []);
});

test("an incremental change edits the buffer the server holds", () => {
  const { connection, published, initialize, open, change } = pair();
  const server = createServer(connection);
  initialize(INITIALIZE);
  open({ textDocument: { uri: URI, languageId: "rpgcode", version: 1, text: "x = 1\n" } });
  change({
    textDocument: { uri: URI, version: 2 },
    contentChanges: [{ range: { start: { line: 0, character: 4 }, end: { line: 0, character: 5 } }, text: "2" }],
  });
  equal(server.text(URI), "x = 2\n");
  deepEqual(published[1]?.diagnostics, []);
});
