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

test("a re-read that finds a case collision, or fails, no longer shows the old picture (#3525)", async () => {
  const { createElement, render } = await import("preact");
  const { NativeSkinView } = await import("@tk-reawakened/editor-ui");
  const { createPendingEdits } = await import("@tk-reawakened/editor-model");
  const path = "Misc/stone.tkrskin";
  const source = "contract: skin\nversion: 1.0.0-pre.1\nwindowImage: bitmap/window.png\nbuttonImage: bitmap/button.png\n";
  const host = createMemoryPlatformServices({ files: { [path]: new TextEncoder().encode(source) } });
  const opened = await openNativeSkinDocument(host.fs, createDocumentIdentity("memory-project", path));
  ok(opened.ok);
  // The project's folders answer truthfully: a host that can list them finds the stored spelling, and after the assets
  // change two entries differ only in case, which names neither file.
  let collision = false;
  const fs = {
    // The folder tree the view walks: Bitmap holds the two references' files, so a collision is found at the file part.
    list: async (folder: string) => ({ ok: true as const, value: folder === ""
      ? [{ name: "Bitmap", kind: "directory" as const }]
      : folder === "Bitmap"
        ? (collision
          ? [{ name: "window.png", kind: "file" as const }, { name: "Window.png", kind: "file" as const }]
          : [{ name: "window.png", kind: "file" as const }, { name: "button.png", kind: "file" as const }])
        : [] }),
    readProject: async () => ({ ok: true as const, value: BMP_1X1 }),
  };
  type Reader = { list: typeof fs.list; readProject: (projectId: string, path: string) => Promise<{ ok: true; value: Uint8Array } | { ok: false; error: { code: "io-error"; message: string } }> };
  const view = (reader: Reader) => createElement(NativeSkinView, {
    doc: opened.document,
    capabilities: new Set<never>(),
    pendingEdits: createPendingEdits(),
    onEdited: () => undefined,
    fs: reader,
    projectId: "memory-project",
    layout: { projectFolder: "" },
  });
  const root = document.createElement("div");
  document.body.append(root);
  const canvases = () => root.querySelectorAll("canvas");
  const status = () => root.querySelector("[role='status']")?.textContent ?? "";
  try {
    await act(async () => { render(view(fs), root); });
    await settleUntil(() => canvases().length === 2);
    equal(canvases().length, 2, "both roles show their picture");
    // The same two references, read again after the assets changed: the folder now names two files that differ only in
    // case, so neither may be shown — least of all the picture that was there before.
    collision = true;
    await act(async () => { render(view({ ...fs }), root); });
    // Only the window reference collides, so its picture goes and the button keeps its own; the sentence names the clash.
    await settleUntil(() => root.querySelector('[role="img"][aria-label*="bitmap/window.png"]') === null);
    equal(root.querySelector('[role="img"][aria-label*="bitmap/window.png"]'), null, "no stale window picture survives a case collision");
    ok(/differ only in case/.test(status()), status());
    // A plain read failure takes the same path for both roles.
    collision = false;
    const failing: Reader = { ...fs, readProject: async () => ({ ok: false as const, error: { code: "io-error" as const, message: "disk went away" } }) };
    await act(async () => { render(view(failing), root); });
    await settleUntil(() => canvases().length === 0);
    equal(canvases().length, 0, "no stale canvas survives a read failure");
    ok(status().includes("disk went away"), status());
  } finally {
    await act(async () => { render(null, root); });
    root.remove();
  }
});

test("a pick previews from the folders the picker read, so a changed game layout is not stale (#3536)", async () => {
  const { createElement, render } = await import("preact");
  const { NativeSkinView } = await import("@tk-reawakened/editor-ui");
  const { createPendingEdits } = await import("@tk-reawakened/editor-model");
  const path = "Game/Example/Misc/stone.tkrskin";
  const source = "contract: skin\nversion: 1.0.0-pre.1\nwindowImage: bitmap/window.png\nbuttonImage: bitmap/button.png\n";
  const host = createMemoryPlatformServices({ files: { [path]: new TextEncoder().encode(source) } });
  const opened = await openNativeSkinDocument(host.fs, createDocumentIdentity("memory-project", path));
  ok(opened.ok);
  const reads: string[] = [];
  const fs = { readProject: async (projectId: string, readPath: string) => { reads.push(readPath); return host.fs.readProject(projectId, readPath); } };
  const root = document.createElement("div");
  document.body.append(root);
  try {
    // Mounted while the game file says Game/Old; by the time the user picks, the game file has moved the folders.
    await act(async () => {
      render(createElement(NativeSkinView, {
        doc: opened.document,
        capabilities: new Set<never>(),
        pendingEdits: createPendingEdits(),
        onEdited: () => undefined,
        fs,
        projectId: "memory-project",
        layout: { projectFolder: "Game/Old" },
        pickAsset: async () => ({ chosen: true, reference: "window-b.png", layout: { projectFolder: "Game/New" } }),
      }), root);
    });
    await settleUntil(() => reads.length >= 2);
    ok(reads.includes("Game/Old/Bitmap/window.png"), reads.join(", "));
    reads.length = 0;
    const choose = [...root.querySelectorAll("button")].find((button) => button.textContent?.includes("window graphic"))!;
    await act(async () => { choose.click(); });
    await settleUntil(() => reads.includes("Game/New/Bitmap/window-b.png"));
    ok(reads.includes("Game/New/Bitmap/window-b.png"), reads.join(", "));
    ok(!reads.some((read) => read.startsWith("Game/Old/")), `the stale folders are not read again: ${reads.join(", ")}`);
  } finally {
    await act(async () => { render(null, root); });
    root.remove();
  }
});

/** The memory host's reads, recorded, so a test can say which project folders the preview walked. */
function recordingReader(host: ReturnType<typeof createMemoryPlatformServices>, reads: string[]) {
  return { readProject: async (projectId: string, path: string) => { reads.push(path); return host.fs.readProject(projectId, path); } };
}

test("a refresh re-resolves the project folders, so a moved game needs no pick (#3536)", async () => {
  const path = "Misc/stone.tkrskin";
  const source = "contract: skin\nversion: 1.0.0-pre.1\nwindowImage: bitmap/window.png\nbuttonImage: bitmap/button.png\n";
  const pictures = Object.fromEntries(["Game/Old", "Game/New"].flatMap((folder) => ["window.png", "button.png"].map((name) => [`${folder}/Bitmap/${name}`, BMP_1X1])));
  const host = createMemoryPlatformServices({ files: { [path]: new TextEncoder().encode(source), ...pictures } });
  const opened = await openNativeSkinDocument(host.fs, createDocumentIdentity("memory-project", path));
  ok(opened.ok);
  const reads: string[] = [];
  let owner = { projectFolder: "Game/Old" };
  const root = document.createElement("div");
  document.body.append(root);
  const handle = mount(root, {
    document: opened.document,
    services: { ...host, fs: recordingReader(host, reads) },
    browser: { session: { getSnapshot: () => ({ selection: null, path: null, scrollTop: 0 }), subscribe: () => () => undefined, update: () => undefined }, fs: host.fs, layout: owner },
    // The host's answer to "where are this document's folders now": the game file moved while the tab was hidden.
    resolveLayout: async () => owner,
  });
  const canvases = () => root.querySelectorAll("canvas");
  try {
    await settleUntil(() => reads.includes("Game/Old/Bitmap/window.png") && reads.includes("Game/Old/Bitmap/button.png"));
    await settleUntil(() => canvases().length === 2);
    // The tab becomes active again (the host's refresh) with no picker involved at all.
    owner = { projectFolder: "Game/New" };
    reads.length = 0;
    await act(() => { handle.refreshAssets?.(); });
    // The refresh itself re-renders once with the folders the view already had; the host's answer then wins, so the
    // last read of each picture is from the new folders and both are shown again.
    await settleUntil(() => reads.filter((read) => read.endsWith("/window.png")).at(-1) === "Game/New/Bitmap/window.png"
      && reads.filter((read) => read.endsWith("/button.png")).at(-1) === "Game/New/Bitmap/button.png");
    await settleUntil(() => canvases().length === 2);
  } finally {
    handle.dispose();
    root.remove();
  }
});

test("a cancelled pick still re-resolves the folders (#3536)", async () => {
  const path = "Misc/stone.tkrskin";
  const source = "contract: skin\nversion: 1.0.0-pre.1\nwindowImage: bitmap/window.png\nbuttonImage: bitmap/button.png\n";
  const pictures = Object.fromEntries(["Game/Old", "Game/New"].flatMap((folder) => ["window.png", "button.png"].map((name) => [`${folder}/Bitmap/${name}`, BMP_1X1])));
  const host = createMemoryPlatformServices({ files: { [path]: new TextEncoder().encode(source), ...pictures } });
  const opened = await openNativeSkinDocument(host.fs, createDocumentIdentity("memory-project", path));
  ok(opened.ok);
  const reads: string[] = [];
  let owner = { projectFolder: "Game/Old" };
  const root = document.createElement("div");
  document.body.append(root);
  const handle = mount(root, {
    document: opened.document,
    services: { ...host, fs: recordingReader(host, reads) },
    browser: { session: { getSnapshot: () => ({ selection: null, path: null, scrollTop: 0 }), subscribe: () => () => undefined, update: () => undefined }, fs: host.fs, layout: owner },
    navigation: { pickAsset: async () => { owner = { projectFolder: "Game/New" }; return { chosen: false }; } },
    resolveLayout: async () => owner,
  });
  try {
    await settleUntil(() => reads.includes("Game/Old/Bitmap/window.png"));
    reads.length = 0;
    const choose = [...root.querySelectorAll("button")].find((button) => button.textContent?.includes("window graphic"))!;
    await act(() => { choose.click(); });
    await settleUntil(() => reads.includes("Game/New/Bitmap/window.png"));
    equal(opened.document.getSnapshot().dirty, false, "a cancelled pick changes nothing");
  } finally {
    handle.dispose();
    root.remove();
  }
});

test("choosing the picture already named is a successful no-edit that adopts the picker's folders (#3536)", async () => {
  const path = "Misc/stone.tkrskin";
  const source = "contract: skin\nversion: 1.0.0-pre.1\nwindowImage: bitmap/window.png\nbuttonImage: bitmap/button.png\n";
  const pictures = Object.fromEntries(["Game/Old", "Game/New"].flatMap((folder) => ["window.png", "button.png"].map((name) => [`${folder}/Bitmap/${name}`, BMP_1X1])));
  const host = createMemoryPlatformServices({ files: { [path]: new TextEncoder().encode(source), ...pictures } });
  const opened = await openNativeSkinDocument(host.fs, createDocumentIdentity("memory-project", path));
  ok(opened.ok);
  const reads: string[] = [];
  const root = document.createElement("div");
  document.body.append(root);
  const handle = mount(root, {
    document: opened.document,
    services: { ...host, fs: recordingReader(host, reads) },
    browser: { session: { getSnapshot: () => ({ selection: null, path: null, scrollTop: 0 }), subscribe: () => () => undefined, update: () => undefined }, fs: host.fs, layout: { projectFolder: "Game/Old" } },
    navigation: { pickAsset: async () => ({ chosen: true, reference: "window.png", layout: { projectFolder: "Game/New" } }) },
  });
  try {
    await settleUntil(() => reads.includes("Game/Old/Bitmap/window.png"));
    reads.length = 0;
    const choose = [...root.querySelectorAll("button")].find((button) => button.textContent?.includes("window graphic"))!;
    await act(() => { choose.click(); });
    await settleUntil(() => reads.includes("Game/New/Bitmap/window.png"));
    equal(opened.document.getSnapshot().dirty, false, "the same picture is not an edit");
    equal(opened.document.getSnapshot().edits.length, 0);
    const spoken = [...root.querySelectorAll("main > p[role='status']")].map((node) => node.textContent ?? "");
    equal(spoken.some((text) => /did not change|invalid/i.test(text)), false, `no refusal is shown: ${spoken.join(" | ")}`);
  } finally {
    handle.dispose();
    root.remove();
  }
});
