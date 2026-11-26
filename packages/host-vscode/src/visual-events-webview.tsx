import { render } from "preact";
import { VisualEventPane, type VisualAssetPicker, type VisualEventAction } from "@tk-reawakened/editor-ui";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

const api = acquireVsCodeApi();
const mountNode = (() => {
  const element = document.getElementById("root");
  if (element === null) throw new Error("The Visual events webview has no root element.");
  return element;
})();
interface SnapshotMessage {
  readonly type: "snapshot";
  readonly source: string;
  readonly version: number;
  readonly readOnly: boolean;
  readonly error: string | null;
}

let snapshot: SnapshotMessage | null = null;
let error: string | null = null;
let pickId = 0;
const picks = new Map<number, (reference: string | null) => void>();

/** Native VS Code has no overlay picker: the extension host shows a quick pick of the project's matching files. */
const pickAsset: VisualAssetPicker = (request) => new Promise((resolve) => {
  pickId += 1;
  picks.set(pickId, (reference) => resolve(reference === null ? { chosen: false } : { chosen: true, reference }));
  api.postMessage({ type: "pick-asset", id: pickId, request });
});

function update(): void {
  const current = snapshot;
  if (current === null) return;
  render(<VisualEventPane source={current.source} readOnly={current.readOnly} error={error} pickAsset={pickAsset}
    onAction={(action: VisualEventAction) => {
      api.postMessage({ type: "action", version: current.version, source: current.source, action });
    }} />, mountNode);
}

type HostMessage = SnapshotMessage
  | { readonly type: "error"; readonly message: string }
  | { readonly type: "asset-picked"; readonly id: number; readonly reference: string | null };

window.addEventListener("message", (event: MessageEvent<HostMessage>) => {
  if (event.data.type === "snapshot") {
    snapshot = event.data;
    error = event.data.error;
  } else if (event.data.type === "error") {
    error = event.data.message;
  } else {
    const done = picks.get(event.data.id);
    picks.delete(event.data.id);
    done?.(event.data.reference);
    return;
  }
  update();
});

api.postMessage({ type: "ready" });
