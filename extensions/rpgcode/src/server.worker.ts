import { createConnection, BrowserMessageReader, BrowserMessageWriter } from "vscode-languageserver/browser.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import { TextDocuments } from "vscode-languageserver";
import { createServer } from "@tk-reawakened/lsp";

// Browser worker host for the RPGCode language server (TOOL-1, D-4 web target).
// Bundled into dist/server.worker.js as a self-contained worker.
const reader = new BrowserMessageReader(self as unknown as Worker);
const writer = new BrowserMessageWriter(self as unknown as Worker);
const connection = createConnection(reader, writer);
const documents = new TextDocuments(TextDocument);

createServer({
  onInitialize: (handler) => connection.onInitialize(handler),
  onDidOpenTextDocument: (handler) =>
    documents.onDidOpen((event) =>
      handler({
        textDocument: {
          uri: event.document.uri,
          languageId: event.document.languageId,
          version: event.document.version,
          text: event.document.getText(),
        },
      }),
    ),
  onDidChangeTextDocument: (handler) =>
    documents.onDidChangeContent((event) =>
      handler({
        textDocument: { uri: event.document.uri, version: event.document.version },
        contentChanges: [{ text: event.document.getText() }],
      }),
    ),
  onHover: (handler) => connection.onHover(handler),
  onDidCloseTextDocument: (handler) =>
    documents.onDidClose((event) => handler({ textDocument: { uri: event.document.uri } })),
  onCompletion: (handler) => connection.onCompletion(handler),
  onDefinition: (handler) => connection.onDefinition(handler),
  onDocumentSymbol: (handler) => connection.onDocumentSymbol(handler),
  onSignatureHelp: (handler) => connection.onSignatureHelp(handler),
  onCodeAction: (handler) => connection.onCodeAction(handler),
  onDocumentFormatting: (handler) => connection.onDocumentFormatting(handler),
  showMessage: (params) => void connection.sendNotification("window/showMessage", params),
  // The running project arrives as `rpgcode/project` (docs/spec/engine/rpgcode-tooling.md#tool-1-project).
  onNotification: (method, handler) => connection.onNotification(method, handler),
  sendDiagnostics: (params) => void connection.sendDiagnostics(params),
});

documents.listen(connection);
connection.listen();

