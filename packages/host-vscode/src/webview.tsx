import { mount, type ViewContext } from "@tk-reawakened/editor-ui";
import { RemoteDocument, type BridgeMessage, type VscodeApi } from "./document-bridge.js";

declare function acquireVsCodeApi(): VscodeApi;

// A hidden webview is destroyed and this script runs again when it is shown: the document and its history stay in the
// extension host, and `ready` fetches them back (ADR 0022 D3.7).
const api = acquireVsCodeApi();
let remoteDocument: RemoteDocument | undefined;
window.addEventListener("message", (event: MessageEvent<BridgeMessage>) => {
  if (event.data.type === "initialize") {
    const remote = new RemoteDocument(event.data.kind, event.data.snapshot, event.data.browserState, api);
    remoteDocument = remote;
    mount(documentRoot(), {
      // The remote document has the surface of its kind's view document; the kind says which fields its snapshot has.
      document: remote as unknown as ViewContext["document"],
      services: { document: { edited: () => undefined }, capabilities: new Set(event.data.capabilities) },
      browser: {
        session: remote.browserSession,
        fs: { list: (path) => remote.browserList(path), read: (path) => remote.browserRead(path) },
        layout: { projectFolder: "" },
      },
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
