/**
 * A real LSP client over the shipped stdio binary (docs/spec/engine/rpgcode-tooling.md#tool-1):
 * the test spawns `bin/stdio.ts`, speaks JSON-RPC over its pipes and waits on
 * the notifications the server sends, never on a timer.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createMessageConnection, StreamMessageReader, StreamMessageWriter, type MessageConnection } from "vscode-jsonrpc/node.js";
import type { Diagnostic, InitializeResult, PublishDiagnosticsParams } from "vscode-languageserver-protocol";
import { PROJECT_NOTIFICATION, type ProjectSnapshot } from "../src/protocol.ts";

export type StdioClient = {
  readonly connection: MessageConnection;
  readonly initialized: InitializeResult;
  /** Messages the server showed with `window/showMessage`, in order. */
  readonly messages: { readonly type: number; readonly message: string }[];
  project(snapshot: ProjectSnapshot): Promise<void>;
  /** Open a document and resolve with the diagnostics the server publishes for that version. */
  open(uri: string, text: string, languageId?: string, version?: number): Promise<Diagnostic[]>;
  close(): Promise<void>;
};

export async function startStdio(): Promise<StdioClient> {
  const child = spawn(process.execPath, [fileURLToPath(new URL("../bin/stdio.ts", import.meta.url))], { stdio: ["pipe", "pipe", "inherit"] });
  const connection = createMessageConnection(new StreamMessageReader(child.stdout), new StreamMessageWriter(child.stdin));
  const waiters = new Map<string, { version: number; resolve: (diagnostics: Diagnostic[]) => void }>();
  const messages: { type: number; message: string }[] = [];
  connection.onNotification("textDocument/publishDiagnostics", (params: PublishDiagnosticsParams) => {
    const waiter = waiters.get(params.uri);
    if (waiter !== undefined && params.version === waiter.version) {
      waiters.delete(params.uri);
      waiter.resolve(params.diagnostics);
    }
  });
  connection.onNotification("window/showMessage", (params: { type: number; message: string }) => {
    messages.push(params);
  });
  connection.listen();
  const initialized = await connection.sendRequest<InitializeResult>("initialize", { processId: null, rootUri: null, capabilities: {} });
  await connection.sendNotification("initialized", {});
  return {
    connection,
    initialized,
    messages,
    project: (snapshot) => connection.sendNotification(PROJECT_NOTIFICATION, snapshot),
    open: (uri, text, languageId = "rpgcode", version = 1) => {
      const published = new Promise<Diagnostic[]>((resolve) => waiters.set(uri, { version, resolve }));
      void connection.sendNotification("textDocument/didOpen", { textDocument: { uri, languageId, version, text } });
      return published;
    },
    close: async () => {
      try {
        await connection.sendRequest("shutdown");
        await connection.sendNotification("exit");
      } finally {
        connection.dispose();
        child.kill();
      }
    },
  };
}
