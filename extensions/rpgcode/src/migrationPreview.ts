import { commands, window, workspace, type ExtensionContext } from "vscode";

/** Show a proposed 3.1 conversion without changing the original project. */
export function registerMigrationPreview(context: ExtensionContext): void {
  context.subscriptions.push(commands.registerCommand("rpgcode.previewTk2Conversion", async (text: unknown) => {
    if (typeof text !== "string") throw new TypeError("Toolkit 2.x preview needs source text");
    const preview = await workspace.openTextDocument({ content: text, language: "rpgcode" });
    await window.showTextDocument(preview);
    void window.showWarningMessage("This unsaved 3.1 preview does not migrate the Toolkit 2.x project. Use it only in a separately migrated 3.1 project.");
  }));
}
