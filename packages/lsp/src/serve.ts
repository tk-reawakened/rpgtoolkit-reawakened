import type { Connection } from "vscode-languageserver";
import { createServer, type LanguageServer, type ServerOptions } from "./index.ts";

/**
 * Serve one `vscode-languageserver` connection with the RPGCode language server (docs/spec/engine/rpgcode-tooling.md#tool-1).
 * Every host that owns a real connection wires it here, so the stdio binary, the browser worker of the early extension and
 * the standalone editor's worker all answer the same requests. `Connection` is only a type: this module imports no Node API.
 * The caller creates the connection from its own transport and calls `connection.listen()`.
 */
export function serveConnection(connection: Connection, options: ServerOptions = {}): LanguageServer {
  return createServer({
    onInitialize: (handler) => connection.onInitialize(handler),
    onDidOpenTextDocument: (handler) => connection.onDidOpenTextDocument(handler),
    onDidChangeTextDocument: (handler) => connection.onDidChangeTextDocument(handler),
    onDidCloseTextDocument: (handler) => connection.onDidCloseTextDocument(handler),
    onHover: (handler) => connection.onHover(handler),
    onCompletion: (handler) => connection.onCompletion(handler),
    onDefinition: (handler) => connection.onDefinition(handler),
    onDocumentSymbol: (handler) => connection.onDocumentSymbol(handler),
    onSignatureHelp: (handler) => connection.onSignatureHelp(handler),
    onCodeAction: (handler) => connection.onCodeAction(handler),
    onDocumentFormatting: (handler) => connection.onDocumentFormatting(handler),
    onRequest: (method, handler) => connection.onRequest(method, handler),
    // The running project arrives as `rpgcode/project` (docs/spec/engine/rpgcode-tooling.md#tool-1-project).
    onNotification: (method, handler) => connection.onNotification(method, handler),
    showMessage: (params) => void connection.sendNotification("window/showMessage", params),
    sendDiagnostics: (params) => void connection.sendDiagnostics(params),
  }, options);
}
