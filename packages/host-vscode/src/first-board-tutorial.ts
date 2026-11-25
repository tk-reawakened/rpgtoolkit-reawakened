import * as vscode from "vscode";
import { firstBoardHelpCommands, readFirstBoardTipsEnabled, type FirstBoardHelpSurface } from "@tk-reawakened/editor-ui";
import { createCommandRegistry } from "@tk-reawakened/editor-model";
import { platformError, platformOk, type SettingsService } from "@tk-reawakened/platform-services";
import { createVscodeSettings } from "./services.ts";
import { DOCUMENT_KINDS_BY_VIEW_TYPE } from "./custom-editor.ts";

const STEP = "onboarding.firstBoard.step";
const TIPS = "editor.showTips";

function tutorialSettings(context: vscode.ExtensionContext): SettingsService {
  const native = createVscodeSettings();
  return {
    async get(layer, id) {
      if (layer === "user" && id === STEP) return platformOk(context.globalState.get<number>(STEP) ?? null);
      if (layer === "user" && id === TIPS) return native.get(layer, id);
      return platformError("invalid-request", "This help panel reads only tutorial user preferences.");
    },
    async set(layer, id, value) {
      if (layer === "user" && id === TIPS && typeof value === "boolean") return native.set(layer, id, value);
      if (layer === "user" && id === STEP && typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 9) {
        await context.globalState.update(STEP, value);
        return platformOk(undefined);
      }
      return platformError("invalid-request", "This help panel writes only valid tutorial user preferences.");
    },
  };
}

/** Host the shared tutorial commands and their non-modal webview in the VS Code workbench. */
export function registerFirstBoardTutorial(context: vscode.ExtensionContext): void {
  const settings = tutorialSettings(context);
  let current: { readonly panel: vscode.WebviewPanel; readonly surface: FirstBoardHelpSurface } | null = null;
  let enteredManually = false;
  let consideredStartupTip = false;

  function show(surface: FirstBoardHelpSurface, preserveFocus: boolean): void {
    if (current?.surface === surface) {
      current.panel.reveal(undefined, preserveFocus);
      return;
    }
    const previous = current;
    current = null;
    previous?.panel.dispose();

    const panel = vscode.window.createWebviewPanel(
      "tkr.firstBoardTutorial", surface === "guide" ? "First board tutorial" : "Tip of the day",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus },
      { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")] },
    );
    current = { panel, surface };
    let closed = false;
    const listener = panel.webview.onDidReceiveMessage(async (message: unknown) => {
      if (closed || typeof message !== "object" || message === null || !("type" in message)) return;
      if (message.type === "ready") {
        const folders = vscode.workspace.workspaceFolders ?? [];
        const writable = folders.some(({ uri }) => vscode.workspace.fs.isWritableFileSystem(uri.scheme) !== false);
        await panel.webview.postMessage({ type: "initialize", surface, autofocus: !preserveFocus,
          canWrite: vscode.workspace.isTrusted && writable, canRun: vscode.workspace.isTrusted && folders.length > 0 });
      } else if (message.type === "close") {
        // Disposing a native panel restores its previous editor group; do not reopen closed documents.
        panel.dispose();
      } else if (message.type === "setting" && "requestId" in message && typeof message.requestId === "number"
        && "layer" in message && message.layer === "user" && "id" in message && typeof message.id === "string" && "operation" in message) {
        let result;
        try {
          result = message.operation === "get" ? await settings.get("user", message.id)
            : message.operation === "set" && "value" in message && (typeof message.value === "number" || typeof message.value === "boolean")
              ? await settings.set("user", message.id, message.value)
              : platformError("invalid-request", "Invalid tutorial preference request.");
        } catch {
          result = platformError("unavailable", "VS Code could not access this user preference.");
        }
        if (!closed) await panel.webview.postMessage({ type: "setting-result", requestId: message.requestId, result });
      }
    });
    panel.onDidDispose(() => {
      closed = true;
      listener.dispose();
      if (current?.panel === panel) current = null;
    });
    panel.webview.html = tutorialHtml(panel.webview, context.extensionUri);
  }

  const commands = createCommandRegistry(firstBoardHelpCommands((surface) => {
    enteredManually = true;
    show(surface, false);
  }));
  for (const { id } of commands.getCommands()) {
    context.subscriptions.push(vscode.commands.registerCommand(`tkr.${id}`, () => { commands.execute(id); }));
  }

  async function offerStartupTip(): Promise<void> {
    if (consideredStartupTip || enteredManually) return;
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    if (!(input instanceof vscode.TabInputCustom) || !Object.hasOwn(DOCUMENT_KINDS_BY_VIEW_TYPE, input.viewType)) return;
    consideredStartupTip = true;
    if (await readFirstBoardTipsEnabled(settings) && !enteredManually) show("tip", true);
  }
  context.subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(() => { void offerStartupTip(); }), {
    dispose() { current?.panel.dispose(); },
  });
  void offerStartupTip();
}

function tutorialHtml(webview: vscode.Webview, extension: vscode.Uri): string {
  const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map((value) => value.toString(16).padStart(2, "0")).join("");
  const bundle = webview.asWebviewUri(vscode.Uri.joinPath(extension, "dist", "first-board-tutorial.js"));
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}';"><meta name="viewport" content="width=device-width, initial-scale=1"><title>First board help</title><style nonce="${nonce}">body{max-width:42rem}button{margin-inline-end:.5rem}nav{display:flex;flex-wrap:wrap;gap:.4rem}</style></head><body><div id="first-board-help"></div><script nonce="${nonce}" src="${bundle}"></script></body></html>`;
}
