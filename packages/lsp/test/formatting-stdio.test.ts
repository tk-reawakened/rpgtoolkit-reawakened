import { deepEqual, notEqual, ok } from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createMessageConnection, ResponseError, StreamMessageReader, StreamMessageWriter, type MessageConnection } from "vscode-jsonrpc/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { InitializeResult, TextEdit } from "vscode-languageserver-protocol";

function stdio() {
  const child = spawn(process.execPath, [fileURLToPath(new URL("../bin/stdio.ts", import.meta.url))], { stdio: ["pipe", "pipe", "pipe"] });
  const connection = createMessageConnection(new StreamMessageReader(child.stdout), new StreamMessageWriter(child.stdin));
  connection.listen();
  return { connection, dispose: () => { connection.dispose(); child.kill(); } };
}

async function initialize(connection: MessageConnection): Promise<InitializeResult> {
  const result = await connection.sendRequest<InitializeResult>("initialize", { processId: null, rootUri: null, capabilities: {} });
  await connection.sendNotification("initialized", {});
  return result;
}

test("stdio advertises the document formatting provider", { timeout: 15_000 }, async () => {
  const server = stdio();
  try {
    const result = await initialize(server.connection);
    ok(result.capabilities.documentFormattingProvider, "the LSP must advertise document formatting");
  } finally {
    server.dispose();
  }
});

for (const languageId of ["rpgcode", "rpgcode-tk2"]) {
  test(`stdio never rewrites unassessed dialogue in ${languageId}`, { timeout: 15_000 }, async () => {
    const server = stdio();
    try {
      const result = await initialize(server.connection);
      ok(result.capabilities.documentFormattingProvider, "the refusal must come from a real formatting provider");
      const uri = "file:///Prg/unknown-project.prg";
      const text = "Mwin(hello)\n";
      const document = TextDocument.create(uri, languageId, 1, text);
      await server.connection.sendNotification("textDocument/didOpen", { textDocument: { uri, languageId, version: 1, text } });
      try {
        const edits = await server.connection.sendRequest<TextEdit[] | null>("textDocument/formatting", {
          textDocument: { uri }, options: { tabSize: 2, insertSpaces: true },
        });
        deepEqual(TextDocument.applyEdits(document, edits ?? []), text, "unknown project dialect cannot authorize a rewrite");
      } catch (error) {
        if (!(error instanceof ResponseError)) throw error;
        // A protocol-level refusal may use the eventual approved project-context contract.
        // Missing method and internal failure are not evidence of a safe refusal.
        notEqual(error.code, -32601, "formatting must be implemented");
        notEqual(error.code, -32603, "an internal error is not a deliberate refusal");
      }
    } finally {
      server.dispose();
    }
  });
}
