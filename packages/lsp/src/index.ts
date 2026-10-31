/**
 * The transport-free RPGCode language server (docs/spec/engine/rpgcode-tooling.md#tool-1).
 *
 * `createServer(connection)` knows only the LSP connection it is handed; the
 * stdio, worker and in-memory transports live with the host. Diagnostics come
 * from `analyse()` in `@tk-reawakened/script-tools`, so the editor and CI see one
 * TOOL-3 shape, and nothing here imports a Node API (G2; dependency rule
 * `r5-lsp-no-node`).
 */

import type {
  DidChangeTextDocumentParams,
  DidOpenTextDocumentParams,
  Disposable,
  InitializeParams,
  InitializeResult,
  PublishDiagnosticsParams,
} from "vscode-languageserver-protocol";
import { TextDocument } from "vscode-languageserver-textdocument";
import { DiagnosticSeverity, type Diagnostic } from "vscode-languageserver-protocol";
import { analyse, type Diagnostic as AnalysisDiagnostic, type Severity } from "@tk-reawakened/script-tools";

const SEVERITY: { readonly [severity in Severity]: DiagnosticSeverity } = {
  error: DiagnosticSeverity.Error,
  warning: DiagnosticSeverity.Warning,
  info: DiagnosticSeverity.Information,
  hint: DiagnosticSeverity.Hint,
};

/**
 * A TOOL-3 diagnostic as an LSP diagnostic. TOOL-3 positions are 1-based with an
 * inclusive end; LSP positions are 0-based with an exclusive end, so the start
 * column is 0-based too and the end column is the inclusive one, unconverted.
 */
function toLspDiagnostic(diagnostic: AnalysisDiagnostic): Diagnostic {
  return {
    range: {
      start: { line: diagnostic.range.start.line - 1, character: diagnostic.range.start.column - 1 },
      end: { line: diagnostic.range.end.line - 1, character: diagnostic.range.end.column },
    },
    severity: SEVERITY[diagnostic.severity],
    code: diagnostic.code,
    source: "rpgcode",
    message: diagnostic.message,
  };
}

/**
 * The LSP connection methods this server uses. A host's `Connection` from
 * `vscode-languageserver` satisfies it structurally, and typing the four methods
 * here is what keeps the package free of the Node entry point that builds one
 * (TOOL-1: the connection is the only transport knowledge, and the host owns it).
 */
export type ServerConnection = {
  onInitialize(handler: (params: InitializeParams) => InitializeResult): Disposable;
  onDidOpenTextDocument(handler: (params: DidOpenTextDocumentParams) => void): Disposable;
  onDidChangeTextDocument(handler: (params: DidChangeTextDocumentParams) => void): Disposable;
  sendDiagnostics(params: PublishDiagnosticsParams): void;
};

export type LanguageServer = {
  /** The open buffers, keyed by URI, so a host can inspect them (tests, debugging). */
  readonly text: (uri: string) => string | undefined;
};

export function createServer(connection: ServerConnection): LanguageServer {
  const documents = new Map<string, TextDocument>();

  const publish = (document: TextDocument): void => {
    const analysis = analyse(document.getText(), { file: document.uri });
    const params: PublishDiagnosticsParams = {
      uri: document.uri,
      version: document.version,
      diagnostics: analysis.diagnostics.map(toLspDiagnostic),
    };
    connection.sendDiagnostics(params);
  };

  connection.onInitialize(() => ({
    capabilities: {
      textDocumentSync: { openClose: true, change: 1 },
    },
  }));

  connection.onDidOpenTextDocument((params: DidOpenTextDocumentParams) => {
    const { textDocument } = params;
    const document = TextDocument.create(textDocument.uri, textDocument.languageId, textDocument.version, textDocument.text);
    documents.set(textDocument.uri, document);
    publish(document);
  });

  connection.onDidChangeTextDocument((params: DidChangeTextDocumentParams) => {
    const current = documents.get(params.textDocument.uri);
    if (current === undefined) return;
    const next = TextDocument.update(
      current,
      params.contentChanges.map((change) => ("range" in change ? { range: change.range, text: change.text } : { text: change.text })),
      params.textDocument.version,
    );
    documents.set(next.uri, next);
    publish(next);
  });

  return {
    text: (uri) => documents.get(uri)?.getText(),
  };
}
