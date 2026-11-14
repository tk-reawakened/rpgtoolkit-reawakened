import { mount, type SpriteViewDocument, type ViewContext } from "@tk-reawakened/editor-ui";
import { RemoteDocument, isSpriteSnapshot, type BridgeMessage, type VscodeApi } from "./document-bridge.js";
declare function acquireVsCodeApi(): VscodeApi;

// A hidden webview is destroyed and this script runs again when it is shown: the document and its history stay in the
// extension host, and `ready` fetches them back (ADR 0022 D3.7).
const api = acquireVsCodeApi();
let remoteDocument: RemoteDocument | undefined;
window.addEventListener("message", (event: MessageEvent<BridgeMessage>) => {
  if (event.data.type === "initialize") {
    const remote = new RemoteDocument(event.data.kind, event.data.snapshot, event.data.browserState, api);
    remoteDocument = remote;
    const fs = {
      readProject: (projectId: string, path: string) => remote.readProject(projectId, path),
    };
    const services = { document: { edited: () => undefined }, capabilities: new Set(event.data.capabilities), fs };
    if (event.data.kind === "character" || event.data.kind === "item") {
      const doc = spriteViewDocument(remote);
      if (doc === null) throw new Error(`The ${event.data.kind} editor received an invalid sprite snapshot.`);
      mount(documentRoot(), { document: doc, services });
    } else {
      mount(documentRoot(), {
        document: remote as unknown as ViewContext["document"],
        services,
        browser: {
          session: remote.browserSession,
          fs: { list: (path) => remote.browserList(path), read: (path) => remote.browserRead(path) },
          layout: { projectFolder: "" },
        },
      });
    }
    return;
  }
  remoteDocument?.receive(event.data);
});
api.postMessage({ type: "ready" });

function spriteViewDocument(remote: RemoteDocument): SpriteViewDocument | null {
  if (remote.kind !== "character" && remote.kind !== "item") return null;
  const readSnapshot = () => {
    const snapshot = remote.getSnapshot();
    if (!isSpriteSnapshot(snapshot, remote.kind)) throw new Error(`The ${remote.kind} editor received an invalid sprite snapshot.`);
    return snapshot;
  };
  if (!isSpriteSnapshot(remote.getSnapshot(), remote.kind)) return null;
  return {
    kind: remote.kind,
    identity: remote.identity,
    getSnapshot: readSnapshot,
    subscribe: (listener) => remote.subscribe(listener),
    apply: (command) => remote.apply(command),
    save: () => remote.save(),
    resolveConflict: (choice) => remote.resolveConflict(choice),
  };
}

function documentRoot(): HTMLElement {
  const element = document.getElementById("root");
  if (!element) throw new Error("The editor webview has no root element.");
  return element;
}
