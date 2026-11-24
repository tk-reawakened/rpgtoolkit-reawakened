// Board clipboard (story 13.13, T-28) in the real view over the in-memory host clipboard: the labelled buttons and the
// Ctrl+C / Ctrl+X / Ctrl+V / Ctrl+A keys copy, cut and paste regions and whole objects as undoable edits, cutting objects
// asks first, and a host without a clipboard, a partial set of points and the lights mode are refused without a change.
import { after, before, test } from "node:test";
import { deepEqual, equal, match, ok } from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  boardTileAt,
  buildNewBoard,
  createBoardDocument,
  createDocumentIdentity,
  parseClip,
  previewBoard,
  type BoardDocument,
} from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices, type MemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { createBrowserSession } from "../dist/brush.js";
import type { BoardViewDocument, ViewHandle } from "../src/mount.ts";
import type { mount as MountFn } from "../src/index.ts";

const PATH = "Boards/map.brd";
const GRASS = "village.tst1";

/** A stored vector on layer 1 with the given outline. */
const vector = (points: readonly { x: number; y: number }[]) => ({ points: points.map(({ x, y }) => ({ x, y })), attributes: 0, closed: -1, layer: 1, type: 1, handle: "" });

let mount: typeof MountFn;
let act: (callback: () => void | Promise<void>) => Promise<void> | void;

before(async () => {
  GlobalRegistrator.register();
  ({ act } = await import("preact/test-utils"));
  ({ mount } = await import("@tk-reawakened/editor-ui"));
});

after(() => GlobalRegistrator.unregister());

interface Setup {
  readonly host: MemoryPlatformServices;
  readonly doc: BoardDocument;
  readonly el: HTMLElement;
  dispose(): void;
}

const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 8; turn += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
  }
};

async function setup(withClipboard = true): Promise<Setup> {
  const built = buildNewBoard({ name: "map", coordSystem: "2d", pixelCoordinates: false, width: 8, height: 8, layers: 2, backgroundImage: "", template: null });
  if (!built.ok) throw new Error(built.message);
  const host = createMemoryPlatformServices({ files: { [PATH]: built.bytes }, ...(withClipboard ? { capabilities: ["clipboard" as const] } : {}) });
  const opened = createBoardDocument(host.fs, createDocumentIdentity("memory-project", PATH), built.bytes);
  if (!opened.ok) throw new Error(JSON.stringify(opened.error));
  const doc = opened.document;
  const view: BoardViewDocument = {
    kind: doc.kind,
    identity: doc.identity,
    getSnapshot: () => doc.getSnapshot(),
    subscribe: (listener) => doc.subscribe(listener),
    apply: (command) => doc.apply(command),
    save: () => doc.save(),
    resolveConflict: (choice) => doc.resolveConflict(choice),
    preview: async (request) => {
      const preview = await previewBoard(host.fs, "memory-project", doc.serialize(), request);
      return preview.ok ? { ok: true, width: preview.width, height: preview.height, rgba: preview.rgba, warnings: preview.warnings, objectBounds: preview.objectBounds } : preview;
    },
    undo: () => doc.undo(),
    redo: () => doc.redo(),
  };
  const el = document.createElement("div");
  document.body.append(el);
  let handle: ViewHandle | undefined;
  await act(() => {
    handle = mount(el, { document: view, services: host, browser: { session: createBrowserSession(), fs: host.fs, layout: { projectFolder: "" } } });
  });
  await settle();
  return { host, doc, el, dispose: () => handle?.dispose() };
}

const button = (s: Setup, selector: string): HTMLButtonElement => {
  const found = s.el.querySelector<HTMLButtonElement>(selector);
  if (found === null) throw new Error(`no ${selector}`);
  return found;
};
const press = async (s: Setup, init: KeyboardEventInit): Promise<void> => {
  await act(() => { s.el.querySelector(".tkr-board-brush-state, .tkr-board-note")!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });
  await settle();
};
const message = (s: Setup): string => s.el.querySelector(".tkr-board-message")?.textContent ?? "";
const mode = async (s: Setup, name: string): Promise<void> => { await act(() => button(s, `[data-board-mode="${name}"]`).click()); await settle(); };

test("the board has labelled Copy, Cut, Paste and Select all actions with their shortcuts", async () => {
  const s = await setup();
  for (const [selector, shortcut] of [[".tkr-board-clipboard-copy", "Control+C"], [".tkr-board-clipboard-cut", "Control+X"], [".tkr-board-clipboard-paste", "Control+V"], [".tkr-board-select-all", "Control+A"]] as const) {
    equal(button(s, selector).getAttribute("aria-keyshortcuts"), shortcut);
  }
  s.dispose();
});

test("keys and buttons copy a region and paste it on another layer as one undoable edit", async () => {
  const s = await setup();
  ok((await s.doc.apply({ type: "set-tiles", gesture: "draw", cells: [{ layer: 0, x: 0, y: 0, tile: GRASS }] })).ok);
  await settle();
  await press(s, { key: "a", ctrlKey: true });
  await press(s, { key: "c", ctrlKey: true });
  const clip = parseClip(s.host.clipboardText);
  ok(clip.ok && clip.value.kind === "region");
  const layer = s.el.querySelector<HTMLSelectElement>("select");
  ok(layer);
  await act(() => { layer.value = "1"; layer.dispatchEvent(new Event("change", { bubbles: true })); });
  await settle();
  const before = s.doc.getSnapshot().edits.length;
  await press(s, { key: "v", ctrlKey: true });
  equal(s.doc.getSnapshot().edits.length, before + 1);
  equal(boardTileAt(s.doc.getSnapshot(), 1, 0, 0), GRASS);
  await act(() => button(s, ".tkr-board-undo").click());
  await settle();
  equal(boardTileAt(s.doc.getSnapshot(), 1, 0, 0), "");
  await act(() => button(s, ".tkr-board-redo").click());
  await settle();
  equal(boardTileAt(s.doc.getSnapshot(), 1, 0, 0), GRASS);
  s.dispose();
});

test("cutting whole objects asks first; Cancel changes nothing and Cut and renumber removes them and can be undone", async () => {
  const s = await setup();
  const points = [{ x: 32, y: 32 }, { x: 96, y: 32 }, { x: 96, y: 96 }];
  ok((await s.doc.apply({ type: "set-board-fields", fields: { vectors: [vector(points), vector(points)] } })).ok);
  await mode(s, "vectors");
  await act(() => button(s, ".tkr-board-select-all").click());
  s.host.clipboardText = "sentinel";
  const bytes = s.doc.serialize();
  await act(() => button(s, ".tkr-board-clipboard-cut").click());
  await settle();
  const dialog = s.el.querySelector<HTMLDialogElement>('dialog[aria-labelledby$="-cut-title"]');
  ok(dialog);
  ok(dialog.hasAttribute("open"));
  match(dialog.textContent ?? "", /Cut 2 vectors\?/);
  await act(() => dialog.querySelector<HTMLButtonElement>('button[value="cancel"]')!.click());
  await settle();
  equal(s.el.querySelector('dialog[aria-labelledby$="-cut-title"]'), null, "cancelling closes the question");
  deepEqual(s.doc.serialize(), bytes);
  equal(s.host.clipboardText, "sentinel");
  await act(() => button(s, ".tkr-board-clipboard-cut").click());
  await settle();
  await act(() => button(s, ".tkr-board-cut-confirm").click());
  await settle();
  equal(s.doc.getSnapshot().vectors.length, 0);
  const clip = parseClip(s.host.clipboardText);
  ok(clip.ok && clip.value.kind === "objects" && clip.value.objects.length === 2);
  await act(() => button(s, ".tkr-board-undo").click());
  await settle();
  deepEqual(s.doc.serialize(), bytes);
  s.dispose();
});

test("a partial set of points is refused with a message and the board and clipboard stay as they were", async () => {
  const s = await setup();
  const points = [{ x: 32, y: 32 }, { x: 96, y: 32 }, { x: 96, y: 96 }];
  ok((await s.doc.apply({ type: "set-board-fields", fields: { vectors: [vector(points)] } })).ok);
  await mode(s, "vectors");
  await act(() => button(s, ".tkr-board-select-all").click());
  await act(() => { s.el.querySelector<HTMLInputElement>('[aria-label="Select point 1"]')!.click(); });
  await settle();
  s.host.clipboardText = "sentinel";
  const bytes = s.doc.serialize();
  await act(() => button(s, ".tkr-board-clipboard-copy").click());
  await settle();
  match(message(s), /partial set of points/);
  equal(s.host.clipboardText, "sentinel");
  deepEqual(s.doc.serialize(), bytes);
  s.dispose();
});

test("while lights are being worked on, copy, cut and paste are refused and nothing changes", async () => {
  const s = await setup();
  const move = [...s.el.querySelectorAll<HTMLButtonElement>("button")].find((entry) => entry.textContent === "Move lights on the board");
  ok(move);
  await act(() => move.click());
  await settle();
  s.host.clipboardText = "sentinel";
  const bytes = s.doc.serialize();
  for (const selector of [".tkr-board-clipboard-copy", ".tkr-board-clipboard-cut", ".tkr-board-clipboard-paste"]) {
    await act(() => button(s, selector).click());
    await settle();
    match(message(s), /Lights cannot be/);
  }
  equal(s.host.clipboardText, "sentinel");
  deepEqual(s.doc.serialize(), bytes);
  s.dispose();
});

test("a host without a clipboard says so instead of keeping a private copy", async () => {
  const s = await setup(false);
  const bytes = s.doc.serialize();
  await act(() => button(s, ".tkr-board-select-all").click());
  await act(() => button(s, ".tkr-board-clipboard-copy").click());
  await settle();
  match(message(s), /cannot reach the system clipboard/);
  await act(() => button(s, ".tkr-board-clipboard-paste").click());
  await settle();
  match(message(s), /cannot reach the system clipboard/);
  deepEqual(s.doc.serialize(), bytes);
  s.dispose();
});
