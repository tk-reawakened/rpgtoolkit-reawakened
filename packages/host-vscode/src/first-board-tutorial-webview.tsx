import {
  FIRST_BOARD_ACTIONS,
  mountFirstBoardTutorial,
  type FirstBoardHelpSurface,
  type ViewHandle,
} from "@tk-reawakened/editor-ui";
import { createCommandRegistry } from "@tk-reawakened/editor-model";
import type { PlatformResult, SettingValue, SettingsService, SettingsLayer } from "@tk-reawakened/platform-services";

interface NativeWebview {
  postMessage(message: unknown): void;
}
declare function acquireVsCodeApi(): NativeWebview;

type SettingResult = PlatformResult<SettingValue | null | void>;
type HostMessage =
  | { readonly type: "initialize"; readonly documentId: string; readonly surface: FirstBoardHelpSurface; readonly autofocus: boolean; readonly canWrite: boolean; readonly canRun: boolean }
  | { readonly type: "invoke-action"; readonly documentId: string; readonly id: unknown }
  | { readonly type: "setting-result"; readonly documentId: string; readonly requestId: number; readonly result: SettingResult };

type Request = { readonly layer: SettingsLayer; readonly id: string } & (
  { readonly operation: "get" } | { readonly operation: "set"; readonly value: SettingValue | null }
);
const api = acquireVsCodeApi();
const documentId = crypto.randomUUID();
const pending = new Map<number, (value: SettingResult) => void>();
const commandRegistry = createCommandRegistry();
let nextId = 0;
let view: ViewHandle | null = null;

function request(message: Request): Promise<SettingResult> {
  const requestId = ++nextId;
  return new Promise((resolve) => {
    pending.set(requestId, resolve);
    api.postMessage({ type: "setting", documentId, requestId, ...message });
  });
}

function publishCapabilities(): void {
  const ids = commandRegistry.getCommands()
    .filter(({ id, disabled }) => FIRST_BOARD_ACTIONS.some((action) => action.id === id) && disabled !== true)
    .map(({ id }) => id);
  api.postMessage({ type: "action-capabilities", documentId, ids });
}

const settings: SettingsService = {
  get: (layer, id) => request({ operation: "get", layer, id }) as ReturnType<SettingsService["get"]>,
  set: (layer, id, value) => request({ operation: "set", layer, id, value }) as ReturnType<SettingsService["set"]>,
};

commandRegistry.subscribe(publishCapabilities);
window.addEventListener("message", (event: MessageEvent<HostMessage>) => {
  const message = event.data;
  if (message.documentId !== documentId) return;
  if (message.type === "setting-result") {
    const resolve = pending.get(message.requestId);
    pending.delete(message.requestId);
    resolve?.(message.result);
  } else if (message.type === "invoke-action"
    && typeof message.id === "string"
    && FIRST_BOARD_ACTIONS.some(({ id }) => id === message.id)) {
    commandRegistry.execute(message.id);
  } else if (message.type === "initialize") {
    const root = document.getElementById("first-board-help");
    if (root === null) throw new Error("The first-board webview is missing its root element.");
    view?.dispose();
    view = mountFirstBoardTutorial(root, {
      host: "vscode", surface: message.surface, settings, commandRegistry, autofocus: message.autofocus,
      canWrite: message.canWrite, canRun: message.canRun,
      onClose: () => api.postMessage({ type: "close", documentId }),
    });
  }
});
api.postMessage({ type: "ready", documentId });
