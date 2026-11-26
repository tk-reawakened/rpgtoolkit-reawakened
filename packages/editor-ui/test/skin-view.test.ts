import { after, before, test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createDocumentIdentity, openNativeSkinDocument } from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import type { mount as mountEditor } from "../src/index.ts";

let mount: typeof mountEditor;
let act: (callback: () => void | Promise<void>) => void | Promise<void>;
before(async () => {
  GlobalRegistrator.register();
  ({ act } = await import("preact/test-utils"));
  ({ mount } = await import("@tk-reawakened/editor-ui"));
});
after(() => GlobalRegistrator.unregister());

/** Flush every pending turn of the view's reads; the memory host answers on the task queue, not only microtasks. */
async function settleUntil(done: () => boolean): Promise<void> {
  for (let turn = 0; turn < 100 && !done(); turn += 1) {
    await act(async () => { await new Promise<void>((resolve) => { setImmediate(resolve); }); });
  }
  ok(done(), "the skin view did not settle");
}

test("skin view gives each image role an independent picker, labels its editor-only preview, and applies one undoable edit", async () => {
  const path = "Misc/stone.tkrskin";
  const source = "# preserved\ncontract: skin\nversion: 1.0.0-pre.1\nlabel: Stone keep\nwindowImage: bitmap/old-window.png\nbuttonImage: bitmap/old-button.png\n";
  const host = createMemoryPlatformServices({ files: { [path]: new TextEncoder().encode(source) } });
  const opened = await openNativeSkinDocument(host.fs, createDocumentIdentity("memory-project", path));
  ok(opened.ok);
  const requests: string[] = [];
  const root = document.createElement("div");
  document.body.append(root);
  const handle = mount(root, {
    document: opened.document,
    services: host,
    navigation: { pickAsset: async (request) => {
      requests.push(request.field);
      return { chosen: true, reference: request.field === "the skin's window graphic" ? "new-window.png" : "new-button.png" };
    } },
  });
  const button = (name: string): HTMLButtonElement => {
    const found = root.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
    ok(found, `missing ${name}`);
    return found;
  };
  try {
    ok(root.textContent?.includes("Preview only: the engine does not use skins yet"));
    equal(root.querySelectorAll("fieldset").length, 2);
    await act(() => button("Choose window graphic image…").click());
    for (let step = 0; step < 8; step += 1) await act(async () => { await Promise.resolve(); });
    equal(opened.document.getSnapshot().skin.windowImage, "bitmap/new-window.png");
    equal(opened.document.getSnapshot().skin.buttonImage, "bitmap/old-button.png");
    deepEqual(requests, ["the skin's window graphic"]);
    ok(opened.document.undo().ok);
    equal(opened.document.getSnapshot().skin.windowImage, "bitmap/old-window.png");
  } finally {
    handle.dispose();
    root.remove();
  }
});

/** A 1 × 1 24-bit BMP: one azure pixel, the smallest picture the shared decoder reads. */
const BMP_1X1 = Uint8Array.from([
  0x42, 0x4d, 58, 0, 0, 0, 0, 0, 0, 0, 54, 0, 0, 0, 40, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 24, 0,
  0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 0, 0,
]);

test("the preview reads the project's asset folders from the host, not the document's path (#3523)", async () => {
  const path = "Misc/stone.tkrskin";
  const source = "contract: skin\nversion: 1.0.0-pre.1\nwindowImage: bitmap/window.png\nbuttonImage: bitmap/button.png\n";
  const host = createMemoryPlatformServices({ files: { [path]: new TextEncoder().encode(source) } });
  const opened = await openNativeSkinDocument(host.fs, createDocumentIdentity("memory-project", path));
  ok(opened.ok);
  const reads: string[] = [];
  const root = document.createElement("div");
  document.body.append(root);
  const handle = mount(root, {
    document: opened.document,
    services: { ...host, fs: { readProject: async (projectId, readPath) => { reads.push(readPath); return host.fs.readProject(projectId, readPath); }, list: host.fs.list } },
    // The host says this document belongs to Game/Stone, which the path alone cannot say.
    browser: {
      session: { getSnapshot: () => ({ selection: null, path: null, scrollTop: 0 }), subscribe: () => () => undefined, update: () => undefined },
      fs: host.fs,
      layout: { projectFolder: "Game/Stone" },
    },
  });
  try {
    await settleUntil(() => reads.length >= 2);
    deepEqual(reads, ["Game/Stone/Bitmap/window.png", "Game/Stone/Bitmap/button.png"], root.textContent ?? "");
  } finally {
    handle.dispose();
    root.remove();
  }
});

test("a failed re-read of the same reference shows its problem and no longer shows the old picture (#3525)", async () => {
  const { createElement, render } = await import("preact");
  const { NativeSkinView } = await import("@tk-reawakened/editor-ui");
  const { createPendingEdits } = await import("@tk-reawakened/editor-model");
  const path = "Misc/stone.tkrskin";
  const source = "contract: skin\nversion: 1.0.0-pre.1\nwindowImage: bitmap/window.png\nbuttonImage: bitmap/button.png\n";
  const host = createMemoryPlatformServices({ files: { [path]: new TextEncoder().encode(source) } });
  const opened = await openNativeSkinDocument(host.fs, createDocumentIdentity("memory-project", path));
  ok(opened.ok);
  const reader = (refuse: boolean) => ({ readProject: async () => refuse
    ? { ok: false as const, error: { code: "io-error" as const, message: "disk went away" } }
    : { ok: true as const, value: BMP_1X1 } });
  const view = (fs: ReturnType<typeof reader>) => createElement(NativeSkinView, {
    doc: opened.document,
    capabilities: new Set<never>(),
    pendingEdits: createPendingEdits(),
    onEdited: () => undefined,
    fs,
    projectId: "memory-project",
    layout: { projectFolder: "" },
  });
  const root = document.createElement("div");
  document.body.append(root);
  const canvases = () => root.querySelectorAll("canvas");
  const status = () => root.querySelector("[role='status']")?.textContent ?? "";
  try {
    await act(async () => { render(view(reader(false)), root); });
    await settleUntil(() => canvases().length === 2);
    equal(canvases().length, 2, "both roles show their picture");
    // The host hands the view its reader again and the read now fails, for the very same two references: the old
    // pictures must not survive it.
    await act(async () => { render(view(reader(true)), root); });
    await settleUntil(() => canvases().length === 0);
    equal(canvases().length, 0, "no stale canvas survives a failed re-read");
    ok(status().includes("disk went away"), status());
  } finally {
    await act(async () => { render(null, root); });
    root.remove();
  }
});
