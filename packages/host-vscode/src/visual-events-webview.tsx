import { render } from "preact";
import { VisualEventPane, type VisualEventAction } from "@tk-reawakened/editor-ui";

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

function update(): void {
  if (snapshot === null) return;
  render(<VisualEventPane source={snapshot.source} readOnly={snapshot.readOnly} error={error}
    onAction={(action: VisualEventAction) => {
      api.postMessage({ type: "action", version: snapshot?.version, source: snapshot?.source, action });
    }} />, mountNode);
}

window.addEventListener("message", (event: MessageEvent<SnapshotMessage | { readonly type: "error"; readonly message: string }>) => {
  if (event.data.type === "snapshot") {
    snapshot = event.data;
    error = event.data.error;
  } else if (event.data.type === "error") {
    error = event.data.message;
  }
  update();
});

api.postMessage({ type: "ready" });
