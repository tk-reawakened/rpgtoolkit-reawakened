import { deepEqual, equal, match, notEqual, ok } from "node:assert/strict";
import { after, test } from "node:test";
import { ResponseError } from "vscode-jsonrpc/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { TextEdit } from "vscode-languageserver-protocol";
import { mainFileBytes, memoryProject } from "./project-support.ts";
import { startStdio } from "./stdio-client.ts";

/**
 * #2091 through the shipped stdio binary (docs/spec/engine/rpgcode-tooling.md#tool-1-project,
 * #tool-4). The first three checks were prepared before the implementation, red on main
 * (commit 866262da); they now share one server, as an editor does.
 */

const client = await startStdio();
after(async () => {
  await client.close();
});

const OPTIONS = { tabSize: 2, insertSpaces: true };

test("stdio advertises the document formatting provider", () => {
  ok(client.initialized.capabilities.documentFormattingProvider, "the LSP must advertise document formatting");
});

for (const languageId of ["rpgcode", "rpgcode-tk2"]) {
  test(`stdio never rewrites unassessed dialogue in ${languageId}`, { timeout: 15_000 }, async () => {
    const uri = `file:///Prg/unknown-project-${languageId}.prg`;
    const text = "Mwin(hello)\n";
    const document = TextDocument.create(uri, languageId, 1, text);
    await client.open(uri, text, languageId);
    const before = client.messages.length;
    try {
      const edits = await client.connection.sendRequest<TextEdit[] | null>("textDocument/formatting", { textDocument: { uri }, options: OPTIONS });
      deepEqual(TextDocument.applyEdits(document, edits ?? []), text, "unknown project dialect cannot authorize a rewrite");
    } catch (error) {
      if (!(error instanceof ResponseError)) throw error;
      // Missing method and internal failure are not evidence of a safe refusal.
      notEqual(error.code, -32601, "formatting must be implemented");
      notEqual(error.code, -32603, "an internal error is not a deliberate refusal");
    }
    equal(client.messages.length, before + 1, "the refusal is visible");
    match(client.messages.at(-1)!.message, /dialect is unassessed/);
  });
}

test("stdio formats a 3.1 project's document and refuses a Toolkit 2 one with a visible reason", { timeout: 15_000 }, async () => {
  const modern = memoryProject({ "Main/game.gam": mainFileBytes("tk3"), "Prg/main.prg": "" }, "Main/game.gam");
  await client.project(modern.snapshot(1));
  const uri = modern.uri("Prg/main.prg");
  const text = "if (x) {\nMWIN(hello)\n}\n";
  await client.open(uri, text);
  const before = client.messages.length;
  const edits = await client.connection.sendRequest<TextEdit[] | null>("textDocument/formatting", { textDocument: { uri }, options: { tabSize: 4, insertSpaces: true } });
  equal(TextDocument.applyEdits(TextDocument.create(uri, "rpgcode", 1, text), edits ?? []), "if (x) {\n    mwin(hello)\n}\n");
  equal(client.messages.length, before, "a formatted document shows no message");

  const legacy = memoryProject({ "Main/legacy.gam": mainFileBytes("tk2"), "Prg/talk.prg": "" }, "Main/legacy.gam", { rootUri: "file:///legacy/" });
  await client.project(legacy.snapshot(2));
  const talk = legacy.uri("Prg/talk.prg");
  await client.open(talk, "Mwin(hello)\n");
  deepEqual(await client.connection.sendRequest<TextEdit[] | null>("textDocument/formatting", { textDocument: { uri: talk }, options: OPTIONS }), []);
  // showMessage is a notification sent before the response, so it has arrived.
  equal(client.messages.length, before + 1);
  match(client.messages.at(-1)!.message, /tk2-dialect/);
});
