import { deepEqual, equal, match, rejects } from "node:assert/strict";
import test, { after } from "node:test";
import { transformSource } from "@tk-reawakened/script-tools";
import { createServer, PROJECT_NOTIFICATION, SCRIPT_TRANSFORM_REQUEST, type ServerConnection } from "../src/index.ts";
import { mainFileBytes, memoryProject } from "./project-support.ts";
import { startStdio } from "./stdio-client.ts";

/**
 * Story 13.16 (docs/spec/engine/rpgcode-tooling.md#tool-11): the one request both editor hosts send to run a reviewed
 * transform. The server answers with the proposal and never edits a document; the dialect is the running project's.
 */

type Answer = {
  readonly uri: string;
  readonly transform: string;
  readonly status: "changed" | "unchanged" | "refused";
  readonly text: string;
  readonly dialect: "tk2" | "tk3";
  readonly established: boolean;
  readonly target: "in-place" | "copy";
  readonly reason?: { readonly code: string };
  readonly unsupported: readonly { readonly line: number | null; readonly code: string }[];
  readonly reviews: readonly { readonly line: number; readonly index: string }[];
};

function server() {
  const absent = { dispose: () => {} };
  const handlers = new Map<string, (params: never) => unknown>();
  const notifications = new Map<string, (params: unknown) => void>();
  const connection: ServerConnection = {
    onInitialize: () => absent,
    onDidOpenTextDocument: () => absent,
    onDidChangeTextDocument: () => absent,
    onHover: () => absent,
    onCompletion: () => absent,
    onDefinition: () => absent,
    onDocumentSymbol: () => absent,
    onSignatureHelp: () => absent,
    onDocumentFormatting: () => absent,
    onCodeAction: () => absent,
    showMessage: () => {},
    onRequest: (method, handler) => {
      handlers.set(method, handler);
      return absent;
    },
    onNotification: (method, handler) => {
      notifications.set(method, handler);
      return absent;
    },
    sendDiagnostics: () => {},
  };
  createServer(connection);
  return {
    project: (snapshot: unknown) => notifications.get(PROJECT_NOTIFICATION)!(snapshot),
    ask: async (params: unknown): Promise<Answer> => await (handlers.get(SCRIPT_TRANSFORM_REQUEST)!(params as never) as Promise<Answer>),
  };
}

const MODERN = memoryProject({ "Main/game.gam": mainFileBytes("tk3"), "Prg/main.prg": "" }, "Main/game.gam");
const LEGACY = memoryProject({ "Main/legacy.gam": mainFileBytes("tk2"), "Prg/old.prg": "" }, "Main/legacy.gam", { rootUri: "file:///legacy/" });
const MESSY = 'x! = 1\nIF (x == 1) {\nMWIN("Hello")\n}\n';

test("a 3.1 project's program answers every transform exactly as the shared provider does, without needing an open document", async () => {
  const lsp = server();
  lsp.project(MODERN.snapshot());
  const uri = MODERN.uri("Prg/main.prg");
  for (const transform of ["format", "canonical-case", "update", "cleanup"] as const) {
    const answer = await lsp.ask({ transform, textDocument: { uri }, text: MESSY });
    const expected = transformSource({ transform, text: MESSY, dialect: "tk3", established: true });
    equal(answer.text, expected.text, transform);
    equal(answer.status, expected.status);
    equal(answer.established, true, "the project assessed it");
    equal(answer.uri, uri);
  }
  equal((await lsp.ask({ transform: "cleanup", textDocument: { uri }, text: MESSY })).text, 'x = 1\nif (x == 1) {\n    mwin("Hello")\n}\n');
  equal((await lsp.ask({ transform: "format", textDocument: { uri }, text: "if (x) {\nmwin(1)\n}\n", indentWidth: 2 })).text, "if (x) {\n  mwin(1)\n}\n", "the indent width is honoured");
});

test("a Toolkit 2.x project's program is refused for formatting and converted to a copy, whatever its language mode", async () => {
  const lsp = server();
  lsp.project(LEGACY.snapshot());
  const uri = LEGACY.uri("Prg/old.prg");
  for (const languageId of ["rpgcode", "rpgcode-tk2"] as const) {
    const format = await lsp.ask({ transform: "format", textDocument: { uri, languageId }, text: "Mwin(hello)\n" });
    equal(format.status, "refused");
    equal(format.reason?.code, "tk2-dialect");
    equal(format.text, "Mwin(hello)\n");
    const update = await lsp.ask({ transform: "update", textDocument: { uri, languageId }, text: "#Mwin(hello)\n" });
    equal(update.status, "changed");
    equal(update.target, "copy");
    equal(update.dialect, "tk2");
    equal(update.text, 'Mwin("hello")\n');
  }
  const refused = await lsp.ask({ transform: "update", textDocument: { uri }, text: '#Mwin(ok)\nShe said "hi"\n#Include(a.prg)\n' });
  equal(refused.status, "refused");
  deepEqual(refused.unsupported.map(({ line, code }) => ({ line, code })), [{ line: 2, code: "dialogue-quote" }, { line: 3, code: "dynamic-source" }]);
});

test("a file outside the running project is unassessed: formatting is refused and an edit must hold under both readings", async () => {
  const lsp = server();
  lsp.project(MODERN.snapshot());
  const stray = await lsp.ask({ transform: "format", textDocument: { uri: "file:///elsewhere/a.prg" }, text: "MWIN(x)\n" });
  equal(stray.status, "refused");
  equal(stray.reason?.code, "unassessed");
  equal(stray.established, false);
  const tk2Mode = await lsp.ask({ transform: "update", textDocument: { uri: "file:///elsewhere/b.prg", languageId: "rpgcode-tk2" }, text: "#Mwin(hi)\n" });
  equal(tk2Mode.status, "changed", "an author-selected Toolkit 2.x language mode converts");
  equal(tk2Mode.target, "copy");
  const none = server();
  equal((await none.ask({ transform: "canonical-case", textDocument: { uri: "file:///a.prg" }, text: "MWIN(x)\n" })).reason?.code, "unassessed");
});

test("a bound request without its snapshot fails promptly, then succeeds once the client sends that revision", { timeout: 1000 }, async () => {
  const lsp = server();
  const request = { transform: "format", textDocument: { uri: MODERN.uri("Prg/main.prg") }, text: MESSY, project: { main: MODERN.uri("Main/game.gam"), revision: 1 } };
  await rejects(lsp.ask(request), /snapshot is unavailable or has changed/);
  lsp.project(MODERN.snapshot(1));
  const answer = await lsp.ask(request);
  equal(answer.status, "changed");
  equal(answer.established, true);
  equal(answer.text, 'x! = 1\nif (x == 1) {\n    mwin("Hello")\n}\n');
});

test("a malformed request is an error, never a silent no-op", async () => {
  const lsp = server();
  for (const bad of [
    { transform: "rewrite-everything", textDocument: { uri: "file:///a.prg" }, text: "" },
    { transform: "format", textDocument: {}, text: "" },
    { transform: "format", textDocument: { uri: "file:///a.prg" } },
    undefined,
  ]) {
    await rejects(lsp.ask(bad), /needs a transform/);
  }
});

const stdio = await startStdio();
after(async () => {
  await stdio.close();
});

test("the shipped stdio server answers the request over its real transport", { timeout: 15_000 }, async () => {
  await stdio.project(MODERN.snapshot(1));
  const uri = MODERN.uri("Prg/main.prg");
  const answer = await stdio.connection.sendRequest<Answer>(SCRIPT_TRANSFORM_REQUEST, {
    transform: "cleanup", textDocument: { uri }, text: MESSY, project: { main: MODERN.uri("Main/game.gam"), revision: 1 },
  });
  equal(answer.status, "changed");
  equal(answer.text, 'x = 1\nif (x == 1) {\n    mwin("Hello")\n}\n');
  equal(answer.established, true);
  await rejects(stdio.connection.sendRequest(SCRIPT_TRANSFORM_REQUEST, { transform: "nope", textDocument: { uri }, text: "" }), (error: Error) => {
    match(error.message, /needs a transform/);
    return true;
  });
});

test("a failed project generation rejects promptly, even if it arrived before the request", { timeout: 1000 }, async () => {
  const lsp = server();
  lsp.project({ revision: 2, main: null, problem: "the folder could not be read" });
  await rejects(lsp.ask({
    transform: "format", textDocument: { uri: MODERN.uri("Prg/main.prg") }, text: MESSY,
    project: { main: MODERN.uri("Main/game.gam"), revision: 2 },
  }), /snapshot is unavailable or has changed/);
});

test("a second main in the same root cannot use another main or a stale revision of its own", async () => {
  const lsp = server();
  const newer = memoryProject({ "Main/legacy.gam": mainFileBytes("tk2"), "Prg/main.prg": "" }, "Main/legacy.gam");
  const request = { transform: "update", textDocument: { uri: MODERN.uri("Prg/main.prg") }, text: "MWIN(Hello)\n", project: { main: newer.uri("Main/legacy.gam"), revision: 3 } };
  lsp.project(MODERN.snapshot(1));
  await rejects(lsp.ask(request), /snapshot is unavailable or has changed/);
  lsp.project(newer.snapshot(2));
  await rejects(lsp.ask(request), /snapshot is unavailable or has changed/);
  lsp.project(newer.snapshot(3));
  const answer = await lsp.ask(request);
  equal(answer.established, true);
  equal(answer.dialect, "tk2");
  equal(answer.target, "copy");
  lsp.project(MODERN.snapshot(4));
  await rejects(lsp.ask(request), /snapshot is unavailable or has changed/);
});
