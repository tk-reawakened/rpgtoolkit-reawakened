import * as vscode from "vscode";
import { runNewFont } from "./new-font.ts";
import { createVscodeServices } from "./services.ts";

/** What a script or keybinding may pass to `tkr.newFont` to skip the question: the font's project path. */
interface NewFontArguments {
  readonly path?: string;
}

/**
 * The new-font command (T-65): a bitmap font is made in a project's `Font` folder, all 256 glyphs empty, and opened in its
 * editor. The model decides what is valid and writes the file; the command only asks the path and opens the result.
 */
export function registerFontCommands(context: vscode.ExtensionContext, generation: () => number): void {
  const newFont = async (args?: NewFontArguments): Promise<void> => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      void vscode.window.showErrorMessage("Open a project folder first: a new font is made in the project's Font folder.");
      return;
    }
    const folder = folders.length === 1 ? folders[0]! : (await vscode.window.showQuickPick(folders.map((item) => ({ label: item.name, item })), { title: "New font: project", ignoreFocusOut: true }))?.item;
    if (folder === undefined) return;
    const services = createVscodeServices(folder.uri, context, generation);
    // The suggestion is where the game's own fonts live, so a `Main/` + `Game/<project>/` game gets the right path; a
    // project with several games asks which one (the open game first, when a main file is the active editor).
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    const active = tab instanceof vscode.TabInputCustom ? tab.uri : vscode.window.activeTextEditor?.document.uri;
    const activeGame = active !== undefined && /\.gam$/i.test(active.path)
      && vscode.workspace.getWorkspaceFolder(active)?.uri.toString() === folder.uri.toString()
      ? vscode.workspace.asRelativePath(active, false)
      : undefined;
    const outcome = await runNewFont({
      fs: services.fs,
      projectId: folder.uri.toString(),
      ...(activeGame === undefined ? {} : { activeGame }),
      ui: {
        input: (question) => args?.path !== undefined && question.title === "New font" ? Promise.resolve(args.path) : Promise.resolve(vscode.window.showInputBox({
          title: question.title,
          prompt: question.prompt,
          value: question.value,
          ignoreFocusOut: true,
          validateInput: (value) => question.validate(value) ?? undefined,
        })),
      },
    });
    if (!outcome.ok) {
      if (outcome.reason === "refused") void vscode.window.showErrorMessage(outcome.message);
      return;
    }
    await vscode.commands.executeCommand("vscode.open", vscode.Uri.joinPath(folder.uri, ...outcome.path.split("/")));
  };
  context.subscriptions.push(vscode.commands.registerCommand("tkr.newFont", (args?: NewFontArguments) => newFont(args)));
}
