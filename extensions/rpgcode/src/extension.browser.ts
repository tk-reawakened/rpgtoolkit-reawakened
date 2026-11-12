import { Uri, type ExtensionContext } from "vscode";
import { LanguageClient, State, type LanguageClientOptions } from "vscode-languageclient/browser.js";
import { registerDebugAdapter } from "./debug.js";
import { registerMigrationPreview } from "./migrationPreview.js";
import { registerRunningProject } from "./project.js";

let client: LanguageClient | undefined;

export function activate(context: ExtensionContext): void {
  const serverMain = Uri.joinPath(context.extensionUri, "dist", "server.worker.js");
  const worker = new Worker(serverMain.toString(true));
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ language: "rpgcode" }, { language: "rpgcode-tk2" }],
  };
  client = new LanguageClient("rpgcode", "RPGCode Language Server", clientOptions, worker);
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
