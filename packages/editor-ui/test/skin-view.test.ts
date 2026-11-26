import { after, before, test } from "node:test";
import { deepEqual, equal, match, ok } from "node:assert/strict";
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

/** The picker handler has finished when the view no longer says it is choosing, so an assertion after it is not early. */
async function untilChosen(root: HTMLElement): Promise<void> {
  await settleUntil(() => !(root.textContent ?? "").includes("Choosing image…"));
}

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

/** A 2 × 1 24-bit BMP: two azure pixels, so a preview says which of two same-named pictures it drew. */
const BMP_2X1 = Uint8Array.from([
  0x42, 0x4d, 62, 0, 0, 0, 0, 0, 0, 0, 54, 0, 0, 0, 40, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 1, 0, 24, 0,
  0, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0,
]);

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
    await untilChosen(root);
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
    await untilChosen(root);
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

test("a late refresh answer cannot overwrite the folders a newer pick confirmed (#3536)", async () => {
  const path = "Misc/stone.tkrskin";
  const source = "contract: skin\nversion: 1.0.0-pre.1\nwindowImage: bitmap/window.png\nbuttonImage: bitmap/button.png\n";
  const pictures = Object.fromEntries(["Game/First", "Game/Third", "Game/Stale"].flatMap((folder) => ["window.png", "button.png"].map((name) => [`${folder}/Bitmap/${name}`, BMP_1X1])));
  const host = createMemoryPlatformServices({ files: { [path]: new TextEncoder().encode(source), ...pictures } });
  const opened = await openNativeSkinDocument(host.fs, createDocumentIdentity("memory-project", path));
  ok(opened.ok);
  const reads: string[] = [];
  let releaseRefresh!: (value: { projectFolder: string }) => void;
  let calls = 0;
  const slowRefresh = new Promise<{ projectFolder: string }>((resolve) => { releaseRefresh = resolve; });
  const root = document.createElement("div");
  document.body.append(root);
  const handle = mount(root, {
    document: opened.document,
    services: { ...host, fs: recordingReader(host, reads) },
    browser: { session: { getSnapshot: () => ({ selection: null, path: null, scrollTop: 0 }), subscribe: () => () => undefined, update: () => undefined }, fs: host.fs, layout: { projectFolder: "Game/First" } },
    navigation: { pickAsset: async () => ({ chosen: true, reference: "window.png", layout: { projectFolder: "Game/Third" } }) },
    // The mount's refresh is still reading when the picker confirms; every later question is answered at once.
    resolveLayout: () => { calls += 1; return calls === 1 ? slowRefresh : Promise.resolve({ projectFolder: "Game/Third" }); },
  });
  try {
    await settleUntil(() => calls >= 1 && reads.length >= 1);
    reads.length = 0;
    const choose = [...root.querySelectorAll("button")].find((button) => button.textContent?.includes("window graphic"))!;
    await act(() => { choose.click(); });
    await untilChosen(root);
    // The held answer finally arrives with folders read before the pick. It must not win.
    releaseRefresh({ projectFolder: "Game/Stale" });
    for (let turn = 0; turn < 20; turn += 1) {
      await act(async () => { await new Promise<void>((resolve) => { setImmediate(resolve); }); });
    }
    equal(reads.some((read) => read.startsWith("Game/Stale/")), false, `the stale answer never names the folders: ${reads.join(", ")}`);
    equal(reads.some((read) => read.startsWith("Game/First/")), false, `the pick's folders stand: ${reads.join(", ")}`);
    equal(opened.document.getSnapshot().skin.windowImage, "bitmap/window.png");
  } finally {
    handle.dispose();
    root.remove();
  }
});

test("the unchanged check asks the document at completion, not the render that opened the picker (#3536)", async () => {
  const path = "Misc/stone.tkrskin";
  const source = "contract: skin\nversion: 1.0.0-pre.1\nwindowImage: bitmap/window.png\nbuttonImage: bitmap/button.png\n";
  const pictures = Object.fromEntries(["window.png", "window-old.png", "button.png"].map((name) => [`Bitmap/${name}`, BMP_1X1]));
  const host = createMemoryPlatformServices({ files: { [path]: new TextEncoder().encode(source), ...pictures } });
  const opened = await openNativeSkinDocument(host.fs, createDocumentIdentity("memory-project", path));
  ok(opened.ok);
  let answer!: (outcome: { chosen: true; reference: string }) => void;
  const picked = new Promise<{ chosen: true; reference: string }>((resolve) => { answer = resolve; });
  const root = document.createElement("div");
  document.body.append(root);
  const handle = mount(root, {
    document: opened.document,
    services: host,
    browser: { session: { getSnapshot: () => ({ selection: null, path: null, scrollTop: 0 }), subscribe: () => () => undefined, update: () => undefined }, fs: host.fs, layout: { projectFolder: "" } },
    navigation: { pickAsset: () => picked },
  });
  try {
    // The field names an older picture when the picker opens...
    let firstId = "";
    await act(async () => {
      const first = opened.document.apply({ type: "set-native-skin-image", field: "windowImage", reference: "bitmap/window-old.png" });
      ok(first.ok);
      firstId = first.editId;
    });
    // The view shows the older picture now, so that is what the picker's render sees.
    await settleUntil(() => (root.textContent ?? "").includes("bitmap/window-old.png"));
    const choose = [...root.querySelectorAll("button")].find((button) => button.textContent?.includes("window graphic"))!;
    await act(() => { choose.click(); });
    // ...and while the picker is open that edit is undone, so the document names the picture the picker will return.
    ok(opened.document.undo(firstId).ok);
    answer({ chosen: true, reference: "window.png" });
    await untilChosen(root);
    await settleUntil(() => root.querySelectorAll("canvas").length === 2);
    equal(opened.document.getSnapshot().skin.windowImage, "bitmap/window.png");
    equal(opened.document.getSnapshot().edits.length, 0, "the picture the document already names is no edit");
    const spoken = [...root.querySelectorAll("main > p[role='status']")].map((node) => node.textContent ?? "");
    equal(spoken.some((text) => /did not change|invalid/i.test(text)), false, `no refusal is shown: ${spoken.join(" | ")}`);
  } finally {
    handle.dispose();
    root.remove();
  }
});

test("a refresh during the picker refuses a pick naming its older folders, whatever file the new folders hold (#3536)", async () => {
  const path = "Misc/stone.tkrskin";
  const source = "contract: skin\nversion: 1.0.0-pre.1\nwindowImage: bitmap/window.png\nbuttonImage: bitmap/button.png\n";
  // The pick names a picture the document does not have yet, so "no edit" can only mean the edit was blocked. Two
  // worlds: the new folders hold their own window-b.png of another size, or no window-b.png at all.
  for (const [label, holds] of [
    ["a same-named different picture", true],
    ["no same-named picture", false],
  ] as const) {
    const pictures: Record<string, Uint8Array> = {};
    for (const folder of ["Game/Start", "Game/Picked"]) for (const name of ["window.png", "window-b.png", "button.png"]) pictures[`${folder}/Bitmap/${name}`] = BMP_1X1;
    for (const name of ["window.png", "button.png"]) pictures[`Game/Refreshed/Bitmap/${name}`] = BMP_1X1;
    if (holds) pictures["Game/Refreshed/Bitmap/window-b.png"] = BMP_2X1;
    const host = createMemoryPlatformServices({ files: { [path]: new TextEncoder().encode(source), ...pictures } });
    const opened = await openNativeSkinDocument(host.fs, createDocumentIdentity("memory-project", path));
    ok(opened.ok);
    const reads: string[] = [];
    let owner = { projectFolder: "Game/Start" };
    let answer!: (outcome: { chosen: true; reference: string; layout: { projectFolder: string } }) => void;
    const picked = new Promise<{ chosen: true; reference: string; layout: { projectFolder: string } }>((resolve) => { answer = resolve; });
    const root = document.createElement("div");
    document.body.append(root);
    const handle = mount(root, {
      document: opened.document,
      services: { ...host, fs: recordingReader(host, reads) },
      browser: { session: { getSnapshot: () => ({ selection: null, path: null, scrollTop: 0 }), subscribe: () => () => undefined, update: () => undefined }, fs: host.fs, layout: { projectFolder: "Game/Start" } },
      navigation: { pickAsset: () => picked },
      resolveLayout: async () => owner,
    });
    try {
      await settleUntil(() => reads.includes("Game/Start/Bitmap/window.png"));
      const choose = [...root.querySelectorAll("button")].find((button) => button.textContent?.includes("window graphic"))!;
      await act(() => { choose.click(); });
      // A tab activation finds newer folders while the picker is open.
      owner = { projectFolder: "Game/Refreshed" };
      reads.length = 0;
      await act(() => { handle.refreshAssets?.(); });
      await settleUntil(() => reads.includes("Game/Refreshed/Bitmap/window.png"));
      // The picker confirms the different picture it read in the older folders: refused, never written.
      answer({ chosen: true, reference: "window-b.png", layout: { projectFolder: "Game/Picked" } });
      await untilChosen(root);
      equal(opened.document.getSnapshot().edits.length, 0, `${label}: the edit is blocked`);
      equal(opened.document.getSnapshot().dirty, false, `${label}: the draft is untouched`);
      equal(opened.document.getSnapshot().skin.windowImage, "bitmap/window.png", `${label}: the chosen reference is never written`);
      equal(reads.some((read) => read.startsWith("Game/Picked/")), false, `${label}: the picker's older folders are never read`);
      equal(reads.some((read) => read.endsWith("/window-b.png")), false, `${label}: the chosen picture is never read either`);
      const spoken = [...root.querySelectorAll("main > p[role='status']")].map((node) => node.textContent ?? "").join(" | ");
      match(spoken, /changed while the picker was open[^|]*choose the picture again/i, `${label}: the refusal says to choose again`);
    } finally {
      handle.dispose();
      root.remove();
    }
  }
});

test("an unrelated refresh does not block a valid pick (#3536)", async () => {
  const path = "Misc/stone.tkrskin";
  const source = "contract: skin\nversion: 1.0.0-pre.1\nwindowImage: bitmap/window.png\nbuttonImage: bitmap/button.png\n";
  const pictures = Object.fromEntries(["window.png", "window-b.png", "button.png"].map((name) => [`Bitmap/${name}`, BMP_1X1]));
  const host = createMemoryPlatformServices({ files: { [path]: new TextEncoder().encode(source), ...pictures } });
  const opened = await openNativeSkinDocument(host.fs, createDocumentIdentity("memory-project", path));
  ok(opened.ok);
  let answer!: (outcome: { chosen: true; reference: string; layout: { projectFolder: string } }) => void;
  const picked = new Promise<{ chosen: true; reference: string; layout: { projectFolder: string } }>((resolve) => { answer = resolve; });
  const root = document.createElement("div");
  document.body.append(root);
  const handle = mount(root, {
    document: opened.document,
    services: host,
    browser: { session: { getSnapshot: () => ({ selection: null, path: null, scrollTop: 0 }), subscribe: () => () => undefined, update: () => undefined }, fs: host.fs, layout: { projectFolder: "" } },
    navigation: { pickAsset: () => picked },
    // Every question answers the same folders: nothing about ownership changed.
    resolveLayout: async () => ({ projectFolder: "" }),
  });
  try {
    const choose = [...root.querySelectorAll("button")].find((button) => button.textContent?.includes("window graphic"))!;
    await act(() => { choose.click(); });
    // A tab activation while the picker is open, which finds the same folders.
    await act(() => { handle.refreshAssets?.(); });
    answer({ chosen: true, reference: "window-b.png", layout: { projectFolder: "" } });
    await untilChosen(root);
    equal(opened.document.getSnapshot().skin.windowImage, "bitmap/window-b.png", "the valid pick is written");
    equal(opened.document.getSnapshot().edits.length, 1);
    const spoken = [...root.querySelectorAll("main > p[role='status']")].map((node) => node.textContent ?? "").join(" | ");
    equal(/changed while the picker was open/i.test(spoken), false, `no refusal is shown: ${spoken}`);
  } finally {
    handle.dispose();
    root.remove();
  }
});

test("an ownership change with no refresh refuses the pick at confirmation (#3536)", async () => {
  const path = "Misc/stone.tkrskin";
  const source = "contract: skin\nversion: 1.0.0-pre.1\nwindowImage: bitmap/window.png\nbuttonImage: bitmap/button.png\n";
  const pictures = Object.fromEntries(["Game/Old", "Game/New"].flatMap((folder) => ["window.png", "window-b.png", "button.png"].map((name) => [`${folder}/Bitmap/${name}`, BMP_1X1])));
  const host = createMemoryPlatformServices({ files: { [path]: new TextEncoder().encode(source), ...pictures } });
  const opened = await openNativeSkinDocument(host.fs, createDocumentIdentity("memory-project", path));
  ok(opened.ok);
  const reads: string[] = [];
  let owner = { projectFolder: "Game/Old" };
  let answer!: (outcome: { chosen: true; reference: string; layout: { projectFolder: string } }) => void;
  const picked = new Promise<{ chosen: true; reference: string; layout: { projectFolder: string } }>((resolve) => { answer = resolve; });
  const root = document.createElement("div");
  document.body.append(root);
  const handle = mount(root, {
    document: opened.document,
    services: { ...host, fs: recordingReader(host, reads) },
    browser: { session: { getSnapshot: () => ({ selection: null, path: null, scrollTop: 0 }), subscribe: () => () => undefined, update: () => undefined }, fs: host.fs, layout: { projectFolder: "Game/Old" } },
    navigation: { pickAsset: () => picked },
    resolveLayout: async () => owner,
  });
  try {
    await settleUntil(() => reads.includes("Game/Old/Bitmap/window.png"));
    const choose = [...root.querySelectorAll("button")].find((button) => button.textContent?.includes("window graphic"))!;
    await act(() => { choose.click(); });
    // The game file moves the folders with no refresh at all; only the confirmation asks where they are.
    owner = { projectFolder: "Game/New" };
    answer({ chosen: true, reference: "window-b.png", layout: { projectFolder: "Game/Old" } });
    await untilChosen(root);
    equal(opened.document.getSnapshot().edits.length, 0, "the edit is blocked");
    equal(opened.document.getSnapshot().skin.windowImage, "bitmap/window.png");
    const spoken = [...root.querySelectorAll("main > p[role='status']")].map((node) => node.textContent ?? "").join(" | ");
    match(spoken, /changed while the picker was open[^|]*choose the picture again/i, "the refusal says to choose again");
    // The newer folders are the ones in force afterwards.
    await settleUntil(() => reads.includes("Game/New/Bitmap/window.png"));
  } finally {
    handle.dispose();
    root.remove();
  }
});

test("a confirmation's read that finishes after a newer refresh is discarded, not applied (#3536)", async () => {
  const path = "Misc/stone.tkrskin";
  const source = "contract: skin\nversion: 1.0.0-pre.1\nwindowImage: bitmap/window.png\nbuttonImage: bitmap/button.png\n";
  const pictures = Object.fromEntries(["Game/Start", "Game/Late", "Game/Newest"].flatMap((folder) => ["window.png", "window-b.png", "button.png"].map((name) => [`${folder}/Bitmap/${name}`, BMP_1X1])));
  const host = createMemoryPlatformServices({ files: { [path]: new TextEncoder().encode(source), ...pictures } });
  const opened = await openNativeSkinDocument(host.fs, createDocumentIdentity("memory-project", path));
  ok(opened.ok);
  const reads: string[] = [];
  let answer!: (outcome: { chosen: true; reference: string; layout: { projectFolder: string } }) => void;
  const picked = new Promise<{ chosen: true; reference: string; layout: { projectFolder: string } }>((resolve) => { answer = resolve; });
  let releaseLate!: (value: { projectFolder: string }) => void;
  const lateRead = new Promise<{ projectFolder: string }>((resolve) => { releaseLate = resolve; });
  // The mount reads Game/Start; the confirmation's read is held; a refresh during it answers Game/Newest; every later
  // read answers Game/Newest too.
  let calls = 0;
  const root = document.createElement("div");
  document.body.append(root);
  const handle = mount(root, {
    document: opened.document,
    services: { ...host, fs: recordingReader(host, reads) },
    browser: { session: { getSnapshot: () => ({ selection: null, path: null, scrollTop: 0 }), subscribe: () => () => undefined, update: () => undefined }, fs: host.fs, layout: { projectFolder: "Game/Start" } },
    navigation: { pickAsset: () => picked },
    resolveLayout: () => {
      calls += 1;
      if (calls === 1) return Promise.resolve({ projectFolder: "Game/Start" });
      if (calls === 2) return lateRead;
      return Promise.resolve({ projectFolder: "Game/Newest" });
    },
  });
  try {
    await settleUntil(() => reads.includes("Game/Start/Bitmap/window.png"));
    const choose = [...root.querySelectorAll("button")].find((button) => button.textContent?.includes("window graphic"))!;
    await act(() => { choose.click(); });
    answer({ chosen: true, reference: "window-b.png", layout: { projectFolder: "Game/Start" } });
    // The confirmation's read is in flight; a newer refresh completes with Game/Newest while it is.
    await settleUntil(() => calls >= 2);
    reads.length = 0;
    await act(() => { handle.refreshAssets?.(); });
    await settleUntil(() => reads.includes("Game/Newest/Bitmap/window.png"));
    // The held read now answers Game/Late, which is older than the refresh: it must be discarded and read again.
    releaseLate({ projectFolder: "Game/Late" });
    await untilChosen(root);
    equal(reads.some((read) => read.startsWith("Game/Late/")), false, `the late read never names the folders: ${reads.join(", ")}`);
    equal(opened.document.getSnapshot().edits.length, 0, "the pick is refused, not applied against stale folders");
    equal(opened.document.getSnapshot().skin.windowImage, "bitmap/window.png", "the chosen reference is never written");
    const spoken = [...root.querySelectorAll("main > p[role='status']")].map((node) => node.textContent ?? "").join(" | ");
    match(spoken, /choose the picture again/i, `the refusal says to choose again: ${spoken}`);
    // Serialization is bounded: a superseded read is retried a few times, never chased for ever.
    ok(calls <= 6, `the ownership reads were bounded: ${calls}`);
  } finally {
    handle.dispose();
    root.remove();
  }
});

test("two owner reads in flight together settle instead of chasing each other (#3536)", async () => {
  const path = "Misc/stone.tkrskin";
  const source = "contract: skin\nversion: 1.0.0-pre.1\nwindowImage: bitmap/window.png\nbuttonImage: bitmap/button.png\n";
  const pictures = Object.fromEntries(["window.png", "window-b.png", "button.png"].map((name) => [`Bitmap/${name}`, BMP_1X1]));
  const host = createMemoryPlatformServices({ files: { [path]: new TextEncoder().encode(source), ...pictures } });
  const opened = await openNativeSkinDocument(host.fs, createDocumentIdentity("memory-project", path));
  ok(opened.ok);
  // Every read is released by the start of the next one, so two are always in flight and each one's answer is superseded.
  let calls = 0;
  const waiting: ((value: { projectFolder: string }) => void)[] = [];
  const root = document.createElement("div");
  document.body.append(root);
  const handle = mount(root, {
    document: opened.document,
    services: host,
    browser: { session: { getSnapshot: () => ({ selection: null, path: null, scrollTop: 0 }), subscribe: () => () => undefined, update: () => undefined }, fs: host.fs, layout: { projectFolder: "" } },
    navigation: { pickAsset: async () => ({ chosen: true, reference: "window-b.png", layout: { projectFolder: "" } }) },
    resolveLayout: () => {
      calls += 1;
      // Starting a read releases the one before it, and every read also answers on the next turn, so the two overlap
      // without any read being left waiting for a caller that never comes.
      if (waiting.length > 0) waiting.shift()!({ projectFolder: "Game/Churn" });
      return new Promise((resolve) => {
        waiting.push(resolve);
        setImmediate(() => {
          const index = waiting.indexOf(resolve);
          if (index < 0) return;
          waiting.splice(index, 1);
          resolve({ projectFolder: "Game/Churn" });
        });
      });
    },
  });
  try {
    const choose = [...root.querySelectorAll("button")].find((button) => button.textContent?.includes("window graphic"))!;
    await act(() => { choose.click(); });
    await untilChosen(root);
    // The reads give up in bounded numbers and the pick is refused, never applied against folders nobody could confirm.
    ok(calls <= 20, `the reads were bounded: ${calls}`);
    equal(opened.document.getSnapshot().edits.length, 0, "nothing is written");
    equal(opened.document.getSnapshot().skin.windowImage, "bitmap/window.png");
    const spoken = [...root.querySelectorAll("main > p[role='status']")].map((node) => node.textContent ?? "").join(" | ");
    match(spoken, /choose the picture again/i, `the refusal says to choose again: ${spoken}`);
  } finally {
    for (const resolve of waiting.splice(0)) resolve({ projectFolder: "" });
    handle.dispose();
    root.remove();
  }
});
