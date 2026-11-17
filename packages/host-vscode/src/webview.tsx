import { mount, type SpriteViewDocument, type ViewContext } from "@tk-reawakened/editor-ui";
import { RemoteDocument, isSpriteSnapshot, type BridgeMessage, type VscodeApi } from "./document-bridge.js";
declare function acquireVsCodeApi(): VscodeApi;

// A hidden webview retains this page; if VS Code recreates a disposed page, the document and its history stay in the extension host,
// and `ready` fetches them back (ADR 0022 D3.7).
const api = acquireVsCodeApi();
let remoteDocument: RemoteDocument | undefined;
window.addEventListener("message", (event: MessageEvent<BridgeMessage>) => {
  if (event.data.type === "initialize") {
    const remote = new RemoteDocument(event.data.kind, event.data.snapshot, event.data.browserState, api, event.data.boardPreferences, event.data.initialBoardPath);
    remoteDocument = remote;
    const fs = {
      readProject: (projectId: string, path: string) => remote.readProject(projectId, path),
    };
    const services = { document: { edited: () => undefined }, capabilities: new Set(event.data.capabilities), fs };
    if (event.data.kind === "character" || event.data.kind === "item") {
      const doc = spriteViewDocument(remote);
      if (doc === null) throw new Error(`The ${event.data.kind} editor received an invalid sprite snapshot.`);
      mount(documentRoot(), {
        document: doc,
        services,
        // The extension host's `settle` request waits for the edits these views have accepted but not yet sent (#2613).
        pendingEdits: remote.pendingEdits,
        // Sprite authoring does not offer linked-document navigation in this view.
        navigation: { pickAsset: (request) => remote.pickAsset(request) },
      });
    } else {
      mount(documentRoot(), {
        // The remote document has the surface of its kind's view document; the kind says which fields its snapshot has.
        document: remote as unknown as ViewContext["document"],
        services,
        animationAuthoring: remote.animationAuthoring,
        browser: {
          session: remote.browserSession,
          fs: { list: (path) => remote.browserList(path), read: (path) => remote.browserRead(path) },
          layout: { projectFolder: "" },
          // A linked visit: the extension host opens the file in its own editor and remembers the way back.
          openSource: async (path) => {
            const outcome = await remote.visit(path);
            return outcome.ok ? null : outcome.message;
          },
        },
        boardPreferences: remote.boardPreferences,
        pendingEdits: remote.pendingEdits,
        ...(remote.kind === "board" ? {
          navigation: {
            pickAsset: (request) => remote.pickAsset(request),
            open: async (path: string) => {
              const outcome = await remote.visit(path, true);
              return outcome.ok ? null : outcome.message;
            },
            returnFromVisit: async () => {
              const outcome = await remote.returnFromVisit();
              return outcome.ok ? outcome.message : outcome.message;
            },
            setInitialBoard: async (path: string) => {
              const outcome = await remote.setInitialBoard(path);
              return outcome.message;
            },
            get initialBoardPath() { return remote.initialBoardPath ?? ""; },
          },
        } : {}),
      });
    }
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
