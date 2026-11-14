import * as vscode from "vscode";

/**
 * VS Code cannot export a package safely, so this command says so and writes nothing (owner ruling on #1719).
 *
 * The extension's only ways to put a file where the author chose are `workspace.fs.writeFile`, which replaces whatever is
 * there, and a stat-then-write check, which another window or process can beat between the check and the write. Neither
 * VS Code API nor its disk provider offers a no-replace create, and the chosen folder may be swapped for a link after it
 * was picked. A package is also read from the project folder through the same workspace filesystem, which cannot make a
 * directory walk immune to such a swap. Rather than weaken those checks, the export is unavailable here; the browser
 * editor offers the package and descriptor as reviewed downloads.
 */
export const PACKAGE_UNAVAILABLE_MESSAGE =
  "Packaging a game is not available in VS Code. VS Code cannot save the package and its install descriptor without a risk of replacing a file created after the check or following a folder swapped for a link, so nothing was read or written. Open the project in the RPG Toolkit browser editor and use Package game there to download the package and descriptor.";

/** Register the Explorer/command-palette entry that explains why packaging is not offered in VS Code. */
export function registerPackageGameCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand("tkr.packageGame", () => {
    void vscode.window.showInformationMessage(PACKAGE_UNAVAILABLE_MESSAGE);
  }));
}
