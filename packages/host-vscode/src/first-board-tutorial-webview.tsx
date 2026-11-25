import { mountFirstBoardTutorial, type FirstBoardHelpSurface, type ViewHandle } from "@tk-reawakened/editor-ui";
import type { PlatformResult, SettingValue, SettingsService, SettingsLayer } from "@tk-reawakened/platform-services";

interface NativeWebview {
  postMessage(message: unknown): void;
}
declare function acquireVsCodeApi(): NativeWebview;

type SettingResult = PlatformResult<SettingValue | null | void>;
type HostMessage = {
  readonly type: "initialize";
  readonly surface: FirstBoardHelpSurface;
  readonly autofocus: boolean;
  readonly canWrite: boolean;
  readonly canRun: boolean;
} | { readonly type: "setting-result"; readonly requestId: number; readonly result: SettingResult };

type Request = { readonly layer: SettingsLayer; readonly id: string } & (
  { readonly operation: "get" } | { readonly operation: "set"; readonly value: SettingValue | null }
);
const api = acquireVsCodeApi();
const pending = new Map<number, (value: SettingResult) => void>();
let nextId = 0;
let view: ViewHandle | null = null;

function request(message: Request): Promise<SettingResult> {
  const requestId = ++nextId;
  return new Promise((resolve) => {
    pending.set(requestId, resolve);
    api.postMessage({ type: "setting", requestId, ...message });
  });
}

const settings: SettingsService = {
  get: (layer, id) => request({ operation: "get", layer, id }) as ReturnType<SettingsService["get"]>,
  set: (layer, id, value) => request({ operation: "set", layer, id, value }) as ReturnType<SettingsService["set"]>,
};

window.addEventListener("message", (event: MessageEvent<HostMessage>) => {
  const message = event.data;
  if (message.type === "setting-result") {
    const resolve = pending.get(message.requestId);
    pending.delete(message.requestId);
    resolve?.(message.result);
  } else if (message.type === "initialize") {
    const root = document.getElementById("first-board-help");
    if (root === null) throw new Error("The first-board webview is missing its root element.");
    view?.dispose();
    view = mountFirstBoardTutorial(root, {
      host: "vscode", surface: message.surface, settings, autofocus: message.autofocus,
      canWrite: message.canWrite, canRun: message.canRun,
      onClose: () => api.postMessage({ type: "close" }),
    });
  }
});
api.postMessage({ type: "ready" });
