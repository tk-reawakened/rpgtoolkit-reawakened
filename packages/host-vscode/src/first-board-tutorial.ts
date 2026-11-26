import * as vscode from "vscode";
import {
  FIRST_BOARD_ACTIONS,
  firstBoardHelpCommands,
  firstBoardTipOfTheDay,
  readFirstBoardTipsEnabled,
  type FirstBoardActionId,
  type FirstBoardHelpSurface,
} from "@tk-reawakened/editor-ui";
import { createCommandRegistry, type CommandRegistry } from "@tk-reawakened/editor-model";
import { platformError, platformOk, type SettingsService } from "@tk-reawakened/platform-services";
import { createVscodeSettings } from "./services.ts";
import { DOCUMENT_KINDS_BY_VIEW_TYPE } from "./custom-editor.ts";

const STEP = "onboarding.firstBoard.step";
const TIPS = "editor.showTips";
const ACTION_CONTEXT = "tkr.firstBoard.action.";

type TutorialPanel = {
  readonly panel: vscode.WebviewPanel;
  readonly surface: FirstBoardHelpSurface;
  closed: boolean;
  ready: boolean;
  initialized: boolean;
  documentId: string | null;
};

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

/** Host shared tutorial commands and their non-modal webview in the VS Code workbench. */
export function registerFirstBoardTutorial(context: vscode.ExtensionContext): void {
  const settings = tutorialSettings(context);
  let current: TutorialPanel | null = null;
  let commands: CommandRegistry | null = null;
  let capabilities = new Set<FirstBoardActionId>();
  let enteredManually = false;
  let consideredStartupTip = false;

  const isCurrentPanel = (panel: vscode.WebviewPanel): boolean =>
    current?.panel === panel && !current.closed;
  const isCurrentVisiblePanel = (panel: vscode.WebviewPanel): boolean =>
    isCurrentPanel(panel) && panel.visible && panel.active;

  function updateNativeContext(): void {
    const active = current !== null && isCurrentVisiblePanel(current.panel);
    for (const action of FIRST_BOARD_ACTIONS) {
      void vscode.commands.executeCommand(
        "setContext", `${ACTION_CONTEXT}${action.id}`, active && capabilities.has(action.id),
      );
    }
  }
  function dispatchAction(id: FirstBoardActionId, panel: vscode.WebviewPanel): void {
    const documentId = current?.panel === panel ? current.documentId : null;
    if (!isCurrentVisiblePanel(panel) || !capabilities.has(id) || documentId === null) return;
    void panel.webview.postMessage({ type: "invoke-action", documentId, id });
  }

  function updateCapabilities(panel: vscode.WebviewPanel, values: unknown): void {
    if (!isCurrentPanel(panel)) return;
    capabilities = Array.isArray(values)
      && values.every((value): value is FirstBoardActionId => FIRST_BOARD_ACTIONS.some(({ id }) => id === value))
      ? new Set(values)
      : new Set();
    updateNativeContext();
  }

  function show(surface: FirstBoardHelpSurface, preserveFocus: boolean): void {
    if (current?.surface === surface && !current.closed) {
      current.panel.reveal(undefined, preserveFocus);
      updateNativeContext();
      return;
    }
    const previous = current;
    current = null;
    capabilities = new Set();
    previous?.panel.dispose();

    const panel = vscode.window.createWebviewPanel(
      "tkr.firstBoardTutorial", surface === "guide" ? "First board tutorial" : "Tip of the day",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus },
      { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")] },
    );
    const state: TutorialPanel = { panel, surface, closed: false, ready: false, initialized: false, documentId: null };
    current = state;
    panel.onDidChangeViewState(() => {
      updateNativeContext();
      initialize();
    });

    function initialize(): void {
      if (!state.ready || state.initialized || !isCurrentVisiblePanel(panel) || state.documentId === null) return;
      state.initialized = true;
      const folders = vscode.workspace.workspaceFolders ?? [];
      const writable = folders.some(({ uri }) => vscode.workspace.fs.isWritableFileSystem(uri.scheme) !== false);
      void panel.webview.postMessage({
        type: "initialize", documentId: state.documentId, surface, autofocus: !preserveFocus,
        canWrite: vscode.workspace.isTrusted && writable, canRun: vscode.workspace.isTrusted && folders.length > 0,
      });
    }

    const listener = panel.webview.onDidReceiveMessage(async (message: unknown) => {
      if (state.closed || !isCurrentPanel(panel) || typeof message !== "object" || message === null || !("type" in message)) return;
      if (message.type === "ready") {
        if (!("documentId" in message) || typeof message.documentId !== "string" || message.documentId.length === 0) return;
        state.documentId = message.documentId;
        state.ready = true;
        state.initialized = false;
        capabilities = new Set();
        updateNativeContext();
        initialize();
        return;
      }
      if (!("documentId" in message) || message.documentId !== state.documentId) return;
      if (message.type === "action-capabilities" && "ids" in message) {
        updateCapabilities(panel, message.ids);
      } else if (message.type === "close") {
        if (isCurrentVisiblePanel(panel)) panel.dispose();
      } else if (message.type === "setting"
        && "requestId" in message && typeof message.requestId === "number"
        && "layer" in message && message.layer === "user" && "id" in message && typeof message.id === "string" && "operation" in message) {
        const requestDocumentId = state.documentId;
        if (requestDocumentId === null) return;
        let result;
        try {
          result = message.operation === "get" ? await settings.get("user", message.id)
            : message.operation === "set" && "value" in message && (typeof message.value === "number" || typeof message.value === "boolean")
              ? await settings.set("user", message.id, message.value)
              : platformError("invalid-request", "Invalid tutorial preference request.");
        } catch {
          result = platformError("unavailable", "VS Code could not access this user preference.");
        }
        if (isCurrentPanel(panel) && state.documentId === requestDocumentId) {
          await panel.webview.postMessage({ type: "setting-result", documentId: requestDocumentId, requestId: message.requestId, result });
        }
      }
    });

    panel.onDidDispose(() => {
      state.closed = true;
      listener.dispose();
      if (current?.panel === panel) {
        current = null;
        capabilities = new Set();
        updateNativeContext();
      }
    });
    panel.webview.html = tutorialHtml(panel.webview, context.extensionUri);
    updateNativeContext();
  }

  commands = createCommandRegistry(firstBoardHelpCommands((surface) => {
    enteredManually = true;
    show(surface, false);
  }));
  for (const command of commands.getCommands()) {
    context.subscriptions.push(vscode.commands.registerCommand(`tkr.${command.id}`, () => { commands?.execute(command.id); }));
  }
  for (const action of FIRST_BOARD_ACTIONS) {
    context.subscriptions.push(vscode.commands.registerCommand(`tkr.${action.id}`, () => {
      const panel = current?.panel;
      if (panel !== undefined) dispatchAction(action.id, panel);
    }));
  }
  updateNativeContext();

  async function offerStartupTip(): Promise<void> {
    if (consideredStartupTip || enteredManually) return;
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    if (!(input instanceof vscode.TabInputCustom) || !Object.hasOwn(DOCUMENT_KINDS_BY_VIEW_TYPE, input.viewType)) return;
    consideredStartupTip = true;
    if (await readFirstBoardTipsEnabled(settings) && !enteredManually) {
      void vscode.window.showInformationMessage(firstBoardTipOfTheDay());
    }
  }
  context.subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(() => {
    updateNativeContext();
    void offerStartupTip();
  }), {
    dispose() { current?.panel.dispose(); },
  });
  void offerStartupTip();
}

function tutorialHtml(webview: vscode.Webview, extension: vscode.Uri): string {
  const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map((value) => value.toString(16).padStart(2, "0")).join("");
  const bundle = webview.asWebviewUri(vscode.Uri.joinPath(extension, "dist", "first-board-tutorial.js"));
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}';"><meta name="viewport" content="width=device-width, initial-scale=1"><title>First board help</title><style nonce="${nonce}">body{max-width:42rem}button{margin-inline-end:.5rem}nav{display:flex;flex-wrap:wrap;gap:.4rem}</style></head><body><div id="first-board-help"></div><script nonce="${nonce}" src="${bundle}"></script></body></html>`;
}
