/**
 * The transport-free RPGCode language server (docs/spec/engine/rpgcode-tooling.md#tool-1).
 *
 * `createServer(connection)` knows only the LSP connection it is handed; the
 * stdio, worker and in-memory transports live with the host. Diagnostics come
 * from `analyse()`; hover, completion, definition and the outline are lookups
 * into the one index of TOOL-6 and the gate-checked command documentation of
 * TOOL-3. Nothing here imports a Node API (G2; dependency rule `r5-lsp-no-node`).
 *
 * Project knowledge — the dialect, the include inventory, the lint
 * configuration — comes only from the running project the client sends as
 * `rpgcode/project` (docs/spec/engine/rpgcode-tooling.md#tool-1-project). A
 * document outside it is analysed provisionally and marked `project.unassessed`.
 */

import {
  FIRST_PARTY_PLUGINS,
  commandDocumentation,
  decodeCp1252,
  foldAscii,
  type ResolvedPlugin,
} from "@tk-reawakened/core";
import {
  analyse,
  applyEdits,
  buildIndex,
  formatSource,
  indexLintProject,
  legacyFixes,
  lint,
  projectHelp,
  tk2ConversionRefusal,
  type Diagnostic as AnalysisDiagnostic,
  type HelpEntry,
  type IndexCall,
  type IndexInclude,
  type IndexProgram,
  type LintResult,
  type Severity,
} from "@tk-reawakened/script-tools";
import { documentationText, signatureHelp } from "./signature-help.ts";
import { documentContext, NO_PROJECT, projectLoader, projectModel, readSnapshot, type DocumentContext, type ProjectModel } from "./project.ts";
import { PROJECT_NOTIFICATION } from "./protocol.ts";
import { CONFIG_CODE, documentLint, readProjectLintConfig } from "./lint-publish.ts";
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
  type DidCloseTextDocumentParams,
  type DidOpenTextDocumentParams,
  type DocumentFormattingParams,
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
  type SignatureHelp,
  type SignatureHelpParams,
  type ShowMessageParams,
  MessageType,
  type TextEdit,
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
  onDidCloseTextDocument?(handler: (params: DidCloseTextDocumentParams) => void): Disposable;
  onHover(handler: (params: HoverParams) => Hover | null): Disposable;
  onCompletion(handler: (params: CompletionParams) => CompletionItem[]): Disposable;
  onDefinition(handler: (params: TextDocumentPositionParams) => Location[]): Disposable;
  onDocumentSymbol(handler: (params: DocumentSymbolParams) => DocumentSymbol[]): Disposable;
  onSignatureHelp(handler: (params: SignatureHelpParams) => SignatureHelp | null): Disposable;
  onCodeAction(handler: (params: CodeActionParams) => CodeAction[]): Disposable;
  onDocumentFormatting(handler: (params: DocumentFormattingParams) => TextEdit[] | null): Disposable;
  /** `window/showMessage`, which tells the author why a request did nothing. */
  showMessage(params: ShowMessageParams): void;
  /** Client notifications outside the LSP's own methods; the server listens for `rpgcode/project`. */
  onNotification(method: string, handler: (params: unknown) => void): Disposable;
  sendDiagnostics(params: PublishDiagnosticsParams): void;
};

export type ServerOptions = {
  /** The catalogue the help projection reads; defaults to the registered built-in plugins. */
  readonly plugins?: readonly ResolvedPlugin[];
};

export type LanguageServer = {
  /** The open buffers, keyed by URI, so a host can inspect them (tests, debugging). */
  readonly text: (uri: string) => string | undefined;
  /** The running project the server analyses against, so a host can inspect it. */
  readonly project: () => ProjectModel;
};

type ProjectLint = { readonly files: ReadonlySet<string>; readonly result: LintResult };

export { PROJECT_NOTIFICATION } from "./protocol.ts";
export type { ProjectSnapshot, ProjectSnapshotFile } from "./protocol.ts";
export type { ProjectModel } from "./project.ts";

/** The code of the diagnostic that marks a document the running project does not cover. */
export const UNASSESSED_CODE = "project.unassessed";

/** The code of the diagnostic that lists lint rules the server could not assess. */
export const LINT_UNASSESSED_CODE = "lint.unassessed";

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
  let project: ProjectModel = NO_PROJECT;
  let projectLint: ProjectLint | undefined;

  const contextOf = (document: TextDocument): DocumentContext => documentContext(project, document.uri, document.languageId);

  const snapshotText = (context: Extract<DocumentContext, { kind: "assessed" }>, uri: string): string | undefined => {
    if (context.project.uriOfKey.get(context.key) !== uri) return undefined;
    const bytes = context.project.bytes.get(context.key);
    return bytes === undefined ? undefined : decodeCp1252(bytes, 0, bytes.length);
  };

  const indexOf = (document: TextDocument, name = document.uri): IndexProgram | null => {
    const context = contextOf(document);
    const ref = context.dialect === "tk2"
      ? { kind: "inline" as const, text: document.getText(), ir: "1", dialect: "tk2" as const }
      : { kind: "inline" as const, text: document.getText(), ir: "1" };
    const loader = context.kind === "assessed" ? projectLoader(context.project, (uri) => documents.get(uri)?.getText()) : undefined;
    const documentIndex = buildIndex([{ name, ref }], loader === undefined ? {} : { loader });
    return documentIndex.programs[0] ?? null;
  };

  const publish = (document: TextDocument, projectLint?: ProjectLint): void => {
    const context = contextOf(document);
    const analysis = analyse(document.getText(), { file: document.uri, dialect: context.dialect });
    const diagnostics = analysis.diagnostics.map(toLspDiagnostic);
    if (context.kind === "unassessed") diagnostics.unshift(unassessedDiagnostic(context.reason, context.dialect));
    if (context.kind === "assessed" && analysis.ok) diagnostics.push(...lintDiagnostics(document, context, projectLint));
    connection.sendDiagnostics({ uri: document.uri, version: document.version, diagnostics });
  };

  /**
   * The project's lint findings for an assessed document that compiled (#2074). A
   * malformed `tkr-lint.json` is reported, never silently treated as the defaults.
   */
  const lintDiagnostics = (document: TextDocument, context: Extract<DocumentContext, { kind: "assessed" }>, projectLint?: ProjectLint): LspDiagnostic[] => {
    const config = readProjectLintConfig(context.project.lintConfig);
    if (!config.ok) {
      return [{
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        severity: DiagnosticSeverity.Error,
        code: CONFIG_CODE,
        source: "rpgcode",
        message: `${config.message}. Lint findings are not published until the configuration is fixed.`,
      }];
    }
    const program = indexOf(document, context.project.pathOfUri.get(document.uri) ?? document.uri);
    if (program === null) return [];
    const inProjectLint = projectLint?.files.has(program.name) === true ? projectLint.result : undefined;
    const result = documentLint(program, document.getText(), context.dialect, plugins, config.config, inProjectLint);
    const diagnostics = result.diagnostics.map(toLspDiagnostic);
    const { unassessed } = result.summary;
    if (unassessed.length > 0) {
      diagnostics.push({
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        severity: DiagnosticSeverity.Information,
        code: LINT_UNASSESSED_CODE,
        source: "rpgcode",
        message: `Lint rules that could not be fully checked: ${unassessed.map(({ rule, reason }) => `${rule} (${reason})`).join(", ")}.`,
        data: unassessed,
      });
    }
    return diagnostics;
  };

  const publishProject = (changed?: TextDocument): void => {
    const previouslyAssessed = projectLint !== undefined;
    projectLint = undefined;
    if (project.kind === "project" && project.dialect === "tk3" && [...documents.values()].some((document) => contextOf(document).kind === "assessed")) {
      const config = readProjectLintConfig(project.lintConfig);
      if (config.ok && !(config.config.severity?.["lint/unused-label"] === "off" && config.config.severity?.["lint/unused-function"] === "off")) {
        const loader = projectLoader(project, (uri) => documents.get(uri)?.getText());
        const indexed = indexLintProject(project.main, loader, plugins, project.inventoryComplete);
        if (indexed.project !== undefined) {
          projectLint = {
            files: new Set(indexed.gameFiles),
            result: lint(indexed.document, {
              plugins, config: config.config, dialect: project.dialect, project: indexed.project,
            }),
          };
        }
      }
    }
    if (changed !== undefined && !previouslyAssessed && projectLint === undefined) {
      publish(changed);
      return;
    }
    for (const document of documents.values()) {
      if (changed === undefined || contextOf(document).kind === "assessed") publish(document, projectLint);
    }
  };

  connection.onNotification(PROJECT_NOTIFICATION, (params) => {
    const snapshot = readSnapshot(params);
    if (snapshot === undefined || snapshot.revision <= project.revision) return;
    project = projectModel(snapshot);
    publishProject();
  });

  /**
   * The document URI of a unit the index names: the open document for its own
   * unit, the original inventory URI for an included one. A folded key is never
   * a location (docs/spec/engine/rpgcode-tooling.md#tool-1-project).
   */
  const uriOfUnit = (document: TextDocument, program: IndexProgram, unit: string): string | null => {
    if (unit === program.key) return document.uri;
    const context = contextOf(document);
    if (context.kind !== "assessed") return null;
    return context.project.uriOfKey.get(unit) ?? null;
  };

  /** The function a call names, inside the file its include resolved to. */
  const targetOf = (document: TextDocument, program: IndexProgram, call: IndexCall): Location | null => {
    if (call.file === null) {
      const local = program.functions.find((fn) => fn.name === call.name && fn.arity === call.arity);
      return local === undefined ? null : locationOf(document, program, local);
    }
    const wanted = foldAscii(`${call.file}.prg`);
    const include = program.includes.find((item) => foldAscii(item.path) === wanted && item.key !== undefined);
    if (include === undefined || include.key === undefined) return null;
    const fn = program.functions.find((item) => item.file === include.key && item.name === call.name && item.arity === call.arity);
    return fn === undefined ? null : locationOf(document, program, fn);
  };

  const locationOf = (
    document: TextDocument,
    program: IndexProgram,
    declaration: { readonly file: string; readonly line: number; readonly col?: number; readonly endCol?: number },
  ): Location | null => {
    const uri = uriOfUnit(document, program, declaration.file);
    return uri === null ? null : { uri, range: lspRange(declaration.line, declaration.col, declaration.endCol) };
  };

  const includeTarget = (document: TextDocument, program: IndexProgram, include: IndexInclude): Location | null => {
    if (include.key === undefined) return null;
    const uri = uriOfUnit(document, program, include.key);
    return uri === null ? null : { uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } };
  };

  /** Sites of the open document's own unit; an included unit's sites have its own lines. */
  const ownCalls = (program: IndexProgram): readonly IndexCall[] => program.calls.filter((item) => item.pos.file === program.key);

  connection.onInitialize(() => ({
    capabilities: {
      textDocumentSync: { openClose: true, change: 1 },
      hoverProvider: true,
      completionProvider: { triggerCharacters: ["(", ":"] },
      signatureHelpProvider: { triggerCharacters: ["(", ","] },
      definitionProvider: true,
      documentSymbolProvider: true,
      codeActionProvider: true,
      documentFormattingProvider: true,
    },
  }));

  connection.onDidOpenTextDocument((params) => {
    const { textDocument } = params;
    const previous = documents.get(textDocument.uri)?.getText();
    const document = TextDocument.create(textDocument.uri, textDocument.languageId, textDocument.version, textDocument.text);
    documents.set(textDocument.uri, document);
    const context = contextOf(document);
    if (context.kind !== "assessed") publish(document);
    else if (projectLint !== undefined && (previous ?? snapshotText(context, document.uri)) === document.getText()) publish(document, projectLint);
    else publishProject(document);
  });

  connection.onDidChangeTextDocument((params) => {
    const current = documents.get(params.textDocument.uri);
    if (current === undefined) return;
    const previous = current.getText();
    const next = TextDocument.update(
      current,
      params.contentChanges.map((change) => ("range" in change ? { range: change.range, text: change.text } : { text: change.text })),
      params.textDocument.version,
    );
    documents.set(next.uri, next);
    if (contextOf(next).kind !== "assessed") publish(next);
    else if (next.getText() === previous) publish(next, projectLint);
    else publishProject(next);
  });

  connection.onDidCloseTextDocument?.(({ textDocument }) => {
    const document = documents.get(textDocument.uri);
    if (document === undefined) return;
    documents.delete(textDocument.uri);
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: [] });
    const context = contextOf(document);
    if (context.kind === "assessed" && snapshotText(context, document.uri) !== document.getText()) publishProject();
  });

  connection.onHover((params) => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined) return null;
    const program = indexOf(document);
    if (program === null) return null;
    const line = params.position.line + 1;
    const column = params.position.character + 1;
    const call = ownCalls(program).find((item) => covers(item.pos, line, column));
    if (call === undefined) return null;
    const entry = help.find((item) => foldAscii(item.name) === foldAscii(call.name));
    if (entry === undefined) return null;
    return { contents: { kind: "markdown", value: documentationText(entry) }, range: lspRange(call.pos.line, call.pos.col, call.pos.endCol) };
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

  connection.onSignatureHelp((params) => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined) return null;
    return signatureHelp(document.getText(), document.offsetAt(params.position), document.languageId, help);
  });

  connection.onDefinition((params) => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined) return [];
    const program = indexOf(document);
    if (program === null) return [];
    const line = params.position.line + 1;
    const column = params.position.character + 1;
    const call = ownCalls(program).find((item) => covers(item.pos, line, column));
    if (call !== undefined) {
      const target = targetOf(document, program, call);
      return target === null ? [] : [target];
    }
    const include = program.includes.find((item) => item.file === program.key &&
      covers(
        item.col === undefined || item.endCol === undefined
          ? { line: item.line }
          : { line: item.line, col: item.col, endCol: item.endCol },
        line,
        column,
      ),
    );
    if (include !== undefined) {
      const target = includeTarget(document, program, include);
      return target === null ? [] : [target];
    }
    return [];
  });

  connection.onCodeAction((params) => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined) return [];
    if (document.languageId === "rpgcode-tk2") {
      const reason = tk2ConversionRefusal(document.getText());
      if (reason !== null) return [{ title: "Preview Toolkit 2.x conversion", kind: "refactor.rewrite", disabled: { reason } }];
    }
    return legacyFixes(document.getText(), document.languageId === "rpgcode-tk2" ? "tk2" : "tk3").map((fix) => {
      if (fix.rule === "dialect/tk2-to-tk3") {
        return {
          title: fix.title,
          kind: "refactor.rewrite",
          command: { title: fix.title, command: "rpgcode.previewTk2Conversion", arguments: [applyEdits(document.getText(), fix.edits)] },
        };
      }
      return {
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
      };
    });
  });

  /**
   * TOOL-4 formatting, for a document the running project assesses as 3.1. A
   * Toolkit 2.x or unassessed document is refused: no edit, and a warning that
   * says why, because its loose lines may be dialogue the rewrite would change
   * (docs/spec/engine/rpgcode-tooling.md#tool-1-project, #tool-4).
   */
  connection.onDocumentFormatting((params) => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined) return null;
    const context = contextOf(document);
    const refuse = (why: string): TextEdit[] => {
      connection.showMessage({ type: MessageType.Warning, message: `RPGCode did not format ${document.uri}: ${why}` });
      return [];
    };
    if (context.kind === "unassessed") {
      return refuse(`its dialect is unassessed (${context.reason}). Formatting rewrites only 3.1 source; select the running project (.gam) to establish the dialect.`);
    }
    const text = document.getText();
    const indentWidth = Number.isInteger(params.options.tabSize) && params.options.tabSize > 0 ? params.options.tabSize : 4;
    const result = formatSource(text, { dialect: context.dialect, indentWidth });
    if (result.skipped === "tk2-dialect") {
      return refuse("the running project is Toolkit 2.x (tk2-dialect), where a loose line is dialogue the formatter must not rewrite.");
    }
    if (!result.changed) return [];
    return [{ range: { start: { line: 0, character: 0 }, end: document.positionAt(text.length) }, newText: result.text }];
  });

  connection.onDocumentSymbol((params) => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined) return [];
    const program = indexOf(document);
    if (program === null) return [];
    const symbols: DocumentSymbol[] = [];
    for (const fn of program.functions.filter((item) => item.file === program.key)) {
      symbols.push({ name: fn.qualifiedName, kind: SymbolKind.Function, range: lspRange(fn.line, fn.col, fn.endCol), selectionRange: lspRange(fn.line, fn.col, fn.endCol) });
    }
    for (const cls of program.classes.filter((item) => item.file === program.key)) {
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
    for (const label of program.labels.filter((item) => item.file === program.key)) {
      symbols.push({ name: label.name, kind: SymbolKind.Key, range: lspRange(label.line, label.col, label.endCol), selectionRange: lspRange(label.line, label.col, label.endCol) });
    }
    return symbols;
  });

  return {
    text: (uri) => documents.get(uri)?.getText(),
    project: () => project,
  };
}

/** The marker that an unassessed document's diagnostics are provisional, never a clean result. */
function unassessedDiagnostic(reason: string, dialect: "tk2" | "tk3"): LspDiagnostic {
  const reading = dialect === "tk2" ? "Toolkit 2.x" : "3.1";
  return {
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    severity: DiagnosticSeverity.Information,
    code: UNASSESSED_CODE,
    source: "rpgcode",
    message: `Dialect unassessed: ${reason}. This file is read provisionally as ${reading} from its language mode; select the running project (.gam) to analyse it as the game runs it.`,
  };
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
