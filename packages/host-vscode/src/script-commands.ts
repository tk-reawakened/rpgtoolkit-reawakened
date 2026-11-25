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
async function replaceDocument(document: vscode.TextDocument, label: string, text: string): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }> {
  const eol = document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), eol === "\n" ? text : text.replace(/\n/g, eol), { label, needsConfirmation: false });
  const applied = await vscode.workspace.applyEdit(edit);
  return applied ? { ok: true } : { ok: false, message: "VS Code refused the edit." };
}

/** The programs open in an editor inside `folder`, by their path inside it. */
function openPrograms(folder: vscode.Uri): { path: string; document: vscode.TextDocument }[] {
  const base = folder.path.replace(/\/?$/, "/");
  return vscode.workspace.textDocuments.flatMap((document) => {
    const uri = document.uri;
    if (uri.scheme !== folder.scheme || uri.authority !== folder.authority || !uri.path.startsWith(base) || !isProgramDocument(document)) return [];
    return [{ path: uri.path.slice(base.length), document }];
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

/** Whether the leading white space of any line differs; a diff setting that ignores white space would hide that too. */
function indentationDiffers(before: string, after: string): boolean {
  const leading = (text: string): string[] => text.split("\n").map((line) => /^[ \t]*/.exec(line)![0]);
  const a = leading(before);
  const b = leading(after);
  return a.length !== b.length || a.some((value, index) => value !== b[index]);
}

/** `text` with spaces and tabs made visible, but only when the change is white space alone and the diff would hide it. */
function whitespaceVisible(before: string, after: string, text: string): string {
  return whitespaceOnly(before, after) || indentationDiffers(before, after) ? text.replace(/ /g, "\u00b7").replace(/\t/g, "\u2192\t") : text;
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
  const title = whitespaceOnly(item.original, item.result) || indentationDiffers(item.original, item.result) ? `${item.path}: original ↔ result (spaces shown as ·, tabs as →)` : `${item.path}: original ↔ result`;
  await vscode.commands.executeCommand("vscode.diff", original, result, title);
}

/**
 * The one multi-select list: every program that would change starts ticked, so unticking is the per-file opt-out. Each
 * item has a **Show changes** button that opens the real diff editor; the item's detail is a short summary because a
 * pick list flattens white space and can never be the comparison itself.
 */
async function review(transform: ScriptTransformId, items: readonly ScriptReviewItem[], leftAsWritten: readonly string[]): Promise<readonly string[] | undefined> {
  if (leftAsWritten.length > 0) {
    const choice = await vscode.window.showInformationMessage("Some programs or fragments will be left as written.", {
      modal: true,
      detail: leftAsWritten.join("\n"),
    }, "Review proposed changes");
    if (choice !== "Review proposed changes") return undefined;
  }
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

async function askScope(transform: ScriptTransformId, activeProgram: string | null): Promise<"program" | "project" | undefined> {
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
}

function ui(): ScriptWorkflowUi {
  return {
    progress,
    review,
    report: async (summary, problems, failed, stage) => {
      if (failed && stage === "plan") await vscode.window.showWarningMessage(summary, { modal: true, detail: problems.join("\n") });
      else if (failed) void vscode.window.showWarningMessage(`${summary}\n${problems.join("\n")}`);
      else void vscode.window.showInformationMessage(summary);
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
      const extension = await activatedLanguageExtension();
      if (extension === undefined) {
        await vscode.window.showErrorMessage("The RPGCode language extension is not installed, so programs cannot be formatted or updated here. Nothing was changed.");
        return;
      }
      if ((vscode.workspace.workspaceFolders?.length ?? 0) === 0) {
        await vscode.window.showErrorMessage("Open a project folder first: the workflows read the project's programs.");
        return;
      }
      const active = vscode.window.activeTextEditor?.document;
      const activeFolder = active === undefined ? undefined : vscode.workspace.getWorkspaceFolder(active.uri);
      const activeLabel = activeFolder === undefined ? null : openPrograms(activeFolder.uri).find(({ document }) => document === active)?.path ?? null;
      const asked = await askScope(transform, activeLabel);
      if (asked === undefined) return;

      // The virtual filesystem may have loaded workspace settings while the scope picker was open.
      let folders = vscode.workspace.workspaceFolders ?? [];
      if (folders.length === 0) return;
      let main = configuredMain(folders[0]!.uri);
      let fallback = asked === "program" ? activeFolder : folders.length === 1 ? folders[0] : undefined;
      let pickedFolderUri: string | undefined;
      if (main === undefined && asked === "project" && fallback === undefined) {
        const picked = await pickFolder(folders);
        if (picked === undefined) return;
        pickedFolderUri = picked.uri.toString();
        folders = vscode.workspace.workspaceFolders ?? [];
        if (folders.length === 0) return;
        main = configuredMain(folders[0]!.uri);
        fallback = folders.find(({ uri }) => uri.toString() === pickedFolderUri);
      }
      const folder = main === undefined
        ? folders.find(({ uri }) => uri.toString() === fallback?.uri.toString())
        : vscode.workspace.getWorkspaceFolder(main);
      if (folder === undefined) {
        await vscode.window.showErrorMessage("The selected project folder is no longer open. Nothing was changed.");
        return;
      }
      const folderUri = folder.uri.toString();
      if (pickedFolderUri !== undefined && pickedFolderUri !== folderUri) {
        await vscode.window.showErrorMessage("The running project is in a different workspace folder than the one you chose. Start the review again. Nothing was changed.");
        return;
      }
      const root = projectRootIn(folder.uri, main);
      const activePath = asked === "program" ? openPrograms(folder.uri).find(({ document }) => document === active)?.path : undefined;
      if (asked === "program" && (activePath === undefined || (root !== "" && !activePath.startsWith(`${root}/`)))) {
        await vscode.window.showErrorMessage("That program is no longer open in the selected project. Nothing was changed.");
        return;
      }
      const services = createVscodeServices(folder.uri, context, generation);
      const workspace = workspaceFor(folder.uri);
      let retired = false;
      const removal = vscode.workspace.onDidChangeWorkspaceFolders(({ removed }) => {
        if (removed.some((candidate) => candidate.uri.toString() === folderUri)) retired = true;
      });
      await runScriptWorkflow(
        transform,
        activePath === undefined ? { kind: "project" } : { kind: "program", path: activePath },
        {
          fs: { ...services.fs, write: (path, bytes) => services.fs.writeProject(folderUri, path, bytes) },
          provider: {
            async transform(question) {
              const path = question.workspacePath ?? question.path;
              const opened = openPrograms(folder.uri).find((program) => program.path === path)?.document;
              return await vscode.commands.executeCommand(TRANSFORM_COMMAND, {
                transform: question.transform,
                textDocument: { uri: (opened?.uri ?? vscode.Uri.joinPath(folder.uri, ...path.split("/"))).toString(), ...(opened?.languageId === "rpgcode-tk2" ? { languageId: "rpgcode-tk2" } : {}) },
                text: question.text,
                indentWidth: question.indentWidth,
                ...(question.projectMainUri === undefined ? {} : { project: { main: question.projectMainUri } }),
              });
            },
          },
          history: createWizardHistory(workspace.checkpoints),
          // Resolved per call: a program opened while the review is open must be seen before it is written.
          openPrograms: (): readonly OpenScriptProgram[] => openPrograms(folder.uri).map((program) => ({
            path: program.path,
            text: () => lfText(program.document),
            replace: (label, text) => replaceDocument(program.document, label, text),
          })),
          root,
          ...(main === undefined ? {} : { projectMainUri: main.toString(), projectMainPath: main.path.slice(folder.uri.path.replace(/\/?$/, "/").length) }),
          isProjectCurrent: () => {
            const currentFolders = vscode.workspace.workspaceFolders;
            const first = currentFolders?.[0]?.uri;
            return !retired && first !== undefined
              && currentFolders?.some((candidate) => candidate.uri.toString() === folderUri) === true
              && configuredMain(first)?.toString() === main?.toString()
              && (main === undefined || vscode.workspace.getWorkspaceFolder(main)?.uri.toString() === folderUri);
          },
        },
        ui(),
      ).finally(() => removal.dispose());
    }));
  }
}

/** A relative setting is written against the first workspace folder, as in the RPGCode extension. */
function configuredMain(first: vscode.Uri): vscode.Uri | undefined {
  const configured = vscode.workspace.getConfiguration("rpgcode").get<string>("project", "").trim();
  if (configured === "") return undefined;
  return /^[A-Za-z][A-Za-z0-9+.-]+:/.test(configured) && !/^[A-Za-z]:[\\/]/.test(configured)
    ? vscode.Uri.parse(configured, true)
    : vscode.Uri.joinPath(first, ...configured.split(/[\\/]/).filter((part) => part !== ""));
}

/** The running project's root relative to the workspace folder. */
function projectRootIn(folder: vscode.Uri, main: vscode.Uri | undefined): string {
  if (main === undefined) return "";
  const base = folder.path.replace(/\/?$/, "/");
  // The same root the language server uses: the folder above `Main`, else the `.gam`'s own folder (TOOL-1).
  const mainPath = main.path.replace(/\/?$/, "/");
  const parent = mainPath.slice(0, mainPath.lastIndexOf("/", mainPath.length - 2) + 1);
  const above = parent.slice(0, -1);
  const rootPath = above.slice(above.lastIndexOf("/") + 1).toLowerCase() === "main" ? above.slice(0, above.lastIndexOf("/") + 1) : parent;
  const root = rootPath.replace(/\/?$/, "/");
  // The filesystem service expects relative paths without a trailing separator.
  // `Uri.path` is already decoded, so a folder named `Game 100%` must not be decoded a second time.
  return root.startsWith(base) ? root.slice(base.length).replace(/\/$/, "") : "";
}

async function pickFolder(folders: readonly vscode.WorkspaceFolder[]): Promise<vscode.WorkspaceFolder | undefined> {
  const chosen = await vscode.window.showQuickPick(folders.map((folder) => ({ label: folder.name, folder })), { title: "Script workflow: project", ignoreFocusOut: true });
  return chosen?.folder;
}
