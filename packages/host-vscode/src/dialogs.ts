import * as vscode from "vscode";
import type { DialogQuestion, DialogService } from "@tk-reawakened/platform-services";

/**
 * `dialogs` for the project at `root`, through VS Code's own modal message and save dialog (AD-20). A modal message
 * shows its own Cancel button, which answers the question's `cancel`; a save destination outside `root` is refused and
 * answers `null`, because a document saves only inside its project (ADR 0022 D1.1).
 */
export function createVscodeDialogs(root: vscode.Uri): DialogService {
  return {
    async ask<Id extends string>(question: DialogQuestion<Id>): Promise<Id> {
      const offered = question.choices.filter((choice) => choice.id !== question.cancel);
      const picked = await vscode.window.showWarningMessage(question.message, { modal: true, detail: question.detail }, ...offered.map((choice) => choice.label));
      return offered.find((choice) => choice.label === picked)?.id ?? question.cancel;
    },
    async pickSavePath(request) {
      const chosen = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.joinPath(root, ...request.suggested.split("/")), saveLabel: "Save As" });
      if (chosen === undefined) return null;
      const prefix = `${root.path.replace(/\/$/, "")}/`;
      if (chosen.scheme !== root.scheme || chosen.authority !== root.authority || !chosen.path.startsWith(prefix)) {
        void vscode.window.showWarningMessage(`${request.document} can only be saved inside its project folder.`);
        return null;
      }
      return chosen.path.slice(prefix.length);
    },
  };
}
