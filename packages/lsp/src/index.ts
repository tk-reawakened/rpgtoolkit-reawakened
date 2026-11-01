/**
 * The transport-free RPGCode language server (docs/spec/engine/rpgcode-tooling.md#tool-1).
 *
 * `createServer(connection)` knows only the LSP connection it is handed; the
 * stdio, worker and in-memory transports live with the host. Diagnostics come
 * from `analyse()`; hover, completion, definition and the outline are lookups
 * into the one index of TOOL-6 and the gate-checked command documentation of
 * TOOL-3. Nothing here imports a Node API (G2; dependency rule `r5-lsp-no-node`).
 */

import {
  FIRST_PARTY_PLUGINS,
  commandDocumentation,
  foldAscii,
  type ProgramLoader,
  type ResolvedPlugin,
} from "@tk-reawakened/core";
import {
  analyse,
  buildIndex,
  legacyFixes,
  projectHelp,
  type Diagnostic as AnalysisDiagnostic,
  type HelpEntry,
  type IndexCall,
  type IndexInclude,
  type IndexProgram,
  type Severity,
} from "@tk-reawakened/script-tools";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  CompletionItemKind,
  DiagnosticSeverity,
  SymbolKind,
  type CodeAction,
  type CodeActionParams,
  type CompletionItem,
  type CompletionParams,
  type DidChangeTextDocumentParams,
  type DidOpenTextDocumentParams,
  type Diagnostic as LspDiagnostic,
  type Disposable,
  type DocumentSymbol,
  type DocumentSymbolParams,
  type Hover,
  type HoverParams,
  type InitializeParams,
  type InitializeResult,
  type Location,
  type Position,
  type PublishDiagnosticsParams,
  type Range,
  type TextDocumentPositionParams,
} from "vscode-languageserver-protocol";

const SEVERITY: { readonly [severity in Severity]: DiagnosticSeverity } = {
  error: DiagnosticSeverity.Error,
  warning: DiagnosticSeverity.Warning,
  info: DiagnosticSeverity.Information,
  hint: DiagnosticSeverity.Hint,
};

/** Every first-party definition, so hover and completion cover the packs a host registers too. */
function defaultPlugins(): readonly ResolvedPlugin[] {
  return FIRST_PARTY_PLUGINS.map((definition) => ({ definition }));
}

/**
 * The LSP connection methods this server uses. A host's `Connection` from
 * `vscode-languageserver` satisfies it structurally, and typing the methods here
 * is what keeps the package free of the Node entry point that builds one
 * (TOOL-1: the connection is the only transport knowledge, and the host owns it).
 */
export type ServerConnection = {
  onInitialize(handler: (params: InitializeParams) => InitializeResult): Disposable;
  onDidOpenTextDocument(handler: (params: DidOpenTextDocumentParams) => void): Disposable;
  onDidChangeTextDocument(handler: (params: DidChangeTextDocumentParams) => void): Disposable;
  onHover(handler: (params: HoverParams) => Hover | null): Disposable;
  onCompletion(handler: (params: CompletionParams) => CompletionItem[]): Disposable;
  onDefinition(handler: (params: TextDocumentPositionParams) => Location[]): Disposable;
  onDocumentSymbol(handler: (params: DocumentSymbolParams) => DocumentSymbol[]): Disposable;
  onCodeAction(handler: (params: CodeActionParams) => CodeAction[]): Disposable;
  sendDiagnostics(params: PublishDiagnosticsParams): void;
};

export type ServerOptions = {
  /** Resolves `#include` and `file.func` for the index; without one, includes are listed but unresolved. */
  readonly loader?: ProgramLoader;
  /** The catalogue the help projection reads; defaults to the registered built-in plugins. */
  readonly plugins?: readonly ResolvedPlugin[];
};

export type LanguageServer = {
  /** The open buffers, keyed by URI, so a host can inspect them (tests, debugging). */
  readonly text: (uri: string) => string | undefined;
};

/** TOOL-3 ranges are 1-based with an inclusive end; LSP positions are 0-based with an exclusive end. */
function lspRange(line: number, col: number | undefined, endCol: number | undefined): Range {
  const start = { line: line - 1, character: (col ?? 1) - 1 };
  const end = { line: line - 1, character: endCol ?? col ?? 1 };
  return { start, end };
}

function toLspDiagnostic(diagnostic: AnalysisDiagnostic): LspDiagnostic {
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

/** Whether a 1-based cursor position falls inside a site's span (inclusive). */
function covers(pos: { readonly line: number; readonly col?: number; readonly endCol?: number }, line: number, column: number): boolean {
  return pos.line === line && pos.col !== undefined && pos.endCol !== undefined && pos.col <= column && column <= pos.endCol;
}

export function createServer(connection: ServerConnection, options: ServerOptions = {}): LanguageServer {
  const documents = new Map<string, TextDocument>();
  const plugins = options.plugins ?? defaultPlugins();
  const help = projectHelp(plugins);
  const documentation = commandDocumentation(plugins);

  const indexOf = (document: TextDocument): IndexProgram | null => {
    const documentIndex = buildIndex([{ name: document.uri, ref: { kind: "inline", text: document.getText(), ir: "1" } }], options.loader === undefined ? {} : { loader: options.loader });
    return documentIndex.programs[0] ?? null;
  };

  const publish = (document: TextDocument): void => {
    const analysis = analyse(document.getText(), { file: document.uri });
    connection.sendDiagnostics({ uri: document.uri, version: document.version, diagnostics: analysis.diagnostics.map(toLspDiagnostic) });
  };

  /** The function a call names, inside the file its include resolved to. */
  const targetOf = (program: IndexProgram, call: IndexCall): Location | null => {
    if (call.file === null) {
      const local = program.functions.find((fn) => fn.name === call.name && fn.arity === call.arity);
      return local === undefined ? null : locationOf(local);
    }
    const wanted = foldAscii(`${call.file}.prg`);
    const include = program.includes.find((item) => foldAscii(item.path) === wanted && item.key !== undefined);
    if (include === undefined || include.key === undefined) return null;
    const fn = program.functions.find((item) => item.file === include.key && item.name === call.name && item.arity === call.arity);
    return fn === undefined ? null : locationOf(fn);
  };

  const locationOf = (declaration: { readonly file: string; readonly line: number; readonly col?: number }): Location => ({
    uri: declaration.file,
    range: lspRange(declaration.line, declaration.col, declaration.col),
  });

  const includeTarget = (program: IndexProgram, include: IndexInclude): Location | null =>
    include.key === undefined ? null : { uri: include.key, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } };

  connection.onInitialize(() => ({
    capabilities: {
      textDocumentSync: { openClose: true, change: 1 },
      hoverProvider: true,
      completionProvider: { triggerCharacters: ["(", ":"] },
      definitionProvider: true,
      documentSymbolProvider: true,
      codeActionProvider: true,
    },
  }));

  connection.onDidOpenTextDocument((params) => {
    const { textDocument } = params;
    const document = TextDocument.create(textDocument.uri, textDocument.languageId, textDocument.version, textDocument.text);
    documents.set(textDocument.uri, document);
    publish(document);
  });

  connection.onDidChangeTextDocument((params) => {
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

  connection.onHover((params) => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined) return null;
    const program = indexOf(document);
    if (program === null) return null;
    const line = params.position.line + 1;
    const column = params.position.character + 1;
    const call = program.calls.find((item) => covers(item.pos, line, column));
    if (call === undefined) return null;
    const entry = help.find((item) => foldAscii(item.name) === foldAscii(call.name));
    if (entry === undefined) return null;
    return { contents: { kind: "markdown", value: hoverText(entry) }, range: lspRange(call.pos.line, call.pos.col, call.pos.endCol) };
  });

  connection.onCompletion((params) => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined) return [];
    const program = indexOf(document);
    if (program === null) return [];
    const prefix = foldAscii(wordBefore(document, params.position));
    const seen = new Set<string>();
    const items: CompletionItem[] = [];
    const add = (name: string, kind: CompletionItemKind, detail: string | undefined): void => {
      const folded = foldAscii(name);
      if (seen.has(folded) || !folded.startsWith(prefix)) return;
      seen.add(folded);
      items.push({ label: name, kind, ...(detail === undefined ? {} : { detail }) });
    };
    for (const entry of help) {
      if (entry.access !== "public") continue;
      add(entry.name, entry.isAlias ? CompletionItemKind.Function : CompletionItemKind.Method, entry.summary ?? undefined);
    }
    for (const fn of program.functions) add(fn.qualifiedName, CompletionItemKind.Function, `arity ${fn.arity}`);
    for (const cls of program.classes) add(cls.qualifiedName, CompletionItemKind.Class, "class");
    for (const label of program.labels) add(label.name, CompletionItemKind.Operator, "label");
    return items;
  });

  connection.onDefinition((params) => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined) return [];
    const program = indexOf(document);
    if (program === null) return [];
    const line = params.position.line + 1;
    const column = params.position.character + 1;
    const call = program.calls.find((item) => covers(item.pos, line, column));
    if (call !== undefined) {
      const target = targetOf(program, call);
      return target === null ? [] : [target];
    }
    const include = program.includes.find((item) =>
      covers(
        item.col === undefined || item.endCol === undefined
          ? { line: item.line }
          : { line: item.line, col: item.col, endCol: item.endCol },
        line,
        column,
      ),
    );
    if (include !== undefined) {
      const target = includeTarget(program, include);
      return target === null ? [] : [target];
    }
    return [];
  });

  connection.onCodeAction((params) => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined) return [];
    return legacyFixes(document.getText()).map((fix) => ({
      title: fix.title,
      kind: "quickfix",
      diagnostics: params.context.diagnostics,
      edit: {
        changes: {
          [document.uri]: fix.edits.map((item) => ({
            range: {
              start: { line: item.range.start.line - 1, character: item.range.start.column - 1 },
              end: { line: item.range.end.line - 1, character: item.range.end.column },
            },
            newText: item.newText,
          })),
        },
      },
    }));
  });

  connection.onDocumentSymbol((params) => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined) return [];
    const program = indexOf(document);
    if (program === null) return [];
    const symbols: DocumentSymbol[] = [];
    for (const fn of program.functions) {
      symbols.push({ name: fn.qualifiedName, kind: SymbolKind.Function, range: lspRange(fn.line, fn.col, fn.endCol), selectionRange: lspRange(fn.line, fn.col, fn.endCol) });
    }
    for (const cls of program.classes) {
      symbols.push({
        name: cls.qualifiedName,
        kind: SymbolKind.Class,
        range: lspRange(cls.line, cls.col, cls.endCol),
        selectionRange: lspRange(cls.line, cls.col, cls.endCol),
        children: [
          ...cls.members.map((member) => ({ name: member.name, kind: SymbolKind.Field, range: lspRange(member.line, member.col, member.endCol), selectionRange: lspRange(member.line, member.col, member.endCol) })),
          ...cls.methods.map((method) => ({ name: method.qualifiedName, kind: SymbolKind.Method, range: lspRange(method.line, method.col, method.endCol), selectionRange: lspRange(method.line, method.col, method.endCol) })),
        ],
      });
    }
    for (const label of program.labels) {
      symbols.push({ name: label.name, kind: SymbolKind.Key, range: lspRange(label.line, label.col, label.endCol), selectionRange: lspRange(label.line, label.col, label.endCol) });
    }
    return symbols;
  });

  return {
    text: (uri) => documents.get(uri)?.getText(),
  };
}

function hoverText(entry: HelpEntry): string {
  return entry.behaviour === null ? (entry.summary ?? "") : `${entry.summary ?? ""}\n\n${entry.behaviour}`;
}

/** The identifier characters immediately before a 0-based LSP position. */
function wordBefore(document: TextDocument, position: Position): string {
  const text = document.getText();
  const lines = text.split("\n");
  const line = lines[position.line] ?? "";
  const before = line.slice(0, position.character);
  const match = /[A-Za-z0-9_]+$/.exec(before);
  return match === null ? "" : match[0];
}
