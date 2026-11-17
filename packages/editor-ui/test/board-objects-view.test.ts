import { after, afterEach, before, test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { buildNewBoard, createBoardDocument, createDocumentIdentity, createPendingEdits, type BoardCoordSystem, type BoardDocument, type SetBoardFieldsCommand } from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import type { BoardImage, BoardVector } from "@tk-reawakened/core";
import type { BoardViewDocument } from "../src/mount.ts";

const PATH = "Boards/objects.brd";
let BoardObjectsView: typeof import("../dist/board-objects-view.js").BoardObjectsView;
let act: (callback: () => void | Promise<void>) => Promise<void> | void;
let createElement: typeof import("preact").createElement;
let render: typeof import("preact").render;

const cleanups: Array<() => void> = [];

afterEach(async () => {
  await act(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
});
before(async () => {
  GlobalRegistrator.register();
  ({ act } = await import("preact/test-utils"));
  ({ createElement, render } = await import("preact"));
  ({ BoardObjectsView } = await import("../dist/board-objects-view.js"));
});

after(() => GlobalRegistrator.unregister());

interface Setup {
  readonly doc: BoardDocument;
  readonly root: HTMLElement;
  readonly view: BoardViewDocument;
  readonly pendingEdits: ReturnType<typeof createPendingEdits>;
  savedBytes(): Uint8Array | undefined;
  renderView(mode: "vectors" | "programs" | "sprites" | "images", selected: number | null, navigation?: { open(path: string): Promise<string | null>; pickAsset(kind: "program" | "sprite" | "image", current: string): Promise<string | null> }): void;
}

async function setup(mode: "vectors" | "programs" | "sprites" | "images" = "vectors", selected: number | null = 0, coordSystem: BoardCoordSystem = "2d"): Promise<Setup> {
  const built = buildNewBoard({ name: "objects", coordSystem, pixelCoordinates: false, width: 4, height: 3, layers: 2, backgroundImage: "", template: null });
  if (!built.ok) throw new Error(built.message);
  const host = createMemoryPlatformServices({ files: { [PATH]: built.bytes } });
  const opened = createBoardDocument(host.fs, createDocumentIdentity("memory-project", PATH), built.bytes);
  if (!opened.ok) throw new Error(JSON.stringify(opened.error));
  const doc = opened.document;
  const points = [{ x: 1, y: 2 }, { x: 3, y: 4 }];
  const position = coordSystem === "iso-stacked" ? { x: 96, y: 32 } : coordSystem === "iso-rotated" ? { x: 96, y: 0 } : { x: 16, y: 31 };
  const initial = await doc.apply({ type: "set-board-fields", fields: {
    vectors: [{ points, attributes: 8, closed: -1, layer: 1, type: 2, handle: "reserved-handle" }],
    programs: [{ program: "sample.prg", graphic: "reserved-graphic", initialVar: "", initialValue: "", finalVar: "", finalValue: "", activate: 0, activationType: 0, repeatDistance: 0, layer: 1, points, closed: -1, handle: "reserved-handle" }],
    sprites: [{ itemFile: "sample.itm", activationPrg: "", multitaskPrg: "", initialVar: "", initialValue: "", finalVar: "", finalValue: "", loadingVar: "", loadingValue: "", activate: 0, activationType: 0, ...position, layer: 1, reserved: -1 }],
    images: [{ file: "sample.png", left: 4, top: 5, layer: 1, drawType: 1, transparent: { r: 2, g: 3, b: 4 }, reserved: 75 }],
  } });
  if (!initial.ok) throw new Error(initial.rejection.message);
  ok((await doc.save()).ok);
  const pendingEdits = createPendingEdits();
  const view: BoardViewDocument = {
    kind: doc.kind, identity: doc.identity, getSnapshot: () => doc.getSnapshot(), subscribe: (listener) => doc.subscribe(listener),
    apply: (command) => doc.apply(command), save: () => doc.save(), resolveConflict: (choice) => doc.resolveConflict(choice),
    preview: async () => ({ ok: false, code: "not-supported", message: "not used" }), undo: () => doc.undo(), redo: () => doc.redo(),
  };
  const root = document.createElement("div");
  document.body.append(root);
  let activeMode = mode;
  let activeSelected = selected;
  let activeNavigation: Parameters<Setup["renderView"]>[2];
  const renderView = (nextMode: typeof mode, index: number | null, navigation?: { open(path: string): Promise<string | null>; pickAsset(kind: "program" | "sprite" | "image", current: string): Promise<string | null> }): void => {
    activeMode = nextMode;
    activeSelected = index;
    activeNavigation = navigation;
    const snapshot = doc.getSnapshot();
    render(createElement(BoardObjectsView, {
      doc: view, snapshot, mode: nextMode, selection: index === null ? null : { kind: nextMode, index }, pointSelection: [], disabled: false, pendingEdits,
      onEdited: () => undefined, onSelect: (selected) => renderView(activeMode, selected, activeNavigation), onSelectPoints: () => undefined, onCreate: async () => true,
      onReturnToDraft: (selection) => renderView(selection.kind, selection.index, activeNavigation),
      onDelete: async () => {
        if (activeSelected === null) return false;
        const fields = { [activeMode]: doc.getSnapshot()[activeMode].filter((_, index) => index !== activeSelected) } as SetBoardFieldsCommand["fields"];
        const result = doc.apply({ type: "set-board-fields", fields });
        if (result.ok) renderView(activeMode, null, activeNavigation);
        return result.ok;
      },
      onReorder: async () => true, onPickTransparent: () => undefined, ...(navigation === undefined ? {} : { navigation }),
    }), root);
  };
  const unsubscribe = doc.subscribe(() => renderView(activeMode, activeSelected, activeNavigation));
  cleanups.push(() => { unsubscribe(); render(null, root); root.remove(); });
  await act(() => renderView(mode, selected));
  return { doc, root, renderView, view, pendingEdits, savedBytes: () => host.bytesOf(PATH) };
}

async function input(root: HTMLElement, label: string, value: string): Promise<void> {
  await act(() => {
    const field = root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
    if (!field) throw new Error(`missing input: ${label}`);
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(root: HTMLElement, label: string): Promise<void> {
  await act(async () => {
    const button = [...root.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label);
    if (!button) throw new Error(`missing button: ${label}`);
    button.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

test("vector inspector applies numeric points and preserves loaded raw fields", async () => {
  const s = await setup();
  const original = s.doc.getSnapshot().vectors[0] as BoardVector;
  await input(s.root, "Point 1 X", "37");
  await input(s.root, "Handle", "entry");
  await click(s.root, "Apply");
  const saved = s.doc.getSnapshot().vectors[0] as BoardVector;
  equal(saved.points[0]?.x, 37);
  equal(saved.handle, "entry");
  equal(saved.closed, original.closed);
  equal(saved.attributes, original.attributes);
});

test("a refused apply reports the refusal and keeps the edited draft", async () => {
  const s = await setup();
  await input(s.root, "Point 1 X", "2147483648");
  await click(s.root, "Apply");
  ok(s.root.querySelector('[role="status"]')?.textContent);
  equal(s.root.querySelector<HTMLInputElement>('[aria-label="Point 1 X"]')?.value, "2147483648");
  equal(s.doc.getSnapshot().vectors[0]?.points[0]?.x, 1);
});

test("cancelled asset choice leaves the image draft and document unchanged", async () => {
  const s = await setup("images");
  const before = s.doc.getSnapshot().images[0] as BoardImage;
  const bytes = s.doc.serialize();
  let picks = 0;
  const navigation = { open: async () => null, pickAsset: async () => { picks += 1; return null; } };
  s.renderView("images", 0, navigation);
  await click(s.root, "Choose image");
  equal(picks, 1);
  equal(s.root.querySelector<HTMLInputElement>('[aria-label="Image file"]')?.value, before.file);
  deepEqual(s.doc.getSnapshot().images[0], before);
  deepEqual(s.doc.serialize(), bytes);
  equal(s.doc.getSnapshot().dirty, false);
});
test("cancelled slot-removal confirmation preserves the saved board", async () => {
  const s = await setup();
  const bytes = s.doc.serialize();
  await click(s.root, "Remove slot and renumber");
  const cancel = s.root.querySelector<HTMLButtonElement>('dialog button[value="cancel"]');
  ok(cancel);
  await act(() => cancel.click());
  deepEqual(s.doc.serialize(), bytes);
  equal(s.doc.getSnapshot().dirty, false);
});
test("run-once condition uses the native UUID source and persists both condition variables", async () => {
  const s = await setup("programs");
  const original = globalThis.crypto.randomUUID;
  const uuid = "12345678-1234-4234-8234-123456789abc";
  Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: () => uuid });
  try {
    await click(s.root, "Run once");
    await click(s.root, "Apply");
    const saved = s.doc.getSnapshot().programs[0]!;
    equal(saved.initialVar, uuid.replaceAll("-", ""));
    equal(saved.initialValue, "");
    equal(saved.finalVar, uuid.replaceAll("-", ""));
    equal(saved.finalValue, "_guid");
    equal(saved.activate, 1);
  } finally {
    Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: original });
  }
});
test("toggling one under-vector flag keeps unrelated attribute bits", async () => {
  const s = await setup();
  await act(() => {
    const field = s.root.querySelector<HTMLInputElement>('input[aria-label="All lower layers"]');
    if (!field) throw new Error("missing under-vector flag");
    field.checked = true;
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await click(s.root, "Apply");
  equal(s.doc.getSnapshot().vectors[0]?.attributes, 10);
});
test("sprite tile coordinates use the stored bottom-centre base point", async () => {
  const s = await setup("sprites");
  await act(() => {
    const field = s.root.querySelector<HTMLSelectElement>('select[aria-label="Position units"]');
    if (!field) throw new Error("missing sprite position units");
    field.value = "tiles";
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await input(s.root, "X tile", "2");
  await click(s.root, "Apply");
  equal(s.doc.getSnapshot().sprites[0]?.x, 48);
  equal(s.doc.getSnapshot().sprites[0]?.y, 31);
});

test("an unapplied draft survives selecting another object kind without rendering it as the wrong record", async () => {
  const s = await setup();
  const bytes = s.doc.serialize();
  await input(s.root, "Handle", "unapplied");
  await act(() => s.renderView("images", 0));
  equal(s.root.querySelector('[aria-label="Image file"]'), null);
  await click(s.root, "Return to draft");
  equal(s.root.querySelector<HTMLInputElement>('[aria-label="Handle"]')?.value, "unapplied");
  await act(() => s.renderView("images", 0));
  await click(s.root, "Discard draft");
  equal(s.root.querySelector<HTMLInputElement>('[aria-label="Image file"]')?.value, "sample.png");
  deepEqual(s.doc.serialize(), bytes);
  equal(s.doc.getSnapshot().dirty, false);
});

for (const [layout, field, value, expected] of [
  ["iso-stacked", "Y tile", "4", { x: 64, y: 48 }],
  ["iso-rotated", "X tile", "3", { x: 128, y: 16 }],
] as const) {
  test(`${layout} tile position edits update both stored pixel axes`, async () => {
    const s = await setup("sprites", 0, layout);
    await act(() => {
      const units = s.root.querySelector<HTMLSelectElement>('[aria-label="Position units"]');
      ok(units);
      units.value = "tiles";
      units.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await input(s.root, field, value);
    await click(s.root, "Apply");
    const sprite = s.doc.getSnapshot().sprites[0]!;
    deepEqual({ x: sprite.x, y: sprite.y }, expected);
  });
}

test("immediate Save waits for the inspector acknowledgement and writes the accepted record", async () => {
  const s = await setup();
  let acknowledge: (() => void) | null = null;
  s.view.apply = (command) => new Promise((resolve) => {
    acknowledge = () => resolve(s.doc.apply(command));
  });
  await input(s.root, "Handle", "saved after acknowledgement");
  await act(() => {
    const apply = [...s.root.querySelectorAll("button")].find((button) => button.textContent === "Apply");
    ok(apply);
    apply.click();
  });
  let saved = false;
  const save = s.pendingEdits.settle().then(() => s.doc.save()).then((result) => { ok(result.ok); saved = true; });
  // Let the in-memory save drain its microtasks without acknowledging the edit.
  await new Promise<void>((resolve) => setImmediate(resolve));
  equal(saved, false);
  ok(acknowledge !== null);
  await act(async () => { acknowledge!(); await save; });
  const bytes = s.savedBytes();
  ok(bytes !== undefined);
  const reopenedHost = createMemoryPlatformServices({ files: { [PATH]: bytes } });
  const reopened = createBoardDocument(reopenedHost.fs, s.doc.identity, bytes);
  ok(reopened.ok);
  equal(reopened.document.getSnapshot().vectors[0]!.handle, "saved after acknowledgement");
});
