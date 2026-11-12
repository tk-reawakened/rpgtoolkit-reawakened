import * as path from "node:path";
import { workspace, type ExtensionContext } from "vscode";
import { LanguageClient, State, TransportKind, type LanguageClientOptions, type ServerOptions } from "vscode-languageclient/node.js";
import { registerDebugAdapter } from "./debug.js";
import { registerMigrationPreview } from "./migrationPreview.js";
import { registerRunningProject } from "./project.js";
import { resolveServerModule } from "./serverPath.js";

let client: LanguageClient | undefined;

export function activate(context: ExtensionContext): void {
  const serverModule = resolveServerModule(context.extensionPath);
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.stdio },
    debug: { module: serverModule, transport: TransportKind.stdio },
  };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "rpgcode" }, { scheme: "untitled", language: "rpgcode" },
      { scheme: "file", language: "rpgcode-tk2" }, { scheme: "untitled", language: "rpgcode-tk2" },
    ],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher("**/*.{prg,rnc}"),
    },
  };
  client = new LanguageClient("rpgcode", "RPGCode Language Server", serverOptions, clientOptions);
  const started = client.start();
  // The running project reaches the server once it is up, and again after any restart
  // (docs/spec/engine/rpgcode-tooling.md#tool-1-project).
  const running = client;
  const project = registerRunningProject(context, {
    sendNotification: async (method, params) => {
      await started;
      await running.sendNotification(method, params);
    },
  });
  context.subscriptions.push(running.onDidChangeState((event) => {
    if (event.oldState === State.Starting && event.newState === State.Running) project.resend();
  }));
  registerMigrationPreview(context);
  registerDebugAdapter(context);
}

export async function deactivate(): Promise<void> {
  if (client) {
    await client.stop();
    client = undefined;
  }
}
