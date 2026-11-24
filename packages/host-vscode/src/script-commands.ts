import * as vscode from "vscode";
import { createWizardHistory, SCRIPT_TRANSFORM_INFO, type DocumentWorkspace, type OpenScriptProgram, type ScriptTransformId } from "@tk-reawakened/editor-model";
import { createVscodeServices } from "./services.ts";
import { runScriptWorkflow, type ScriptReviewItem, type ScriptWorkflowUi } from "./script-workflow.ts";

/**
 * VS Code's commands for the reviewed script workflows (story 13.16, T-42, T-43, T-44, T-46;
 * docs/spec/engine/rpgcode-tooling.md#tool-11). VS Code asks with its own pick lists, and its native Format Document
 * stays as it is: this route is the reviewed, project-wide one, and the one that shows what would change first.
 */

const EXTENSION_ID = "tk-reawakened.rpgcode-language";
const TRANSFORM_COMMAND = "rpgcode.scriptTransform";

/** The language mode of a document the workflows treat as a program. */
function isProgramDocument(document: vscode.TextDocument): boolean {
  return document.languageId === "rpgcode" || document.languageId === "rpgcode-tk2" || /\.(prg|rnc)$/i.test(document.uri.path);
}

/** The text with `LF` breaks, which is the one form the model and the server use. */
function lfText(document: vscode.TextDocument): string {
  return document.getText().replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** Put `text` into a document in its own line endings, as one undoable edit, without saving it. */
async function replaceDocument(document: vscode.TextDocument, text: string): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }> {
  const eol = document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), eol === "\n" ? text : text.replace(/\n/g, eol));
  const applied = await vscode.workspace.applyEdit(edit);
  return applied ? { ok: true } : { ok: false, message: "VS Code refused the edit." };
}

/** The programs open in an editor inside `folder`, by their path inside it. */
function openPrograms(folder: vscode.Uri): { path: string; document: vscode.TextDocument }[] {
  const base = folder.toString().replace(/\/?$/, "/");
  return vscode.workspace.textDocuments.flatMap((document) => {
    if (document.uri.scheme !== "file" || !isProgramDocument(document) || !document.uri.toString().startsWith(base)) return [];
    return [{ path: decodeURIComponent(document.uri.toString().slice(base.length)), document }];
  });
}

/** Whether the RPGCode language extension is installed and running, so the workflow can reach the server. */
function languageExtensionPresent(): boolean {
  return vscode.extensions.getExtension(EXTENSION_ID) !== undefined;
}

/**
 * One progress indicator for the workflow: VS Code's own, so planning a large project never looks frozen. A dismissed
 * indicator does not cancel the run; the review question afterwards is the place to stop.
 */
function progress(message: string): () => void {
  const handle = vscode.window.setStatusBarMessage(`$(sync~spin) ${message}`);
  return () => handle.dispose();
}

/** The one multi-select list: every program that would change starts ticked, so unticking is the per-file opt-out. */
async function review(transform: ScriptTransformId, items: readonly ScriptReviewItem[]): Promise<readonly string[] | undefined> {
  const chosen = await vscode.window.showQuickPick(
    items.map((item) => ({ label: item.path, description: item.description, detail: item.detail, picked: true, path: item.path })),
    {
      title: `${SCRIPT_TRANSFORM_INFO[transform].name}: review the changes`,
      placeHolder: "Every ticked program is applied. Untick any you want left alone, then press Enter. Escape changes nothing.",
      canPickMany: true,
      ignoreFocusOut: true,
      matchOnDetail: true,
    },
  );
  return chosen?.map((item) => item.path);
}

function ui(): ScriptWorkflowUi {
  return {
    scope: async (transform, activeProgram) => {
      const items = [
        ...(activeProgram === null ? [] : [{ label: activeProgram, description: "the program in the editor", id: "program" as const }]),
        { label: "Every program in the project", description: "checks every .prg and .rnc below the project root", id: "project" as const },
      ];
      const picked = await vscode.window.showQuickPick(items, {
        title: `${SCRIPT_TRANSFORM_INFO[transform].name}: which programs?`,
        placeHolder: SCRIPT_TRANSFORM_INFO[transform].plain,
        ignoreFocusOut: true,
      });
      return picked?.id;
    },
    progress,
    review,
    report: async (summary, problems, failed) => {
      const said = problems.length === 0 ? summary : `${summary}\n${problems.join("\n")}`;
      if (failed) await vscode.window.showWarningMessage(said, { modal: false });
      else await vscode.window.showInformationMessage(said, { modal: false });
    },
    tellUnavailable: async (message) => { await vscode.window.showWarningMessage(message); },
  };
}

/** Register the four reviewed workflows as commands; each asks its questions and writes nothing until the review is accepted. */
export function registerScriptWorkflowCommands(context: vscode.ExtensionContext, generation: () => number, workspaceFor: (uri: vscode.Uri) => DocumentWorkspace): void {
  const ids: Readonly<Record<ScriptTransformId, string>> = {
    format: "tkr.scriptFormat",
    "canonical-case": "tkr.scriptCanonicalCase",
    update: "tkr.scriptUpdate",
    cleanup: "tkr.scriptCleanup",
  };
  for (const transform of Object.keys(ids) as ScriptTransformId[]) {
    context.subscriptions.push(vscode.commands.registerCommand(ids[transform], async () => {
      const folders = vscode.workspace.workspaceFolders ?? [];
      if (folders.length === 0) {
        await vscode.window.showErrorMessage("Open a project folder first: the workflows read the project's programs.");
        return;
      }
      const folder = folders.length === 1 ? folders[0]! : await pickFolder(folders);
      if (folder === undefined) return;
      const services = createVscodeServices(folder.uri, context, generation);
      const workspace = workspaceFor(folder.uri);
      const open = openPrograms(folder.uri);
      const active = vscode.window.activeTextEditor?.document;
      const activePath = active === undefined ? null : open.find((program) => program.document === active)?.path ?? null;
      const uris = new Map(open.map((program) => [program.path, program.document.uri]));
      const uriOf = (path: string): string => uris.get(path)?.toString() ?? vscode.Uri.joinPath(folder.uri, ...path.split("/")).toString();
      await runScriptWorkflow(
        transform,
        {
          fs: services.fs,
          provider: languageExtensionPresent()
            ? {
              async transform(question) {
                return await vscode.commands.executeCommand(TRANSFORM_COMMAND, {
                  transform: question.transform,
                  textDocument: { uri: uriOf(question.path) },
                  text: question.text,
                  indentWidth: question.indentWidth,
                });
              },
            }
            : null,
          ...(languageExtensionPresent() ? {} : { unavailableReason: "The RPGCode language extension is not installed, so programs cannot be formatted or updated here. Nothing was changed." }),
          history: createWizardHistory(workspace.checkpoints),
          openPrograms: open.map((program): OpenScriptProgram => ({
            path: program.path,
            text: () => lfText(program.document),
            replace: (_label, text) => replaceDocument(program.document, text),
          })),
          root: "",
          activeProgram: activePath,
        },
        ui(),
      );
    }));
  }
}

async function pickFolder(folders: readonly vscode.WorkspaceFolder[]): Promise<vscode.WorkspaceFolder | undefined> {
  const chosen = await vscode.window.showQuickPick(folders.map((folder) => ({ label: folder.name, folder })), { title: "Script workflow: project", ignoreFocusOut: true });
  return chosen?.folder;
}
