import * as vscode from "vscode";
import {
  commandInsertion,
  commandReference,
  DEFAULT_HEADER_TEMPLATE,
  insertHeaderCommand,
  MAX_HEADER_TEMPLATE_LENGTH,
  type CommandReferenceEntry,
} from "@tk-reawakened/editor-model";
import { createVscodeServices } from "./services.ts";
import { runNewProgram } from "./new-program.ts";

/**
 * The program-editing commands of story 11.7 (T-40, docs/spec/engine/rpgcode-tooling.md#tool-10). VS Code edits a program in
 * its own text editor, so these only add what that editor lacks: a new program that starts with the author's header, the
 * header and a built-in command inserted into the open program, and the distraction-free view. They read the shared
 * preferences and the shared command catalogue, never the language server, so they work when it is absent.
 */

function isProgram(document: vscode.TextDocument): boolean {
  return document.languageId === "rpgcode" || document.languageId === "rpgcode-tk2" || document.uri.path.toLowerCase().endsWith(".prg");
}

function activeProgram(): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  return editor !== undefined && isProgram(editor.document) ? editor : undefined;
}

/** The header template in force for `uri`: the author's setting, or the default when the setting is empty of text or too long. */
export function headerTemplateFor(uri: vscode.Uri): string {
  const configured = vscode.workspace.getConfiguration("rpgToolkit", uri).get<string>("program.headerTemplate", DEFAULT_HEADER_TEMPLATE);
  return typeof configured === "string" && configured.length <= MAX_HEADER_TEMPLATE_LENGTH ? configured : DEFAULT_HEADER_TEMPLATE;
}

/** The text of the document's path inside its workspace folder, with `/` separators. */
function projectPath(uri: vscode.Uri): string {
  return vscode.workspace.asRelativePath(uri, false).replace(/\\/g, "/");
}

async function insertHeader(): Promise<void> {
  const editor = activeProgram();
  if (editor === undefined) {
    await vscode.window.showInformationMessage("Open a program first: the header goes at the start of the open RPGCode file.");
    return;
  }
  const command = insertHeaderCommand(headerTemplateFor(editor.document.uri), projectPath(editor.document.uri));
  if (command === null) {
    await vscode.window.showInformationMessage("The header template is empty, so there is nothing to insert. Change rpgToolkit.program.headerTemplate in the settings.");
    return;
  }
  // The template has `LF` breaks; VS Code writes the document's own ending when it saves.
  await editor.edit((builder) => builder.insert(new vscode.Position(0, 0), command.edits[0]!.text));
}

interface ReferenceItem extends vscode.QuickPickItem {
  readonly entry: CommandReferenceEntry;
}

/** What a script or keybinding may pass to `tkr.insertProgramCommand` to skip the picker: the command's name. */
interface InsertArguments {
  readonly name?: string;
}

async function insertCommand(entries: readonly CommandReferenceEntry[], args?: InsertArguments): Promise<void> {
  const editor = activeProgram();
  if (editor === undefined) {
    await vscode.window.showInformationMessage("Open a program first: the command is inserted at the cursor of the open RPGCode file.");
    return;
  }
  let chosen: CommandReferenceEntry | undefined;
  if (args?.name !== undefined) {
    chosen = entries.find((entry) => entry.name.toLowerCase() === args.name!.toLowerCase());
    if (chosen === undefined) {
      await vscode.window.showErrorMessage(`There is no RPGCode command named ${args.name}.`);
      return;
    }
  } else {
    const items: ReferenceItem[] = entries.map((entry) => ({
      label: entry.syntax,
      description: entry.aliasOf === null ? (entry.summary ?? "") : `another spelling of ${entry.aliasOf}`,
      entry,
    }));
    chosen = (await vscode.window.showQuickPick(items, { title: "Insert an RPGCode command", placeHolder: "Type to find a command by name, syntax or description", matchOnDescription: true }))?.entry;
    if (chosen === undefined) return;
  }
  const insertion = commandInsertion(chosen);
  const selections = editor.selections;
  await editor.edit((builder) => {
    for (const selection of selections) builder.replace(selection, insertion.text);
  });
  // Select the parameter text of each insertion so the author overtypes it (docs/spec/engine/rpgcode-tooling.md#tool-10).
  editor.selections = selections.map((selection) => {
    const start = selection.start;
    return new vscode.Selection(start.translate(0, insertion.select.from), start.translate(0, insertion.select.to));
  });
}

/** What a script or keybinding may pass to `tkr.newProgram` to skip the question: the program's project path. */
interface NewProgramArguments {
  readonly path?: string;
}

async function newProgram(context: vscode.ExtensionContext, generation: () => number, args?: NewProgramArguments): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    await vscode.window.showErrorMessage("Open a project folder first: a new program is made in the project's Prg folder.");
    return;
  }
  const folder = folders.length === 1 ? folders[0]! : (await vscode.window.showQuickPick(folders.map((item) => ({ label: item.name, item })), { title: "New program: project", ignoreFocusOut: true }))?.item;
  if (folder === undefined) return;
  const services = createVscodeServices(folder.uri, context, generation);
  const outcome = await runNewProgram({
    fs: services.fs,
    layout: { projectFolder: "" },
    settings: services.settings,
    ui: {
      input: (question) => args?.path !== undefined ? Promise.resolve(args.path) : Promise.resolve(vscode.window.showInputBox({
        title: question.title,
        prompt: question.prompt,
        value: question.value,
        ignoreFocusOut: true,
        validateInput: (value) => question.validate(value) ?? undefined,
      })),
    },
  });
  if (!outcome.ok) {
    if (outcome.reason === "refused") await vscode.window.showErrorMessage(outcome.message);
    return;
  }
  await vscode.commands.executeCommand("vscode.open", vscode.Uri.joinPath(folder.uri, ...outcome.path.split("/")));
}

/** Register the four program commands. `generation` is the document-change counter the run commands compare across a save. */
export function registerProgramCommands(context: vscode.ExtensionContext, generation: () => number): void {
  const entries = commandReference();
  context.subscriptions.push(
    vscode.commands.registerCommand("tkr.newProgram", (args?: NewProgramArguments) => newProgram(context, generation, args)),
    vscode.commands.registerCommand("tkr.insertProgramHeader", insertHeader),
    vscode.commands.registerCommand("tkr.insertProgramCommand", (args?: InsertArguments) => insertCommand(entries, args)),
    // VS Code's Zen mode is the distraction-free view: it hides the panels and bars and leaves the text.
    vscode.commands.registerCommand("tkr.distractionFree", () => vscode.commands.executeCommand("workbench.action.toggleZenMode")),
  );
}
