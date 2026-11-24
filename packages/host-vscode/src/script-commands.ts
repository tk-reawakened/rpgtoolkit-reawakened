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

/**
 * The RPGCode language extension, activated. A fresh window has not activated it, so its command would not exist yet;
 * `executeCommand` on an unregistered command fails, and the workflow would report every file as unreadable.
 */
async function activatedLanguageExtension(): Promise<vscode.Extension<unknown> | undefined> {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  if (extension === undefined) return undefined;
  if (!extension.isActive) await extension.activate();
  return extension;
}

/**
 * One progress indicator for the workflow: VS Code's own, so planning a large project never looks frozen. A dismissed
 * indicator does not cancel the run; the review question afterwards is the place to stop.
 */
function progress(message: string): () => void {
  const handle = vscode.window.setStatusBarMessage(`$(sync~spin) ${message}`);
  return () => handle.dispose();
}

const DIFF_SCHEME = "tkr-script-diff";
let diffSequence = 0;

/** The two sides of every open comparison, by URI, so the diff editor reads exactly what the review showed. */
const diffSides = new Map<string, string>();

/** Register the read-only documents the diff editor shows; nothing is written and nothing is kept after a review ends. */
function registerDiffDocuments(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, {
    provideTextDocumentContent(uri) {
      return diffSides.get(uri.toString()) ?? "";
    },
  }));
}

/** Whether two texts differ only in white space, which VS Code's diff hides unless its setting says otherwise. */
function whitespaceOnly(before: string, after: string): boolean {
  return before !== after && before.replace(/[ \t]+/g, "") === after.replace(/[ \t]+/g, "");
}

/** `text` with spaces and tabs made visible, but only when the change is white space alone and the diff would hide it. */
function whitespaceVisible(before: string, after: string, text: string): string {
  return whitespaceOnly(before, after) ? text.replace(/ /g, "\u00b7").replace(/\t/g, "\u2192\t") : text;
}

/** Open VS Code's own diff editor for one program: the planned original on the left, the result on the right. */
async function showDiff(item: ScriptReviewItem): Promise<void> {
  if (item.original === null || item.result === null) {
    await vscode.window.showInformationMessage(`${item.path} was not changed, so there is nothing to compare.`);
    return;
  }
  // A fresh identity for every comparison: reusing one would let an editor show an older review's content.
  const nonce = `${Date.now().toString(36)}-${++diffSequence}`;
  const original = vscode.Uri.parse(`${DIFF_SCHEME}:${encodeURIComponent(item.path)}?side=original&review=${nonce}`, true);
  const result = vscode.Uri.parse(`${DIFF_SCHEME}:${encodeURIComponent(item.path)}?side=result&review=${nonce}`, true);
  diffSides.set(original.toString(), whitespaceVisible(item.original, item.result, item.original));
  diffSides.set(result.toString(), whitespaceVisible(item.original, item.result, item.result));
  const title = whitespaceOnly(item.original, item.result) ? `${item.path}: original ↔ result (spaces shown as ·, tabs as →)` : `${item.path}: original ↔ result`;
  await vscode.commands.executeCommand("vscode.diff", original, result, title);
}

/**
 * The one multi-select list: every program that would change starts ticked, so unticking is the per-file opt-out. Each
 * item has a **Show changes** button that opens the real diff editor; the item's detail is a short summary because a
 * pick list flattens white space and can never be the comparison itself.
 */
async function review(transform: ScriptTransformId, items: readonly ScriptReviewItem[]): Promise<readonly string[] | undefined> {
  const quick = vscode.window.createQuickPick<vscode.QuickPickItem & { readonly file: ScriptReviewItem }>();
  const show = { iconPath: new vscode.ThemeIcon("diff"), tooltip: "Show changes" };
  quick.title = `${SCRIPT_TRANSFORM_INFO[transform].name}: review the changes`;
  quick.placeholder = "Every ticked program is applied. Untick any you want left alone, then press Enter. Escape changes nothing.";
  quick.canSelectMany = true;
  quick.ignoreFocusOut = true;
  quick.matchOnDetail = true;
  quick.items = items.map((item) => ({
    label: item.path,
    description: item.description,
    detail: item.detail,
    buttons: item.original === null || item.result === null ? [] : [show],
    file: item,
  }));
  quick.selectedItems = [...quick.items];
  const picked = await new Promise<readonly ScriptReviewItem[] | undefined>((resolve) => {
    const done = quick.onDidAccept(() => { resolve(quick.selectedItems.map((item) => item.file)); });
    // Dismissing the list is a cancel: nothing is written.
    quick.onDidHide(() => { done.dispose(); resolve(undefined); });
    quick.onDidTriggerItemButton(async (event) => { await showDiff(event.item.file); });
    quick.show();
  });
  quick.dispose();
  diffSides.clear();
  return picked?.map((item) => item.path);
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
    retry: async (problems) => (await vscode.window.showWarningMessage(
      `Some programs were not written: ${problems.length}. Try them again?`,
      { modal: false },
      "Try again",
    )) === "Try again",
  };
}

/** Register the four reviewed workflows as commands; each asks its questions and writes nothing until the review is accepted. */
export function registerScriptWorkflowCommands(context: vscode.ExtensionContext, generation: () => number, workspaceFor: (uri: vscode.Uri) => DocumentWorkspace): void {
  registerDiffDocuments(context);
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
      const extension = await activatedLanguageExtension();
      const active = vscode.window.activeTextEditor?.document;
      const activePath = active === undefined ? null : open.find((program) => program.document === active)?.path ?? null;
      const uris = new Map(open.map((program) => [program.path, program.document]));
      const tk2Documents = new Set(open.filter((program) => program.document.languageId === "rpgcode-tk2").map((program) => program.path));
      const uriOf = (path: string): string => uris.get(path)?.uri.toString() ?? vscode.Uri.joinPath(folder.uri, ...path.split("/")).toString();
      await runScriptWorkflow(
        transform,
        {
          fs: services.fs,
          provider: extension === undefined
            ? null
            : {
              async transform(question) {
                return await vscode.commands.executeCommand(TRANSFORM_COMMAND, {
                  transform: question.transform,
                  textDocument: { uri: uriOf(question.workspacePath ?? question.path), ...(tk2Documents.has(question.path) ? { languageId: "rpgcode-tk2" } : {}) },
                  text: question.text,
                  indentWidth: question.indentWidth,
                  ...(question.awaitProject === true ? { awaitProject: true } : {}),
                });
              },
            },
          ...(extension === undefined ? { unavailableReason: "The RPGCode language extension is not installed, so programs cannot be formatted or updated here. Nothing was changed." } : {}),
          history: createWizardHistory(workspace.checkpoints),
          openPrograms: open.map((program): OpenScriptProgram => ({
            path: program.path,
            text: () => lfText(program.document),
            replace: (_label, text) => replaceDocument(program.document, text),
          })),
          root: projectRootIn(folder.uri),
          activeProgram: activePath,
          projectSelected: vscode.workspace.getConfiguration("rpgcode").get<string>("project", "").trim() !== "",
        },
        ui(),
      );
    }));
  }
}

/**
 * Where the project's programs are, relative to the workspace folder: the running project's root, from the selected
 * `.gam` (TOOL-1 "Root"), or the folder itself when no project is selected. The server assesses only that root, so a
 * scan of the whole folder would list files it must refuse.
 */
function projectRootIn(folder: vscode.Uri): string {
  const configured = vscode.workspace.getConfiguration("rpgcode").get<string>("project", "").trim();
  if (configured === "") return "";
  // A relative setting is written against the first workspace folder, which is how the RPGCode extension reads it.
  const first = vscode.workspace.workspaceFolders?.[0]?.uri ?? folder;
  const main = /^[A-Za-z][A-Za-z0-9+.-]+:/.test(configured) && !/^[A-Za-z]:[\\/]/.test(configured)
    ? vscode.Uri.parse(configured, true)
    : vscode.Uri.joinPath(first, ...configured.split(/[\\/]/).filter((part) => part !== ""));
  const base = folder.path.replace(/\/?$/, "/");
  // The same root the language server uses: the folder above `Main`, else the `.gam`'s own folder (TOOL-1).
  const mainPath = main.path.replace(/\/?$/, "/");
  const parent = mainPath.slice(0, mainPath.lastIndexOf("/", mainPath.length - 2) + 1);
  const above = parent.slice(0, -1);
  const rootPath = above.slice(above.lastIndexOf("/") + 1).toLowerCase() === "main" ? above.slice(0, above.lastIndexOf("/") + 1) : parent;
  const root = rootPath.replace(/\/?$/, "/");
  // `fs` paths have no trailing separator: "Game/", never "Game/" with the slash left on.
  return root.startsWith(base) ? decodeURIComponent(root.slice(base.length)).replace(/\/$/, "") : "";
}

async function pickFolder(folders: readonly vscode.WorkspaceFolder[]): Promise<vscode.WorkspaceFolder | undefined> {
  const chosen = await vscode.window.showQuickPick(folders.map((folder) => ({ label: folder.name, folder })), { title: "Script workflow: project", ignoreFocusOut: true });
  return chosen?.folder;
}
