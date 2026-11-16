import * as vscode from "vscode";
import { animationDestination, createAnimationFile, createCheckpointGroups, type CheckpointEnvironment } from "@tk-reawakened/editor-model";
import { createVscodeServices } from "./services.ts";

export function registerAnimationCommands(context: vscode.ExtensionContext, generation: () => number): void {
  const environment = async (): Promise<{ env: CheckpointEnvironment; root: vscode.Uri } | null> => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const folder = folders.length === 1 ? folders[0] : await vscode.window.showWorkspaceFolderPick();
    if (folder === undefined) { await vscode.window.showErrorMessage("Open a project folder first."); return null; }
    const services = createVscodeServices(folder.uri, context, generation);
    const env: CheckpointEnvironment = {
      fs: services.fs, projectId: folder.uri.toString(),
      hash: async (bytes) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice().buffer))].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
      newId: () => crypto.randomUUID(), time: () => new Date().toISOString(),
      guard: async (path) => {
        const uri = vscode.Uri.joinPath(folder.uri, ...path.split("/")).toString();
        const open = vscode.window.tabGroups.all.some((group) => group.tabs.some((tab) => {
          const input = tab.input;
          return (input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText) && input.uri.toString().toLowerCase() === uri.toLowerCase();
        }));
        return open ? `Save or resolve your work and close ${path} before replacing or removing it.` : null;
      },
      consent: async (paths) => await services.dialogs.ask({ message: "Replace these files?", detail: `${paths.join(", ")}. Original contents remain in project recovery history.`, choices: [{ id: "replace", label: "Replace" }, { id: "cancel", label: "Cancel" }], cancel: "cancel" }) === "replace",
    };
    return { env, root: folder.uri };
  };
  context.subscriptions.push(vscode.commands.registerCommand("tkr.newAnimation", async () => {
    const selected = await environment(); if (selected === null) return;
    const path = await vscode.window.showInputBox({ title: "New animation", prompt: "Project-relative .anm destination in Misc", value: "Misc/new-animation.anm", validateInput: (value) => animationDestination(value) ?? undefined });
    if (path === undefined) return;
    const result = await createAnimationFile(selected.env, path);
    if (!result.ok) { await vscode.window.showErrorMessage(result.error.message); return; }
    if (result.value.files.some((file) => file.status !== "written")) { await vscode.window.showErrorMessage("Creation stopped. Run TK Reawakened: Project recovery to retry."); return; }
    await vscode.commands.executeCommand("vscode.open", vscode.Uri.joinPath(selected.root, ...result.value.files[0]!.path.split("/")));
  }));
  context.subscriptions.push(vscode.commands.registerCommand("tkr.animationRecovery", async () => {
    const selected = await environment(); if (selected === null) return;
    const groups = createCheckpointGroups(selected.env);
    const listed = await groups.list();
    if (!listed.ok) { await vscode.window.showErrorMessage(listed.error.message); return; }
    const choice = await vscode.window.showQuickPick(listed.value.map((group) => ("error" in group ? { label: `Unavailable: ${group.id}`, description: `${group.path}: ${group.error}`, group } : { label: `${group.reason}: ${group.time}`, description: group.files.map((file) => `${file.path}: ${file.status}`).join(", "), group })), { title: "Project recovery", placeHolder: "Choose a persistent recovery group" });
    if (choice === undefined) return;
    const actions = "error" in choice.group ? [...(choice.group.deletable ? ["Delete recovery group"] : []), "Leave as is"] : ["Restore group", "Retry remaining", "Leave as is", "Delete recovery group"];
    const action = await vscode.window.showQuickPick(actions, { title: "Project recovery", placeHolder: "Restore creates its own recoverable group" });
    if (action === undefined || action === "Leave as is") return;
    if (action === "Delete recovery group" && await vscode.window.showWarningMessage("Permanently delete this recovery group?", { modal: true }, "Delete") !== "Delete") return;
    const result = action === "Restore group" ? await groups.restore(choice.group.id) : action === "Retry remaining" ? await groups.retry(choice.group.id) : await groups.deleteGroup(choice.group.id);
    if (!result.ok) await vscode.window.showErrorMessage(result.error.message);
    else if (result.value !== undefined) await vscode.window.showInformationMessage(result.value.files.map((file) => `${file.path}: ${file.status} ${file.message ?? ""}`).join("; "), { modal: true });
  }));
}
