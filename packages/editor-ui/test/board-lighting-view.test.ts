import { after, afterEach, before, test } from "node:test";
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

afterEach(async () => {
  for (const root of mounted.splice(0)) {
    await act(() => { render(null, root); });
    root.remove();
  }
});

after(() => GlobalRegistrator.unregister());

interface Setup {
  readonly host: ReturnType<typeof createMemoryPlatformServices>;
  readonly doc: BoardDocument;
  readonly root: HTMLElement;
  renderView(): void;
  /** Make the view keep seeing the board as it is now while the document moves on, as a second editor's edit does before the host notifies this one. */
  freeze(): void;
}

/** Every mounted pane, unmounted after each test so an open review in one test cannot answer another test's Escape. */
const mounted: HTMLElement[] = [];

async function setup(): Promise<Setup> {
  const built = buildNewBoard({ name: "lighting", coordSystem: "2d", pixelCoordinates: false, width: 4, height: 3, layers: 2, backgroundImage: "", template: null });
  if (!built.ok) throw new Error(built.message);
  const host = createMemoryPlatformServices({ files: { [PATH]: built.bytes } });
  const opened = createBoardDocument(host.fs, createDocumentIdentity("memory-project", PATH), built.bytes);
  if (!opened.ok) throw new Error(JSON.stringify(opened.error));
  const doc = opened.document;
  const pendingEdits = createPendingEdits();
  let held: ReturnType<typeof doc.getSnapshot> | null = null;
  const view: BoardViewDocument = {
    kind: doc.kind,
    identity: doc.identity,
    getSnapshot: () => held ?? doc.getSnapshot(),
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
  mounted.push(root);
  const Harness = (): preact.JSX.Element => {
    const [ui, setUi] = useState<ShadeUi>(INITIAL_SHADE_UI);
    const board = useBoardSubmit(view, () => undefined, pendingEdits, "Edit lights and shading");
    return createElement(BoardLightingView, { doc: view, disabled: false, ui, onUi: setUi, board }) as preact.JSX.Element;
  };
  const renderView = (): void => {
    render(createElement(Harness, {}), root);
  };
  await act(() => renderView());
  return { host, doc, root, renderView, freeze: () => { held = doc.getSnapshot(); } };
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

test("Apply is refused by the document when another editor changed the light or the shading after the review, and nothing is baked", async () => {
  for (const [name, change] of [
    ["light", (doc: BoardDocument) => doc.apply({ type: "set-board-fields", fields: { lights: [{ ...doc.getSnapshot().lights[0]!, colours: [{ r: 7, g: 8, b: 9 }, { r: 4, g: 5, b: 6 }] }] } })],
    ["shading", (doc: BoardDocument) => doc.apply({ type: "set-shade-cells", cells: [{ x: 1, y: 1, r: 33, g: 0, b: 0 }] })],
  ] as const) {
    const s = await setup();
    await click(s.root, "Add spotlight");
    await click(s.root, CONVERT);
    s.freeze();
    ok((await change(s.doc)).ok);
    const afterOther = fingerprint(s.doc);
    ok(review(s.root) !== null, `the view has not heard about the other editor's ${name} edit, so its review is still open`);
    await press(s.root, "Apply conversion of Light 1 to shading");
    equal(fingerprint(s.doc), afterOther, `a stale Apply after a ${name} edit stores nothing`);
    equal(s.doc.getSnapshot().lights.length, 1, "the other editor's light is still there");
    ok(/board changed since this edit was prepared/.test(s.root.querySelector('[role="alert"]')?.textContent ?? ""), `${name}: the refusal is explained`);
    equal(review(s.root), null);
  }
});

test("undoing a shade edit while the review is open closes it: the picture and counts were for the old shading", async () => {
  const s = await setup();
  await click(s.root, "Add spotlight");
  await click(s.root, "Shade cell");
  equal(s.doc.getSnapshot().shadeLayers.length, 1);
  await click(s.root, CONVERT);
  ok(review(s.root) !== null);
  ok(/already has/.test(review(s.root)!.textContent ?? ""));
  await act(async () => { ok(s.doc.undo().ok); await Promise.resolve(); });
  equal(review(s.root), null, "the review closed when its source shading changed");
  ok(/nothing was converted/.test(s.root.querySelector('[role="alert"]')?.textContent ?? ""));
  equal(s.doc.getSnapshot().lights.length, 1, "the light is still editable");
  equal(s.doc.getSnapshot().shadeLayers.length, 0);
});

test("Escape cancels the review from wherever focus has moved, but leaves another open dialog its own Escape", async () => {
  const s = await setup();
  await click(s.root, "Add spotlight");
  const before = fingerprint(s.doc);
  await click(s.root, CONVERT);
  const escape = (target: Element): KeyboardEvent => {
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  };
  // Focus moved out of the review to the page itself.
  await act(() => { (document.activeElement as HTMLElement | null)?.blur(); });
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  const inner = document.createElement("button");
  dialog.append(inner);
  document.body.append(dialog);
  const own = await (async () => { let event!: KeyboardEvent; await act(() => { event = escape(inner); }); return event; })();
  equal(own.defaultPrevented, false, "another dialog's Escape is not claimed");
  ok(review(s.root) !== null);
  dialog.remove();
  let event!: KeyboardEvent;
  await act(() => { event = escape(document.body); });
  equal(event.defaultPrevented, true, "the review claimed the key");
  equal(review(s.root), null);
  equal(fingerprint(s.doc), before);
});

test("the review says its picture is only what the light adds, and counts the cells whose stored shade passes ±255", async () => {
  const s = await setup();
  ok((await s.doc.apply({ type: "set-board-fields", fields: { shadeLayers: [{ castLayer: 2, records: [{ runCount: 12, r: 250, g: 0, b: 0 }] }] } })).ok);
  await act(() => s.renderView());
  await click(s.root, "Add gradient");
  await click(s.root, CONVERT);
  const text = review(s.root)!.textContent ?? "";
  ok(/This picture shows only what Light 1 adds on its own/.test(text) && /does not mark cells whose stored shade passes ±255/.test(text));
  ok(/\d+ cells? would have a stored shade beyond ±255 \(in red, green or blue\) once added to the shading already there/.test(text), "cells with a stored total beyond ±255 are counted");
  ok(/not a drawing error/.test(text) && !/draws those clamped/.test(text), "the count makes no claim about rendered clipping");
});

test("two open reviews in two panes: Escape answers only the active one, and never pulls focus into the other pane", async () => {
  const a = await setup();
  const b = await setup();
  await click(a.root, "Add spotlight");
  await click(b.root, "Add spotlight");
  const fingerprints = [fingerprint(a.doc), fingerprint(b.doc)];
  const escape = async (target: Element): Promise<KeyboardEvent> => {
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(() => { target.dispatchEvent(event); });
    return event;
  };

  // A is opened first, B second: with focus on the page, the most recent review (B) answers and A stays open.
  await click(a.root, CONVERT);
  await click(b.root, CONVERT);
  ok(review(a.root) !== null && review(b.root) !== null);
  await act(() => { (document.activeElement as HTMLElement | null)?.blur(); });
  await escape(document.body);
  ok(review(a.root) !== null, "the older review is not closed by the newer one's Escape");
  equal(review(b.root), null, "the most recent review is the one that closed");

  // Focus moves into A's review: A is now the active one and B (reopened) is the more recent open, yet Escape in A closes A.
  await click(b.root, CONVERT);
  const cancelA = a.root.querySelector<HTMLElement>("[data-light-review-cancel]")!;
  await act(() => { cancelA.focus(); });
  await escape(cancelA);
  equal(review(a.root), null, "Escape inside a review closes that review");
  ok(review(b.root) !== null, "and not the other pane's");

  // Focus rests in B's field while A's review is the only one it could close: Escape closes A but leaves focus in B.
  await click(b.root, "Cancel");
  await click(a.root, CONVERT);
  const field = input(b.root, "Light 1 Centre X (pixels)");
  await act(() => { field.focus(); });
  equal(document.activeElement, field);
  await escape(field);
  equal(review(a.root), null, "the open review answered the Escape");
  equal(document.activeElement, field, "focus stayed in the pane where the author was working");
  deepEqual([fingerprint(a.doc), fingerprint(b.doc)], fingerprints, "no pane stored anything");
});
