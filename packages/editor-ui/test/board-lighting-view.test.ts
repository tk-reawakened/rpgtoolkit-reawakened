import { after, before, test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  buildNewBoard,
  createBoardDocument,
  createDocumentIdentity,
  createPendingEdits,
  previewBoard,
  type BoardDocument,
} from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import type { BoardViewDocument } from "../src/mount.ts";

const PATH = "Boards/lighting.brd";
// A static component import would initialize Preact before happy-dom supplies its browser environment.
let BoardLightingView: typeof import("../src/board-lighting-view.tsx").BoardLightingView;
let INITIAL_SHADE_UI: typeof import("../src/board-lighting-view.tsx").INITIAL_SHADE_UI;
type ShadeUi = import("../src/board-lighting-view.tsx").ShadeUi;
let useBoardSubmit: typeof import("../src/use-board-submit.ts").useBoardSubmit;
let useState: typeof import("preact/hooks").useState;
let act: (callback: () => void | Promise<void>) => Promise<void> | void;
let createElement: typeof import("preact").createElement;
let render: typeof import("preact").render;

before(async () => {
  GlobalRegistrator.register();
  ({ act } = await import("preact/test-utils"));
  ({ createElement, render } = await import("preact"));
  ({ BoardLightingView, INITIAL_SHADE_UI } = await import("../dist/board-lighting-view.js"));
  ({ useBoardSubmit } = await import("../dist/use-board-submit.js"));
  ({ useState } = await import("preact/hooks"));
});

after(() => GlobalRegistrator.unregister());

interface Setup {
  readonly host: ReturnType<typeof createMemoryPlatformServices>;
  readonly doc: BoardDocument;
  readonly root: HTMLElement;
  renderView(): void;
}

let Harness: () => preact.JSX.Element;

async function setup(): Promise<Setup> {
  const built = buildNewBoard({ name: "lighting", coordSystem: "2d", pixelCoordinates: false, width: 4, height: 3, layers: 2, backgroundImage: "", template: null });
  if (!built.ok) throw new Error(built.message);
  const host = createMemoryPlatformServices({ files: { [PATH]: built.bytes } });
  const opened = createBoardDocument(host.fs, createDocumentIdentity("memory-project", PATH), built.bytes);
  if (!opened.ok) throw new Error(JSON.stringify(opened.error));
  const doc = opened.document;
  const pendingEdits = createPendingEdits();
  const view: BoardViewDocument = {
    kind: doc.kind,
    identity: doc.identity,
    getSnapshot: () => doc.getSnapshot(),
    subscribe: (listener) => doc.subscribe(listener),
    apply: (command) => doc.apply(command),
    save: () => doc.save(),
    resolveConflict: (choice) => doc.resolveConflict(choice),
    preview: async (request) => {
      const picture = await previewBoard(host.fs, "memory-project", doc.serialize(), request);
      return picture.ok ? { ok: true, width: picture.width, height: picture.height, rgba: picture.rgba, warnings: picture.warnings, objectBounds: picture.objectBounds } : picture;
    },
    undo: () => doc.undo(),
    redo: () => doc.redo(),
  };
  const root = document.createElement("div");
  document.body.append(root);
  Harness = () => {
    const [ui, setUi] = useState<ShadeUi>(INITIAL_SHADE_UI);
    const board = useBoardSubmit(view, () => undefined, pendingEdits, "Edit lights and shading");
    return createElement(BoardLightingView, { doc: view, disabled: false, ui, onUi: setUi, board }) as preact.JSX.Element;
  };
  const renderView = (): void => {
    render(createElement(Harness, {}), root);
  };
  await act(() => renderView());
  return { host, doc, root, renderView };
}

function input(root: HTMLElement, label: string): HTMLInputElement {
  const found = root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (found === null) throw new Error(`missing input ${label}`);
  return found;
}

async function editInput(root: HTMLElement, label: string, value: string): Promise<void> {
  await act(() => {
    const field = input(root, label);
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(root: HTMLElement, label: string): Promise<void> {
  await act(async () => {
    const button = [...root.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label);
    if (button === undefined) throw new Error(`missing button ${label}`);
    button.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function change(root: HTMLElement, label: string, value: string): Promise<void> {
  await act(async () => {
    const field = input(root, label);
    field.value = value;
    field.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

const CONVERT = "Convert to shading…";

function review(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>(".tkr-board-light-review");
}

async function press(root: HTMLElement, label: string): Promise<void> {
  await act(async () => {
    const button = [...root.querySelectorAll("button")].find((candidate) => candidate.getAttribute("aria-label") === label || candidate.textContent?.trim() === label);
    if (button === undefined) throw new Error(`missing button ${label}`);
    button.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** What a cancelled review must leave exactly as it was: the saved-format bytes, the stored light and shading, the unsaved flag and the undo stack. */
function fingerprint(doc: BoardDocument): string {
  const snapshot = doc.getSnapshot();
  return JSON.stringify({ bytes: Array.from(doc.serialize()), lights: snapshot.lights, shadeLayers: snapshot.shadeLayers, dirty: snapshot.dirty, edits: snapshot.edits.length });
}

test("adding a spotlight, moving its centre and converting it to shading are each one undoable edit", async () => {
  const s = await setup();
  await click(s.root, "Add spotlight");
  equal(s.doc.getSnapshot().lights.length, 1);
  deepEqual(s.doc.getSnapshot().lights[0]?.nodes[1], { x: 64, y: 48 });
  await change(s.root, "Light 1 Centre X (pixels)", "80");
  deepEqual(s.doc.getSnapshot().lights[0]?.nodes[1], { x: 80, y: 48 });
  const before = s.doc.getSnapshot();
  await click(s.root, CONVERT);
  await click(s.root, "Apply conversion");
  equal(s.doc.getSnapshot().lights.length, 0);
  ok(s.doc.getSnapshot().shadeLayers.length >= 1);
  equal(s.doc.getSnapshot().edits.length, before.edits.length + 1, "Apply is exactly one edit");
  ok(s.doc.undo().ok);
  equal(s.doc.getSnapshot().lights.length, 1, "one undo brings the editable light back");
  deepEqual(s.doc.getSnapshot().lights, before.lights, "exactly the light that was reviewed");
  deepEqual(s.doc.getSnapshot().shadeLayers, before.shadeLayers);
});

test("Convert only opens a review: nothing is stored, the other controls pause, and the review names what Apply would do", async () => {
  const s = await setup();
  await click(s.root, "Add spotlight");
  const before = fingerprint(s.doc);
  await click(s.root, CONVERT);
  const open = review(s.root);
  ok(open !== null, "a review step is shown");
  equal(open.getAttribute("role"), "group");
  equal(open.querySelector("h3")?.textContent, "Convert Light 1 to shading?");
  ok(/adds shade to \d+ of the 12 shade cells/.test(open.textContent ?? ""), "the review counts the cells it changes");
  ok(/Cancel, or Escape, changes nothing/.test(open.textContent ?? ""));
  equal(fingerprint(s.doc), before, "looking at the conversion stores nothing");
  equal(input(s.root, "Light 1 Centre X (pixels)").disabled, true, "other controls pause while reviewing");
  const named = [...s.root.querySelectorAll("button")].filter((button) => button.closest(".tkr-board-light-review") !== null);
  deepEqual(named.map((button) => button.getAttribute("aria-label")), ["Cancel converting Light 1", "Apply conversion of Light 1 to shading"]);
  equal(document.activeElement, named[0], "focus starts on Cancel, the safe choice");
});

test("Cancel, Escape and a stale review change nothing and leave the editable light exactly as it was", async () => {
  const s = await setup();
  await click(s.root, "Add gradient");
  await change(s.root, "Light 1 Shade at end Red", "120");
  const before = fingerprint(s.doc);

  await click(s.root, CONVERT);
  await press(s.root, "Cancel converting Light 1");
  equal(review(s.root), null);
  equal(fingerprint(s.doc), before, "Cancel: bytes, light, shading, dirty state and undo stack are unchanged");
  equal(document.activeElement?.getAttribute("data-light-convert"), "0", "focus returns to the Convert button");
  equal(input(s.root, "Light 1 Start X (pixels)").disabled, false, "the controls work again");

  await click(s.root, CONVERT);
  await act(() => { review(s.root)!.querySelector("button")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  equal(review(s.root), null, "Escape closes the review");
  equal(fingerprint(s.doc), before, "Escape changes nothing");

  // The light changes underneath the open review (an undo, a canvas drag): the review closes and converts nothing.
  await click(s.root, CONVERT);
  await act(async () => { ok((await s.doc.apply({ type: "set-board-fields", fields: { lights: [{ ...s.doc.getSnapshot().lights[0]!, colours: [{ r: 1, g: 2, b: 3 }, { r: 4, g: 5, b: 6 }] }] } })).ok); });
  equal(review(s.root), null);
  ok(/nothing was converted/.test(s.root.querySelector('[role="alert"]')?.textContent ?? ""));
  equal(s.doc.getSnapshot().lights.length, 1, "the light is still there");
  deepEqual(s.doc.getSnapshot().lights[0]?.colours, [{ r: 1, g: 2, b: 3 }, { r: 4, g: 5, b: 6 }], "the light is the externally edited one, not a baked one");
});

test("a refused Convert explains itself, opens no review and changes nothing", async () => {
  const s = await setup();
  await click(s.root, "Add spotlight");
  const two = await s.doc.apply({ type: "set-board-fields", fields: { shadeLayers: [{ castLayer: 1, records: [{ runCount: 12, r: 0, g: 0, b: 0 }] }, { castLayer: 2, records: [{ runCount: 12, r: 0, g: 0, b: 0 }] }] } });
  ok(two.ok, JSON.stringify(two));
  await act(() => s.renderView());
  const before = fingerprint(s.doc);
  await click(s.root, CONVERT);
  equal(review(s.root), null);
  ok(/more than one shading layer/.test(s.root.querySelector('[role="alert"]')?.textContent ?? ""));
  equal(fingerprint(s.doc), before);
});

test("Apply after a failed save keeps the applied conversion and its dirty state, and a later save writes it", async () => {
  const s = await setup();
  await click(s.root, "Add spotlight");
  ok((await s.doc.save()).ok);
  const saved = Array.from(s.host.bytesOf(PATH)!);
  await click(s.root, CONVERT);
  await click(s.root, "Apply conversion");
  const converted = JSON.stringify(s.doc.getSnapshot().shadeLayers);
  s.host.failWrites({ code: "io-error", message: "disk full" });
  const failed = await s.doc.save();
  equal(failed.ok, false);
  equal(s.doc.getSnapshot().dirty, true, "the failed save leaves the edit unsaved");
  equal(s.doc.getSnapshot().lights.length, 0);
  equal(JSON.stringify(s.doc.getSnapshot().shadeLayers), converted, "the baked shading is retained");
  deepEqual(Array.from(s.host.bytesOf(PATH)!), saved, "nothing partial reached the file");
  s.host.failWrites(null);
  ok((await s.doc.save()).ok);
  equal(s.doc.getSnapshot().dirty, false);
  ok(s.doc.undo().ok);
  equal(s.doc.getSnapshot().lights.length, 1, "the light still comes back with one undo");
});

test("a shade cell is painted from the numeric fields and an off-board cell explains its refusal", async () => {
  const s = await setup();
  await change(s.root, "Shade Red", "-300");
  equal(input(s.root, "Shade Red").value, "-255", "typed channels clamp to the stored range");
  await change(s.root, "Shade column", "2");
  await change(s.root, "Shade row", "2");
  await click(s.root, "Shade cell");
  equal(s.doc.getSnapshot().shadeLayers.length, 1);
  const before = s.doc.getSnapshot().shadeLayers;
  await change(s.root, "Shade column", "9");
  await click(s.root, "Shade cell");
  equal(s.root.querySelector('[role="alert"]')?.textContent?.includes("outside the board"), true);
  deepEqual(s.doc.getSnapshot().shadeLayers, before);
  await click(s.root, "Zero RGB");
  equal(input(s.root, "Shade Green").value, "0");
});
