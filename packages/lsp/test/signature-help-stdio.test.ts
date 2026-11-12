import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from "vscode-jsonrpc/node.js";
import type { InitializeResult, SignatureHelp } from "vscode-languageserver-protocol";

test("stdio LSP serves signature help for an unfinished document", { timeout: 15_000 }, async () => {
  const child = spawn(process.execPath, [fileURLToPath(new URL("../bin/stdio.ts", import.meta.url))], { stdio: ["pipe", "pipe", "pipe"] });
  const connection = createMessageConnection(new StreamMessageReader(child.stdout), new StreamMessageWriter(child.stdin));
  connection.listen();
  try {
    const initialized = await connection.sendRequest<InitializeResult>("initialize", { processId: null, rootUri: null, capabilities: {} });
    assert.deepEqual(initialized.capabilities.signatureHelpProvider?.triggerCharacters, ["(", ","]);
    await connection.sendNotification("initialized", {});
    const uri = "file:///signature-help.prg";
    const text = "threadSleep(1, ";
    await connection.sendNotification("textDocument/didOpen", { textDocument: { uri, languageId: "rpgcode", version: 1, text } });
    const result = await connection.sendRequest<SignatureHelp | null>("textDocument/signatureHelp", {
      textDocument: { uri }, position: { line: 0, character: text.length },
    });
    assert.ok(result);
    assert.match(result.signatures[0]!.label, /^threadsleep\(/);
    assert.equal(result.activeParameter, 1);
    await connection.sendRequest("shutdown");
    await connection.sendNotification("exit");
  } finally {
    connection.dispose();
    child.kill();
  }
});
