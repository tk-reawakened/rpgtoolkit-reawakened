import * as vscode from "vscode";

/** Apply one UTF-16 range edit, retaining the surrounding text and VS Code's native undo. */
export async function applyNativeTextEdit(document: vscode.TextDocument, before: string, after: string): Promise<"unchanged" | "applied" | "refused"> {
  if (before === after) return "unchanged";
  let start = 0;
  const limit = Math.min(before.length, after.length);
  while (start < limit && before.charCodeAt(start) === after.charCodeAt(start)) start += 1;
  let oldEnd = before.length;
  let newEnd = after.length;
  while (oldEnd > start && newEnd > start && before.charCodeAt(oldEnd - 1) === after.charCodeAt(newEnd - 1)) {
    oldEnd -= 1;
    newEnd -= 1;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(document.positionAt(start), document.positionAt(oldEnd)), after.slice(start, newEnd));
  return await vscode.workspace.applyEdit(edit) ? "applied" : "refused";
}
