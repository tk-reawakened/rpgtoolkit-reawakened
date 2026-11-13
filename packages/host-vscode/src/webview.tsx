import { mount } from "@tk-reawakened/editor-ui";
import { RemoteDocument, type BridgeMessage, type VscodeApi } from "./document-bridge.js";

declare function acquireVsCodeApi(): VscodeApi;

// A hidden webview is destroyed and this script runs again when it is shown: the document and its history stay in the
// extension host, and `ready` fetches them back (ADR 0022 D3.7).
const api = acquireVsCodeApi();
let remoteDocument: RemoteDocument | undefined;
window.addEventListener("message", (event: MessageEvent<BridgeMessage>) => {
  if (event.data.type === "initialize") {
    remoteDocument = new RemoteDocument(event.data.snapshot, api);
    mount(documentRoot(), {
      document: remoteDocument,
      services: { document: { edited: () => undefined }, capabilities: new Set(event.data.capabilities) },
    });
    return;
  }
  remoteDocument?.receive(event.data);
});
api.postMessage({ type: "ready" });

function documentRoot(): HTMLElement {
  const element = document.getElementById("root");
  if (!element) throw new Error("The editor webview has no root element.");
  return element;
}
