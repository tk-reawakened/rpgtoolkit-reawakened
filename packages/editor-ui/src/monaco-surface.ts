import * as monaco from "monaco-editor/editor/editor.api";
import "./monaco-features.ts";
import type { ProgramPreferences } from "@tk-reawakened/editor-model";
import { diffText, type LanguageFeatures, type SurfaceDiagnostic, type TextChange, type TextSurface, type TextSurfaceFactory, type TextSurfaceHost } from "./text-surface.ts";

/**
 * The Monaco text surface of the program editor (ADR 0021, ADR 0029, docs/spec/engine/rpgcode-tooling.md#tool-10).
 * Monaco is a view: it shows the document's text and reports the author's edits, and it is a client of the language
 * server through the program view, which holds the connection. Nothing here reads a file, owns the text or keeps an
 * undo stack that disagrees with the document's.
 *
 * Importing this module loads Monaco, so only a browser page does it; the program view itself never imports it and a
 * page that does not choose it edits in a plain text area.
 */

export interface MonacoSurfaceOptions {
  /**
   * The URL of the same-origin classic worker script (`monaco-editor/editor/editor.worker` bundled by the host's build).
   * A classic worker at a same-origin URL needs no `blob:` source and no `unsafe-eval` (ADR 0029).
   */
  readonly workerUrl: string;
}

const LANGUAGE_ID = "rpgcode";
const THEME = "tkr-rpgcode";

let installed = false;
let workerUrl = "";
let surfaces = 0;

/** LSP `SymbolKind` and Monaco's differ by one for the kinds the server uses (Monaco has no `Module`-before-`File` offset). */
function symbolKind(kind: number): monaco.languages.SymbolKind {
  return (kind - 1) as monaco.languages.SymbolKind;
}

const COMPLETION_KINDS: Readonly<Record<number, monaco.languages.CompletionItemKind>> = {
  2: monaco.languages.CompletionItemKind.Method,
  3: monaco.languages.CompletionItemKind.Function,
  7: monaco.languages.CompletionItemKind.Class,
  24: monaco.languages.CompletionItemKind.Operator,
};

/** Monaco loads its workers through `MonacoEnvironment`; one same-origin classic worker serves every editor in the page. */
function install(options: MonacoSurfaceOptions): void {
  workerUrl = options.workerUrl;
  if (installed) return;
  installed = true;
  (globalThis as { MonacoEnvironment?: unknown }).MonacoEnvironment = {
    getWorker: () => new Worker(workerUrl),
  };
  monaco.languages.register({ id: LANGUAGE_ID, extensions: [".prg"], aliases: ["RPGCode"] });
  monaco.languages.setLanguageConfiguration(LANGUAGE_ID, {
    comments: { lineComment: "//", blockComment: ["/*", "*/"] },
    brackets: [["{", "}"], ["[", "]"], ["(", ")"]],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"', notIn: ["string", "comment"] },
    ],
    surroundingPairs: [{ open: "{", close: "}" }, { open: "[", close: "]" }, { open: "(", close: ")" }, { open: '"', close: '"' }],
    // Names are letters, digits and `_`, with an optional leading `~` (docs/spec/engine/rpgcode-language.md#lexical-rules).
    wordPattern: /~?[A-Za-z0-9_]+/,
    indentationRules: {
      increaseIndentPattern: /\{[^}"']*$/,
      decreaseIndentPattern: /^\s*\}/,
    },
  });
}

/** The theme for the author's colours. Semantic tokens match a rule by `type` or `type.modifier`. */
function defineTheme(preferences: ProgramPreferences): void {
  const rule = (token: string, foreground: string, fontStyle = ""): monaco.editor.ITokenThemeRule => ({ token, foreground: foreground.replace(/^#/, ""), fontStyle });
  const keyword = preferences.keywordBold ? "bold" : "";
  monaco.editor.defineTheme(THEME, {
    base: "vs",
    inherit: true,
    rules: [
      rule("comment", preferences.commentColor, preferences.commentItalic ? "italic" : ""),
      rule("string", preferences.stringColor),
      rule("number", preferences.numberColor),
      rule("keyword", preferences.keywordColor, keyword),
      rule("function", preferences.keywordColor, keyword),
      rule("label", preferences.keywordColor, keyword),
      rule("macro", preferences.keywordColor, keyword),
    ],
    colors: {},
  });
  monaco.editor.setTheme(THEME);
}

function position(value: { readonly line: number; readonly character: number }): monaco.IPosition {
  return { lineNumber: value.line + 1, column: value.character + 1 };
}

function range(value: SurfaceDiagnostic["range"]): monaco.IRange {
  return { startLineNumber: value.start.line + 1, startColumn: value.start.character + 1, endLineNumber: value.end.line + 1, endColumn: value.end.character + 1 };
}

const SEVERITY: Readonly<Record<number, monaco.MarkerSeverity>> = {
  1: monaco.MarkerSeverity.Error,
  2: monaco.MarkerSeverity.Warning,
  3: monaco.MarkerSeverity.Info,
  4: monaco.MarkerSeverity.Hint,
};

interface LspRange {
  readonly start: { readonly line: number; readonly character: number };
  readonly end: { readonly line: number; readonly character: number };
}
interface LspMarkup {
  readonly kind?: string;
  readonly value: string;
}
interface LspHover {
  readonly contents: string | LspMarkup | readonly (string | LspMarkup)[];
  readonly range?: LspRange;
}
interface LspCompletion {
  readonly label: string;
  readonly kind?: number;
  readonly detail?: string;
}
interface LspSignatureHelp {
  readonly signatures: readonly { readonly label: string; readonly documentation?: string | LspMarkup; readonly parameters?: readonly { readonly label: string | readonly [number, number]; readonly documentation?: string | LspMarkup }[] }[];
  readonly activeSignature?: number;
  readonly activeParameter?: number;
}
interface LspSymbol {
  readonly name: string;
  readonly kind: number;
  readonly range: LspRange;
  readonly selectionRange: LspRange;
  readonly children?: readonly LspSymbol[];
}
interface LspTextEdit {
  readonly range: LspRange;
  readonly newText: string;
}
interface LspCodeAction {
  readonly title: string;
  readonly kind?: string;
  readonly edit?: { readonly changes?: Readonly<Record<string, readonly LspTextEdit[]>> };
}

/** A property of an object the server sent, or `undefined`; the caller checks the shape of what it gets. */
function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && key in value ? Reflect.get(value, key) : undefined;
}

function isLegend(value: unknown): value is monaco.languages.SemanticTokensLegend {
  const types = field(value, "tokenTypes");
  const modifiers = field(value, "tokenModifiers");
  return Array.isArray(types) && Array.isArray(modifiers) && types.every((item) => typeof item === "string") && modifiers.every((item) => typeof item === "string");
}

function strings(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

const asMarkdown = (value: string | LspMarkup): monaco.IMarkdownString => ({ value: typeof value === "string" ? value : value.value });

function symbolOf(symbol: LspSymbol): monaco.languages.DocumentSymbol {
  return {
    name: symbol.name,
    detail: "",
    kind: symbolKind(symbol.kind),
    tags: [],
    range: range(symbol.range),
    selectionRange: range(symbol.selectionRange),
    ...(symbol.children === undefined ? {} : { children: symbol.children.map(symbolOf) }),
  };
}

/** Register the language providers of one document, selected by its private URI scheme; returns what removes them. */
function registerProviders(model: monaco.editor.ITextModel, features: LanguageFeatures): monaco.IDisposable[] {
  const selector: monaco.languages.LanguageSelector = { scheme: model.uri.scheme };
  const has = (capability: string): boolean => features.capabilities[capability] !== undefined && features.capabilities[capability] !== false;
  const triggers = (capability: string, fallback: readonly string[]): string[] => strings(field(features.capabilities[capability], "triggerCharacters")) ?? [...fallback];
  const here = (params: Record<string, unknown>, at: monaco.Position): Record<string, unknown> => ({ ...params, position: { line: at.lineNumber - 1, character: at.column - 1 } });
  const disposables: monaco.IDisposable[] = [];

  const legend = field(features.capabilities.semanticTokensProvider, "legend");
  if (isLegend(legend)) {
    disposables.push(monaco.languages.registerDocumentSemanticTokensProvider(selector, {
      getLegend: () => legend,
      async provideDocumentSemanticTokens() {
        const result = await features.request<{ readonly data: readonly number[] }>("textDocument/semanticTokens/full", {});
        return { data: Uint32Array.from(result.data) };
      },
      releaseDocumentSemanticTokens: () => undefined,
    }));
  }
  if (has("hoverProvider")) {
    disposables.push(monaco.languages.registerHoverProvider(selector, {
      async provideHover(_model, at) {
        const hover = await features.request<LspHover | null>("textDocument/hover", here({}, at));
        if (hover === null) return null;
        const contents = Array.isArray(hover.contents) ? hover.contents : [hover.contents];
        return { contents: (contents as readonly (string | LspMarkup)[]).map(asMarkdown), ...(hover.range === undefined ? {} : { range: range(hover.range) }) };
      },
    }));
  }
  if (has("completionProvider")) {
    disposables.push(monaco.languages.registerCompletionItemProvider(selector, {
      triggerCharacters: triggers("completionProvider", ["(", ":"]),
      async provideCompletionItems(current, at) {
        const items = await features.request<readonly LspCompletion[] | { readonly items: readonly LspCompletion[] }>("textDocument/completion", here({}, at));
        const word = current.getWordUntilPosition(at);
        const replace: monaco.IRange = { startLineNumber: at.lineNumber, endLineNumber: at.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
        const listed = Array.isArray(items) ? items : field(items, "items");
        const list: readonly LspCompletion[] = Array.isArray(listed) ? listed : [];
        return {
          suggestions: list.map((item) => ({
            label: item.label,
            kind: COMPLETION_KINDS[item.kind ?? 0] ?? monaco.languages.CompletionItemKind.Text,
            insertText: item.label,
            ...(item.detail === undefined ? {} : { detail: item.detail }),
            range: replace,
          })),
        };
      },
    }));
  }
  if (has("signatureHelpProvider")) {
    disposables.push(monaco.languages.registerSignatureHelpProvider(selector, {
      signatureHelpTriggerCharacters: triggers("signatureHelpProvider", ["(", ","]),
      async provideSignatureHelp(_model, at) {
        const help = await features.request<LspSignatureHelp | null>("textDocument/signatureHelp", here({}, at));
        if (help === null || help.signatures.length === 0) return null;
        return {
          value: {
            signatures: help.signatures.map((signature) => ({
              label: signature.label,
              ...(signature.documentation === undefined ? {} : { documentation: asMarkdown(signature.documentation) }),
              parameters: (signature.parameters ?? []).map((parameter) => ({
                label: parameter.label as string | [number, number],
                ...(parameter.documentation === undefined ? {} : { documentation: asMarkdown(parameter.documentation) }),
              })),
            })),
            activeSignature: help.activeSignature ?? 0,
            activeParameter: help.activeParameter ?? 0,
          },
          dispose: () => undefined,
        };
      },
    }));
  }
  if (has("definitionProvider")) {
    disposables.push(monaco.languages.registerDefinitionProvider(selector, {
      async provideDefinition(_model, at) {
        const locations = await features.request<readonly { readonly uri: string; readonly range: LspRange }[] | null>("textDocument/definition", here({}, at));
        // Only the open program can be shown: another file is a document of its own, opened from the project tree.
        return (locations ?? []).filter((location) => location.uri === features.uri).map((location) => ({ uri: model.uri, range: range(location.range) }));
      },
    }));
  }
  if (has("documentSymbolProvider")) {
    disposables.push(monaco.languages.registerDocumentSymbolProvider(selector, {
      async provideDocumentSymbols() {
        const symbols = await features.request<readonly LspSymbol[] | null>("textDocument/documentSymbol", {});
        return (symbols ?? []).map(symbolOf);
      },
    }));
  }
  if (has("codeActionProvider")) {
    disposables.push(monaco.languages.registerCodeActionProvider(selector, {
      async provideCodeActions(_model, selected) {
        const actions = await features.request<readonly LspCodeAction[] | null>("textDocument/codeAction", {
          range: { start: { line: selected.startLineNumber - 1, character: selected.startColumn - 1 }, end: { line: selected.endLineNumber - 1, character: selected.endColumn - 1 } },
          context: { diagnostics: [] },
        });
        const fixes = (actions ?? []).flatMap((action) => {
          const edits = action.edit?.changes?.[features.uri];
          // An action that runs a client command (the Toolkit 2.x conversion preview) has no edit to apply here.
          if (edits === undefined || edits.length === 0) return [];
          return [{
            title: action.title,
            ...(action.kind === undefined ? {} : { kind: action.kind }),
            edit: { edits: edits.map((edit) => ({ resource: model.uri, versionId: undefined, textEdit: { range: range(edit.range), text: edit.newText } })) },
          }];
        });
        return { actions: fixes, dispose: () => undefined };
      },
    }));
  }
  if (has("documentFormattingProvider")) {
    disposables.push(monaco.languages.registerDocumentFormattingEditProvider(selector, {
      async provideDocumentFormattingEdits(_model, options) {
        const edits = await features.request<readonly LspTextEdit[] | null>("textDocument/formatting", { options: { tabSize: options.tabSize, insertSpaces: options.insertSpaces } });
        return (edits ?? []).map((edit) => ({ range: range(edit.range), text: edit.newText }));
      },
    }));
  }
  return disposables;
}

/** Make the Monaco surface factory for a page. The page imports this module and gives the result to its projects. */
export function createMonacoSurfaceFactory(options: MonacoSurfaceOptions): TextSurfaceFactory {
  return (element: HTMLElement, host: TextSurfaceHost): TextSurface => {
    install(options);
    surfaces += 1;
    const uri = monaco.Uri.from({ scheme: `tkr-${surfaces}`, path: `/${host.name}` });
    const model = monaco.editor.createModel(host.text, LANGUAGE_ID, uri);
    // The document and the surface agree on `LF`: a pasted CRLF is normalised to it, and offsets count one per break.
    model.setEOL(monaco.editor.EndOfLineSequence.LF);
    defineTheme(host.preferences);
    const editor = monaco.editor.create(element, {
      model,
      theme: THEME,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      readOnly: host.readOnly,
      tabSize: 4,
      insertSpaces: true,
      detectIndentation: false,
      renderWhitespace: "selection",
      fixedOverflowWidgets: true,
      "semanticHighlighting.enabled": true,
      ariaLabel: "Program text. Press Control+M, or Command+M on a Mac, to let Tab leave the editor.",
      accessibilitySupport: "auto",
    });
    const undo = editor.addAction({
      id: "tkr-document-undo",
      label: "Undo",
      contextMenuGroupId: "1_modification",
      contextMenuOrder: 1,
      run: () => {
        if (!host.onUndo()) void model.undo();
      },
    });
    const redo = editor.addAction({
      id: "tkr-document-redo",
      label: "Redo",
      contextMenuGroupId: "1_modification",
      contextMenuOrder: 2,
      run: () => {
        if (!host.onRedo()) void model.redo();
      },
    });
    // Applying the document's text to the model is not the author editing it.
    let applying = false;
    let providers: monaco.IDisposable[] = [];
    const changes = model.onDidChangeContent((event) => {
      if (applying) return;
      host.onChange(event.changes.map((change): TextChange => ({ from: change.rangeOffset, to: change.rangeOffset + change.rangeLength, text: change.text })));
    });
    const keys = editor.onKeyDown((event) => {
      const command = event.ctrlKey || event.metaKey;
      if (command && !event.altKey && event.keyCode === monaco.KeyCode.KeyS) {
        event.preventDefault();
        event.stopPropagation();
        host.onSave();
      } else if (command && !event.altKey && event.keyCode === monaco.KeyCode.KeyZ) {
        if (event.shiftKey ? host.onRedo() : host.onUndo()) {
          event.preventDefault();
          event.stopPropagation();
        }
      } else if (command && !event.altKey && !event.shiftKey && event.keyCode === monaco.KeyCode.KeyY) {
        if (host.onRedo()) {
          event.preventDefault();
          event.stopPropagation();
        }
      } else if (event.keyCode === monaco.KeyCode.Escape) {
        host.onEscape();
      }
    });
    const blur = editor.onDidBlurEditorText(() => host.onBlur());

    const selectOffsets = (from: number, to: number): void => {
      const start = model.getPositionAt(from);
      const end = model.getPositionAt(to);
      editor.setSelection(new monaco.Selection(start.lineNumber, start.column, end.lineNumber, end.column));
      editor.revealRangeInCenterIfOutsideViewport(new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column));
    };

    return {
      setText(text) {
        const change = diffText(model.getValue(), text);
        if (change === null) return;
        const before = editor.getSelection();
        const start = model.getPositionAt(change.from);
        const end = model.getPositionAt(change.to);
        applying = true;
        try {
          model.applyEdits([{ range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column), text: change.text, forceMoveMarkers: false }]);
        } finally {
          applying = false;
        }
        if (before !== null) editor.setSelection(before);
      },
      getText: () => model.getValue(),
      getSelection: () => {
        const selection = editor.getSelection();
        return selection === null ? { from: 0, to: 0 } : { from: model.getOffsetAt(selection.getStartPosition()), to: model.getOffsetAt(selection.getEndPosition()) };
      },
      select(from, to) {
        selectOffsets(from, to);
        editor.focus();
      },
      revealLine(line) {
        const target = Math.min(Math.max(line + 1, 1), model.getLineCount());
        editor.setPosition({ lineNumber: target, column: 1 });
        editor.revealLineInCenterIfOutsideViewport(target);
        editor.focus();
      },
      setReadOnly: (readOnly) => editor.updateOptions({ readOnly }),
      // The theme is global to the page: the latest change wins, and every editor shows it.
      setPreferences: defineTheme,
      setDiagnostics(diagnostics) {
        monaco.editor.setModelMarkers(model, LANGUAGE_ID, diagnostics.map((item) => ({
          ...range(item.range),
          severity: SEVERITY[item.severity ?? 1] ?? monaco.MarkerSeverity.Error,
          message: item.message,
          source: "rpgcode",
          ...(item.code === undefined ? {} : { code: String(item.code) }),
        })));
      },
      setLanguage(features) {
        for (const provider of providers) provider.dispose();
        providers = features === null ? [] : registerProviders(model, features);
      },
      focus: () => editor.focus(),
      dispose() {
        for (const provider of providers) provider.dispose();
        providers = [];
        monaco.editor.setModelMarkers(model, LANGUAGE_ID, []);
        keys.dispose();
        undo.dispose();
        redo.dispose();
        blur.dispose();
        changes.dispose();
        editor.dispose();
        model.dispose();
      },
    };
  };
}
