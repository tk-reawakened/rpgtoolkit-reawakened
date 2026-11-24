import { commands, type ExtensionContext } from "vscode";

/**
 * The reviewed script workflows' one request (story 13.16, docs/spec/engine/rpgcode-tooling.md#tool-11). The editor
 * extension (or any other client) asks the running RPGCode language server for the result of one transform on one text;
 * the server answers with the proposal and never edits a document. A request is forwarded to the started client, so a
 * command that arrives before the server is running waits for it.
 */
export type ScriptTransformClient = {
  sendRequest(method: string, params: unknown): Promise<unknown>;
};

export const SCRIPT_TRANSFORM_COMMAND = "rpgcode.scriptTransform";

export function registerScriptTransform(context: ExtensionContext, started: () => Promise<ScriptTransformClient>): void {
  context.subscriptions.push(commands.registerCommand(SCRIPT_TRANSFORM_COMMAND, async (params: unknown) => {
    const client = await started();
    return await client.sendRequest("rpgcode/scriptTransform", params);
  }));
}
