import { Uri, type ExtensionContext } from "vscode";
import { LanguageClient, type LanguageClientOptions } from "vscode-languageclient/browser.js";
import { registerDebugAdapter } from "./debug.js";
import { registerMigrationPreview } from "./migrationPreview.js";

let client: LanguageClient | undefined;

export function activate(context: ExtensionContext): void {
  const serverMain = Uri.joinPath(context.extensionUri, "dist", "server.worker.js");
  const worker = new Worker(serverMain.toString(true));
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ language: "rpgcode" }, { language: "rpgcode-tk2" }],
  };
  client = new LanguageClient("rpgcode", "RPGCode Language Server", clientOptions, worker);
  void client.start();
  registerMigrationPreview(context);
  registerDebugAdapter(context);
}

export async function deactivate(): Promise<void> {
  if (client) {
    await client.stop();
    client = undefined;
  }
}
