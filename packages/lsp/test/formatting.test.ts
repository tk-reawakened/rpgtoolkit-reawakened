import { deepEqual, equal, match } from "node:assert/strict";
import test from "node:test";
import { formatSource } from "@tk-reawakened/script-tools";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { DidOpenTextDocumentParams, DocumentFormattingParams, ShowMessageParams, TextEdit } from "vscode-languageserver-protocol";
import { createServer, PROJECT_NOTIFICATION, type ServerConnection } from "../src/index.ts";
import { mainFileBytes, memoryProject, type MemoryProject } from "./project-support.ts";

/**
 * #2091: TOOL-4 formatting through the language server, for a document the
 * running project assesses as 3.1, and a visible refusal otherwise
 * (docs/spec/engine/rpgcode-tooling.md#tool-1-project, #tool-4).
 */

type Client = {
  readonly messages: ShowMessageParams[];
  project(project: MemoryProject): void;
  /** Open `text` and return the formatted text, or `null` when the server answered null. */
  format(uri: string, text: string, languageId?: string, tabSize?: number): { readonly edits: TextEdit[] | null; readonly text: string };
  capabilities(): unknown;
};

function client(): Client {
  const messages: ShowMessageParams[] = [];
  let open: (params: DidOpenTextDocumentParams) => void = () => {};
  let format: (params: DocumentFormattingParams) => TextEdit[] | null = () => null;
  let initialize: () => unknown = () => ({});
  const notifications = new Map<string, (params: unknown) => void>();
  const absent = { dispose: () => {} };
  const connection: ServerConnection = {
    onInitialize: (handler) => {
      initialize = () => handler({ processId: null, rootUri: null, capabilities: {} });
      return absent;
    },
    onDidOpenTextDocument: (handler) => {
      open = handler;
      return absent;
    },
    onDidChangeTextDocument: () => absent,
    onHover: () => absent,
    onCompletion: () => absent,
    onDefinition: () => absent,
    onDocumentSymbol: () => absent,
    onSignatureHelp: () => absent,
    onDocumentFormatting: (handler) => {
      format = handler;
      return absent;
    },
    showMessage: (params) => messages.push(params),
    onCodeAction: () => absent,
    onNotification: (method, handler) => {
      notifications.set(method, handler);
      return absent;
    },
    sendDiagnostics: () => {},
  };
  createServer(connection);
  return {
    messages,
    capabilities: () => initialize(),
    project: (project) => notifications.get(PROJECT_NOTIFICATION)?.(project.snapshot()),
    format: (uri, text, languageId = "rpgcode", tabSize = 4) => {
      open({ textDocument: { uri, languageId, version: 1, text } });
      const edits = format({ textDocument: { uri }, options: { tabSize, insertSpaces: true } });
      return { edits, text: TextDocument.applyEdits(TextDocument.create(uri, languageId, 1, text), edits ?? []) };
    },
  };
}

const MODERN = memoryProject({ "Main/game.gam": mainFileBytes("tk3"), "Prg/main.prg": "" }, "Main/game.gam");
const LEGACY = memoryProject({ "Main/legacy.gam": mainFileBytes("tk2"), "Prg/main.prg": "" }, "Main/legacy.gam");
const MESSY = 'IF (x == 1) {\nMWIN("Hello")\n  // keep MWIN in a comment\n}\nMwin(hello)';

test("the server advertises document formatting", () => {
  deepEqual((client().capabilities() as { capabilities: { documentFormattingProvider?: boolean } }).capabilities.documentFormattingProvider, true);
});

test("a 3.1 project's document is formatted exactly as TOOL-4's formatSource does", () => {
  const server = client();
  server.project(MODERN);
  const result = server.format(MODERN.uri("Prg/main.prg"), MESSY);
  equal(result.text, formatSource(MESSY, { dialect: "tk3" }).text);
  equal(result.text, 'if (x == 1) {\n    mwin("Hello")\n  // keep MWIN in a comment\n}\nmwin(hello)', "re-indented, names lowered, the comment line untouched, no final newline added");
  deepEqual(server.messages, []);
});

test("the editor's tab size is the indent width, and formatted text needs no edit", () => {
  const server = client();
  server.project(MODERN);
  equal(server.format(MODERN.uri("Prg/main.prg"), "if (x) {\nmwin(x)\n}\n", "rpgcode", 2).text, "if (x) {\n  mwin(x)\n}\n");
  deepEqual(server.format(MODERN.uri("Prg/main.prg"), "if (x) {\n  mwin(x)\n}\n", "rpgcode", 2).edits, []);
});

test("a Toolkit 2 project is refused unchanged with its reason, in either language mode", () => {
  for (const languageId of ["rpgcode", "rpgcode-tk2"]) {
    const server = client();
    server.project(LEGACY);
    const result = server.format(LEGACY.uri("Prg/main.prg"), "Mwin(hello)\n", languageId);
    deepEqual(result.edits, []);
    equal(result.text, "Mwin(hello)\n");
    equal(server.messages.length, 1);
    equal(server.messages[0]!.type, 2, "a warning");
    match(server.messages[0]!.message, /tk2-dialect/);
  }
});

test("an unassessed document is refused unchanged with its reason, even in the 3.1 language mode", () => {
  const server = client();
  const result = server.format("file:///loose/main.prg", "Mwin(hello)\n");
  deepEqual(result.edits, []);
  equal(result.text, "Mwin(hello)\n");
  match(server.messages[0]?.message ?? "", /dialect is unassessed \(no running project \(\.gam\) is selected\)/);
});
