import { deepEqual, equal, ok } from "node:assert/strict";
import test from "node:test";
import type { DocumentSymbol, DidOpenTextDocumentParams, DocumentSymbolParams } from "vscode-languageserver-protocol";
import { createServer, SEMANTIC_LEGEND, type ServerConnection } from "../src/index.ts";

/** TOOL-10: colouring is a semantic-token request and the bookmark list is the document-symbol request. */

type Harness = {
  open(text: string): void;
  tokens(): number[];
  symbols(): DocumentSymbol[];
  initialize(): { capabilities: { semanticTokensProvider?: { legend: unknown; full: boolean } } };
};

const URI = "file:///proj/Prg/intro.prg";

function harness(withRequests = true): Harness {
  const absent = { dispose: () => {} };
  let open: (params: DidOpenTextDocumentParams) => void = () => {};
  let symbols: (params: DocumentSymbolParams) => DocumentSymbol[] = () => [];
  let initialize: () => never = () => { throw new Error("not registered"); };
  const requests = new Map<string, (params: never) => unknown>();
  const connection: ServerConnection = {
    onInitialize: (handler) => { initialize = handler as unknown as () => never; return absent; },
    onDidOpenTextDocument: (handler) => { open = handler; return absent; },
    onDidChangeTextDocument: () => absent,
    onHover: () => absent,
    onCompletion: () => absent,
    onDefinition: () => absent,
    onDocumentSymbol: (handler) => { symbols = handler; return absent; },
    onSignatureHelp: () => absent,
    onCodeAction: () => absent,
    onDocumentFormatting: () => absent,
    showMessage: () => {},
    onNotification: () => absent,
    sendDiagnostics: () => {},
    ...(withRequests ? { onRequest: (method: string, handler: (params: never) => unknown) => { requests.set(method, handler); return absent; } } : {}),
  };
  createServer(connection);
  return {
    open: (text) => open({ textDocument: { uri: URI, languageId: "rpgcode", version: 1, text } }),
    tokens: () => (requests.get("textDocument/semanticTokens/full")!({ textDocument: { uri: URI } } as never) as { data: number[] }).data,
    symbols: () => symbols({ textDocument: { uri: URI } }),
    initialize: () => initialize(),
  };
}

test("the server declares the legend and answers a full semantic-token request with relative encoding", () => {
  const server = harness();
  equal(server.initialize().capabilities.semanticTokensProvider?.full, true);
  deepEqual(server.initialize().capabilities.semanticTokensProvider?.legend, SEMANTIC_LEGEND);
  server.open('// note\nmwin("hi") // x\n');
  const type = (name: string): number => SEMANTIC_LEGEND.tokenTypes.indexOf(name);
  const library = 1 << SEMANTIC_LEGEND.tokenModifiers.indexOf("defaultLibrary");
  deepEqual(server.tokens(), [
    0, 0, 7, type("comment"), 0,
    1, 0, 4, type("function"), library,
    0, 5, 4, type("string"), 0,
    0, 6, 4, type("comment"), 0,
  ]);
});

test("a connection without onRequest still serves everything else", () => {
  const server = harness(false);
  server.open("// Setup\nx = 1\n");
  deepEqual(server.symbols().map((symbol) => symbol.name), ["Setup"]);
});

test("the outline lists functions, labels and line-leading comments in source order", () => {
  const server = harness();
  server.open("// Setup\nfunction go() {\n    x = 1 // not a bookmark\n}\n:retry\n** Wrap up\n");
  deepEqual(
    server.symbols().map((symbol) => [symbol.range.start.line, symbol.kind, symbol.name]),
    [[0, 15, "Setup"], [1, 12, "go"], [4, 20, "retry"], [5, 15, "Wrap up"]],
  );
});
