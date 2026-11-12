import { mount } from "@tk-reawakened/editor-ui";
import { RemoteDocument, type BridgeMessage, type VscodeApi } from "./document-bridge.js";

declare function acquireVsCodeApi(): VscodeApi;

const api = acquireVsCodeApi();
let remoteDocument: RemoteDocument | undefined;
window.addEventListener("message", (event: MessageEvent<BridgeMessage>) => {
  if (event.data.type === "initialize") {
    remoteDocument = new RemoteDocument(event.data.snapshot, api);
    mount(documentRoot(), { document: remoteDocument, services: { document: { edited: () => undefined } } });
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
