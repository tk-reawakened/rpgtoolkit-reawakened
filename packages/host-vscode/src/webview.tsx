import { projectLayoutOwnerForDocumentPath, projectLayoutOfMain, resolveReservedFolderPath } from "@tk-reawakened/editor-model";
import { clipboardFromApi, type Capability } from "@tk-reawakened/platform-services";
import { mount, type SpriteViewDocument, type ViewContext, type ViewHandle } from "@tk-reawakened/editor-ui";
import { RemoteDocument, canVisitPath, isSpriteSnapshot, type BridgeMessage, type VscodeApi } from "./document-bridge.js";
import type { ProjectLayout } from "@tk-reawakened/editor-model";
declare function acquireVsCodeApi(): VscodeApi;
async function layoutForDocument(remote: RemoteDocument): Promise<ProjectLayout> {
  // Standalone native-text providers do not handle browser-list requests; these views do not need a project layout.
  if (remote.kind === "native-clip" || remote.kind === "native-tile" || remote.kind === "native-asset-pack") return { projectFolder: "" };
  const fs = {
    list: (path: string) => remote.browserList(path),
    readProject: (projectId: string, path: string) => remote.readProject(projectId, path),
  };
  const mainFolder = await resolveReservedFolderPath(fs, "Main");
  if (mainFolder.failure !== null) return { projectFolder: "" };
  const entries = await fs.list(mainFolder.path);
  if (!entries.ok) return { projectFolder: "" };
  const owners = await Promise.all(entries.value.filter((entry) => entry.kind === "file" && /\.gam$/i.test(entry.name)).map(async (entry) => {
    const mainPath = `${mainFolder.path}/${entry.name}`;
    return { mainPath, layout: await projectLayoutOfMain(fs, remote.identity.projectId, mainPath) };
  }));
  return projectLayoutOwnerForDocumentPath(remote.identity.path, owners)?.layout ?? { projectFolder: "" };
}

type ViewMessage = BridgeMessage | { readonly type: "activate" };

// A hidden webview retains this page; if VS Code recreates a disposed page, the document and its history stay in the extension host,
// and `ready` fetches them back (ADR 0022 D3.7).
const api = acquireVsCodeApi();
let remoteDocument: RemoteDocument | undefined;
let mountedView: ViewHandle | undefined;
window.addEventListener("message", async (event: MessageEvent<ViewMessage>) => {
  // A fresh custom editor can be asked to settle before its `initialize` message has created a
  // RemoteDocument. No view has mounted yet, so it cannot hold an accepted edit to hand over.
  if (event.data.type === "settle" && remoteDocument === undefined) {
    api.postMessage({ type: "settled", requestId: event.data.requestId });
    return;
  }
  if (event.data.type === "activate") {
    mountedView?.refreshAssets?.();
    return;
  }
  if (event.data.type === "source-target") {
    // A source visit asked for a tile; selecting it changes no document state and keeps drafts and history.
    mountedView?.revealTile?.(event.data.tile);
    return;
  }
  if (event.data.type === "initialize") {
    mountedView?.dispose();
    const readOnly = event.data.readOnly === true;
    const remote = new RemoteDocument(event.data.kind, event.data.snapshot, event.data.browserState, api, event.data.boardPreferences, event.data.initialBoardPath, !readOnly, event.data.saveLocks);
    remoteDocument = remote;
    const fs = {
      readProject: (projectId: string, path: string) => remote.readProject(projectId, path),
      list: (path: string) => remote.browserList(path),
    };
    // A webview is a page: it exchanges text with the system clipboard through the page's own clipboard, when it has one (T-28).
    const clipboard = clipboardFromApi(navigator.clipboard);
    const imageExport = remote.kind === "board" && !readOnly ? {
      actionLabel: "Save PNG",
      completion: "saved" as const,
      saveFile: (fileName: string, bytes: Uint8Array) => remote.saveImage(fileName, bytes),
    } : undefined;
    const services = {
      document: { edited: () => undefined },
      capabilities: new Set<Capability>(clipboard === null ? event.data.capabilities : [...event.data.capabilities, "clipboard"]),
      fs,
      ...(clipboard === null ? {} : { clipboard }),
      ...(imageExport === undefined ? {} : { imageExport }),
    };
    if (event.data.kind === "character" || event.data.kind === "item") {
      const doc = spriteViewDocument(remote);
      if (doc === null) throw new Error(`The ${event.data.kind} editor received an invalid sprite snapshot.`);
      mountedView = mount(documentRoot(), {
        document: doc,
        services,
        // The extension host's `settle` request waits for the edits these views have accepted but not yet sent (#2613).
        pendingEdits: remote.pendingEdits,
        // Linked ANM visits open through the same document/history identity as the project browser.
        navigation: {
          pickAsset: (request) => remote.pickAsset(request),
          open: async (path) => {
            const outcome = await remote.visit(path);
            return outcome.ok ? null : outcome.message;
          },
        },
      });
    } else {
      const browserLayout = await layoutForDocument(remote);
      mountedView = mount(documentRoot(), {
        // The remote document has the surface of its kind's view document; the kind says which fields its snapshot has.
        document: remote as unknown as ViewContext["document"],
        services,
        animationAuthoring: remote.animationAuthoring,
        browser: {
          session: remote.browserSession,
          fs: { list: (path) => remote.browserList(path), read: (path) => remote.browserRead(path) },
          layout: browserLayout,
          // A linked visit: the extension host opens the file in its own editor, remembers the way back, and selects the tile.
          openSource: async (visit) => {
            const outcome = visit.tile === null ? await remote.visit(visit.path) : await remote.visitSource(visit.path, visit.tile);
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
        ...(remote.kind === "special-move" || remote.kind === "status-effect" || remote.kind === "battle-background" ? {
          navigation: {
            layout: browserLayout,
            pickAsset: (request: Parameters<typeof remote.pickAsset>[0]) => remote.pickAsset(request),
            canOpen: canVisitPath,
            open: async (path: string) => {
              const outcome = await remote.visit(path);
              return outcome.ok ? null : outcome.message;
            },
          },
        } : {}),
      });
    }
    // A source visit that opened this document names the tile its first view selects, without touching the document.
    if (event.data.sourceTile !== undefined) mountedView.revealTile?.(event.data.sourceTile);
  }
  remoteDocument?.receive(event.data);
});
api.postMessage({ type: "ready" });

// Ctrl/Cmd+S while a field is focused belongs to this editor: VS Code's Save All only visits dirty documents, so a clean
// one with a field still being typed in would otherwise be skipped. The focused view's own Save applies the field first.
window.addEventListener("keydown", (event) => {
  // Save As (Ctrl/Cmd+Shift+S) and other chords are not this editor's save, and the key belongs to the focused editor.
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== "s") return;
  const surface = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-tkr-editor]") : null;
  const save = surface?.querySelector<HTMLButtonElement>("[data-editor-save]") ?? null;
  if (save === null || save.disabled) return;
  event.preventDefault();
  save.click();
});

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
