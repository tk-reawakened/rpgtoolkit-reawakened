// The bitmap font editor of story 13.20 (T-65) over the real model and the in-memory platform-services double, under the
// same DOM shim as the other views. Assertions are on the DOM and on bytes; expected bytes are written by hand from the
// stored layout (`docs/spec/formats/legacy/text-formats.md#font-toolkit-2-text`).
import { after, before, test } from "node:test";
import { deepEqual, equal, match, notEqual, ok } from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  createDocumentIdentity,
  createPendingEdits,
  fontGlyphRows,
  fontLinePixels,
  fontPixelOf,
  newFontBytes,
  openFontDocument,
  type ApplyResult,
  type FontDocument,
  type PendingEdits,
} from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices, type MemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import type { FontHistoryOutcome, FontViewDocument } from "../src/font-view.tsx";
import type { mount as mountView, ViewHandle } from "../src/mount.ts";

const PATH = "Font/retro.fnt";
const identity = createDocumentIdentity("memory-project", PATH);
const encoder = new TextEncoder();

let mount: typeof mountView;
let act: (callback: () => void | Promise<void>) => Promise<void> | void;

// The DOM shim must exist before the preact and editor-ui modules are first loaded, so they cannot be static imports.
before(async () => {
  GlobalRegistrator.register();
  ({ act } = await import("preact/test-utils"));
  ({ mount } = await import("@tk-reawakened/editor-ui"));
});

after(() => GlobalRegistrator.unregister());

/** The file's text from the spec's sentences, one value per line as ` n `. */
function fontText(rows: (glyph: number, row: number) => number): string {
  const lines = ["RPGTLKIT FONT", "2", "0"];
  for (let glyph = 0; glyph < 256; glyph += 1) for (let row = 0; row < 8; row += 1) lines.push(` ${rows(glyph, row)} `);
  return `${lines.join("\r\n")}\r\n`;
}
/** Glyph 65 has one pixel set, at the top left; glyph 66 is full; the rest are empty. */
const original = (glyph: number, row: number): number => (glyph === 65 && row === 0 ? 0x80 : glyph === 66 ? 0xff : 0);
const ORIGINAL = encoder.encode(fontText(original));

interface Setup {
  readonly host: MemoryPlatformServices;
  readonly doc: FontDocument;
  readonly view: FontViewDocument;
  readonly el: HTMLElement;
  readonly pending: PendingEdits;
  /** While `holding`, the document receives each command, but the view's acknowledgement waits here. */
  readonly gate: { holding: boolean; readonly queue: (() => void)[] };
}

const historyOf = (result: { readonly ok: true } | { readonly ok: false; readonly reason: string }): FontHistoryOutcome =>
  (result.ok ? { ok: true } : { ok: false, message: result.reason });

async function setup(bytes: Uint8Array = ORIGINAL): Promise<Setup> {
  const host = createMemoryPlatformServices({ files: { [PATH]: bytes } });
  const opened = await openFontDocument(host.fs, identity);
  if (!opened.ok) throw new Error(`open failed: ${JSON.stringify(opened.error)}`);
  const doc = opened.document;
  const gate: Setup["gate"] = { holding: false, queue: [] };
  const view: FontViewDocument = {
    kind: doc.kind,
    identity: doc.identity,
    getSnapshot: () => doc.getSnapshot(),
    subscribe: (listener) => doc.subscribe(listener),
    apply: (command) => {
      const result = doc.apply(command);
      if (!gate.holding) return result;
      return new Promise<ApplyResult>((resolve) => { gate.queue.push(() => resolve(result)); });
    },
    save: () => doc.save(),
    resolveConflict: (choice) => doc.resolveConflict(choice),
    // The host's own stack, standing in for it: the document's undo as the workbench would expose it, in the view's words.
    undo: async () => historyOf(await doc.undo()),
    redo: async () => historyOf(await doc.redo()),
  };
  const el = document.createElement("div");
  document.body.append(el);
  return { host, doc, view, el, gate, pending: createPendingEdits() };
}

async function show(s: Setup): Promise<ViewHandle> {
  let handle: ViewHandle | undefined;
  await act(() => {
    handle = mount(s.el, { document: s.view, services: s.host, pendingEdits: s.pending });
  });
  await settle();
  if (handle === undefined) throw new Error("mount returned nothing");
  return handle;
}

async function settle(rounds = 4): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await act(async () => {
      // A macrotask turn lets the host's own messages and promise chains run; no clock is read.
      await new Promise<void>((resolve) => setTimeout(resolve, 2));
    });
  }
}

const slotButton = (el: HTMLElement, code: number): HTMLButtonElement => {
  const found = el.querySelector<HTMLButtonElement>(`.tkr-font-strip [role="gridcell"]:nth-child(${(code & 15) + 1})`)?.parentElement === null
    ? null
    : el.querySelectorAll<HTMLButtonElement>(".tkr-font-slot")[code] ?? null;
  if (found === null || found === undefined) throw new Error(`no slot ${code}`);
  return found;
};
const pixel = (el: HTMLElement, x: number, y: number): HTMLButtonElement => {
  const found = el.querySelector<HTMLButtonElement>(`[data-pixel="${x},${y}"]`);
  if (found === null) throw new Error(`no pixel ${x},${y}`);
  return found;
};
const control = <Element extends HTMLElement>(el: HTMLElement, selector: string): Element => {
  const found = el.querySelector<Element>(selector);
  if (found === null) throw new Error(`no ${selector}`);
  return found;
};
const state = (el: HTMLElement): string => el.querySelector(".tkr-font-state")?.textContent ?? "";
const selectedSlot = (el: HTMLElement): number => [...el.querySelectorAll(".tkr-font-slot")].findIndex((button) => button.classList.contains("tkr-font-slot-selected"));
const inkAt = (el: HTMLElement): string => [...el.querySelectorAll<HTMLElement>("[data-pixel]")].filter((button) => button.classList.contains("tkr-font-pixel-on")).map((button) => button.dataset.pixel).join(" ");

async function key(target: HTMLElement, name: string, init: KeyboardEventInit = {}): Promise<void> {
  await act(() => { target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init })); });
}
const pointer = (type: string, init: PointerEventInit = {}): PointerEvent => new PointerEvent(type, { pointerId: 1, button: 0, bubbles: type !== "pointerenter", cancelable: true, ...init });
async function press(target: HTMLElement): Promise<void> {
  await act(() => { target.dispatchEvent(pointer("pointerdown")); });
}
async function enter(target: HTMLElement): Promise<void> {
  await act(() => { target.dispatchEvent(pointer("pointerenter")); });
}
async function release(target: HTMLElement): Promise<void> {
  await act(() => { target.dispatchEvent(pointer("pointerup")); });
  await settle();
}
async function type(input: HTMLInputElement, value: string): Promise<void> {
  await act(() => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

test("the view shows the 256-slot strip, the selected glyph's pixels and the preview, and opening edits nothing", async () => {
  const s = await setup();
  await show(s);
  equal(s.el.querySelector("h2")?.textContent, "Bitmap font");
  equal(s.el.querySelector("[data-tkr-editor]")?.getAttribute("data-tkr-editor"), "Bitmap font");
  equal(s.el.querySelectorAll(".tkr-font-slot").length, 256);
  equal(s.el.querySelectorAll('.tkr-font-strip [role="row"]').length, 16);
  equal(selectedSlot(s.el), 65, "the strip starts on A");
  equal(slotButton(s.el, 66).getAttribute("aria-label"), "Character 66 (“B”)");
  equal(slotButton(s.el, 7).getAttribute("aria-label"), "Character 7, empty");
  equal(s.el.querySelectorAll("[data-pixel]").length, 64);
  equal(inkAt(s.el), "0,0", "glyph 65's one pixel");
  equal(pixel(s.el, 0, 0).getAttribute("aria-label"), "Column 1, row 1: ink");
  equal(pixel(s.el, 7, 7).getAttribute("aria-label"), "Column 8, row 8: empty");
  match(s.el.querySelector(".tkr-font-summary")?.textContent ?? "", /256 characters, 8 × 8 pixels each; 2 drawn/);
  ok(s.el.querySelector('canvas[role="img"]') !== null, "the sample picture is drawn");
  equal(state(s.el), "All changes saved");
  equal(s.doc.getSnapshot().dirty, false);
});

test("the strip moves with the keyboard and choosing a slot edits nothing", async () => {
  const s = await setup();
  await show(s);
  await key(slotButton(s.el, 65), "ArrowRight");
  equal(selectedSlot(s.el), 66);
  equal(inkAt(s.el), "0,0 1,0 2,0 3,0 4,0 5,0 6,0 7,0 0,1 1,1 2,1 3,1 4,1 5,1 6,1 7,1 0,2 1,2 2,2 3,2 4,2 5,2 6,2 7,2 0,3 1,3 2,3 3,3 4,3 5,3 6,3 7,3 0,4 1,4 2,4 3,4 4,4 5,4 6,4 7,4 0,5 1,5 2,5 3,5 4,5 5,5 6,5 7,5 0,6 1,6 2,6 3,6 4,6 5,6 6,6 7,6 0,7 1,7 2,7 3,7 4,7 5,7 6,7 7,7", "glyph 66 is full");
  await key(slotButton(s.el, 66), "ArrowDown");
  equal(selectedSlot(s.el), 82);
  await key(slotButton(s.el, 82), "ArrowUp");
  equal(selectedSlot(s.el), 66);
  await key(slotButton(s.el, 66), "Home");
  equal(selectedSlot(s.el), 64, "Home is the first slot of the row");
  await key(slotButton(s.el, 64), "End");
  equal(selectedSlot(s.el), 79, "End is the last slot of the row");
  await key(slotButton(s.el, 79), "End", { ctrlKey: true });
  equal(selectedSlot(s.el), 255);
  await key(slotButton(s.el, 255), "ArrowRight");
  equal(selectedSlot(s.el), 255, "no slot after the last");
  await key(slotButton(s.el, 255), "Home", { ctrlKey: true });
  equal(selectedSlot(s.el), 0);
  await key(slotButton(s.el, 0), "ArrowLeft");
  equal(selectedSlot(s.el), 0);
  await act(() => { slotButton(s.el, 200).click(); });
  equal(selectedSlot(s.el), 200);
  equal(s.doc.getSnapshot().dirty, false, "no choice of slot edits the font");
  equal(s.doc.getSnapshot().edits.length, 0);
  equal(slotButton(s.el, 200).getAttribute("tabindex"), "0", "the strip is one tab stop");
  equal(slotButton(s.el, 65).getAttribute("tabindex"), "-1");
});

test("keyboard: arrows move the cursor, Space or Enter uses the tool once, Delete erases, and each is one undoable edit at the opposite corners of two glyphs", async () => {
  const s = await setup();
  await show(s);
  equal(pixel(s.el, 0, 0).getAttribute("tabindex"), "0", "the grid is one tab stop, starting at the first pixel");
  await key(pixel(s.el, 0, 0), "ArrowRight");
  await key(pixel(s.el, 1, 0), "ArrowDown");
  equal(pixel(s.el, 1, 1).getAttribute("tabindex"), "0");
  await key(pixel(s.el, 1, 1), "End");
  equal(pixel(s.el, 7, 1).getAttribute("tabindex"), "0");
  await key(pixel(s.el, 7, 1), "Home");
  await key(pixel(s.el, 0, 1), "ArrowUp");
  await key(pixel(s.el, 0, 0), "ArrowLeft");
  equal(pixel(s.el, 0, 0).getAttribute("tabindex"), "0", "the cursor stops at the edge");

  // The bottom-right corner of A, with the keyboard's click (no pointer, detail 0).
  for (let step = 0; step < 7; step += 1) await key(control(s.el, '[tabindex="0"][data-pixel]'), "ArrowRight");
  for (let step = 0; step < 7; step += 1) await key(control(s.el, '[tabindex="0"][data-pixel]'), "ArrowDown");
  await act(() => { pixel(s.el, 7, 7).click(); });
  await settle();
  deepEqual(fontGlyphRows(s.doc.getSnapshot().values, 65), [0x80, 0, 0, 0, 0, 0, 0, 0x01]);
  equal(s.doc.getSnapshot().edits.length, 1, "one keyboard action is one edit");
  equal(s.doc.getSnapshot().edits[0]?.label, "Draw 1 pixel of character 65 (“A”)");
  equal(state(s.el), "Unsaved changes");
  equal(s.host.editedEvents.length, 1, "the host was told");

  // Using the Draw tool on a pixel that is already ink is not an edit.
  await act(() => { pixel(s.el, 7, 7).click(); });
  await settle();
  equal(s.doc.getSnapshot().edits.length, 1);

  // The top-right corner of another glyph, by Erase and Delete.
  await act(() => { slotButton(s.el, 66).click(); });
  await act(() => { control<HTMLButtonElement>(s.el, ".tkr-font-tool-erase").click(); });
  equal(control(s.el, ".tkr-font-tool-erase").getAttribute("aria-pressed"), "true");
  await act(() => { pixel(s.el, 7, 0).click(); });
  await settle();
  await key(pixel(s.el, 7, 0), "ArrowLeft");
  await key(pixel(s.el, 6, 0), "Delete");
  await settle();
  deepEqual(fontGlyphRows(s.doc.getSnapshot().values, 66), [0xfc, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
  equal(s.doc.getSnapshot().edits.length, 3);

  deepEqual(s.host.bytesOf(PATH), ORIGINAL, "nothing is written before Save");
  await act(() => { control<HTMLButtonElement>(s.el, ".tkr-font-save").click(); });
  await settle();
  equal(state(s.el), "All changes saved");
  const expected = fontText((glyph, row) => (glyph === 65 ? (row === 0 ? 0x80 : row === 7 ? 0x01 : 0) : glyph === 66 && row === 0 ? 0xfc : original(glyph, row)));
  deepEqual(s.host.bytesOf(PATH), encoder.encode(expected), "the file holds exactly the two glyph changes");

  // Undo and redo are the document's own, the host's Edit menu or Ctrl+Z.
  ok(s.doc.undo().ok);
  await settle();
  equal(inkAt(s.el).includes("6,0"), true, "the erased pixel is back after one Undo");
  equal(inkAt(s.el).includes("7,0"), false, "and the drawn pixel stays erased: one Undo, one edit");
  ok(s.doc.redo().ok);
  await settle();
  equal(inkAt(s.el).includes("6,0"), false);
});

test("a pointer stroke is previewed while it runs and committed on release as one edit that one Undo takes back", async () => {
  const s = await setup();
  await show(s);
  await press(pixel(s.el, 0, 2));
  equal(s.doc.getSnapshot().dirty, false, "a stroke in progress is not an edit");
  await enter(pixel(s.el, 1, 2));
  await enter(pixel(s.el, 2, 2));
  await enter(pixel(s.el, 2, 3));
  equal(inkAt(s.el), "0,0 0,2 1,2 2,2 2,3", "the grid shows the stroke as it goes");
  equal(s.doc.getSnapshot().edits.length, 0);
  await release(pixel(s.el, 2, 3));
  deepEqual(fontGlyphRows(s.doc.getSnapshot().values, 65), [0x80, 0, 0xe0, 0x20, 0, 0, 0, 0]);
  equal(s.doc.getSnapshot().edits.length, 1, "the whole stroke is one edit");
  ok(s.doc.undo().ok);
  await settle();
  deepEqual(fontGlyphRows(s.doc.getSnapshot().values, 65), [0x80, 0, 0, 0, 0, 0, 0, 0]);
  equal(s.doc.getSnapshot().dirty, false);
  equal(inkAt(s.el), "0,0");

  // The same pointer leaving and coming back adds nothing once the stroke is over.
  await enter(pixel(s.el, 5, 5));
  equal(s.doc.getSnapshot().edits.length, 0, "undone edit stays undone; the stray pointer added nothing");
});

test("Erase strokes clear ink, a stroke that changes nothing is no edit, and Escape or a cancelled pointer discards a stroke", async () => {
  const s = await setup();
  await show(s);
  await act(() => { slotButton(s.el, 66).click(); });
  await act(() => { control<HTMLButtonElement>(s.el, ".tkr-font-tool-erase").click(); });
  await press(pixel(s.el, 0, 0));
  await enter(pixel(s.el, 1, 0));
  await release(pixel(s.el, 1, 0));
  deepEqual(fontGlyphRows(s.doc.getSnapshot().values, 66), [0x3f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
  equal(s.doc.getSnapshot().edits.length, 1);

  // Draw over pixels that already are ink: nothing to commit.
  await act(() => { control<HTMLButtonElement>(s.el, ".tkr-font-tool-draw").click(); });
  await press(pixel(s.el, 3, 3));
  await release(pixel(s.el, 3, 3));
  equal(s.doc.getSnapshot().edits.length, 1);

  // Escape discards the unfinished stroke.
  await act(() => { slotButton(s.el, 65).click(); });
  await press(pixel(s.el, 4, 4));
  await enter(pixel(s.el, 5, 4));
  equal(inkAt(s.el), "0,0 4,4 5,4");
  await key(pixel(s.el, 5, 4), "Escape");
  equal(inkAt(s.el), "0,0", "the stroke is gone");
  await release(pixel(s.el, 5, 4));
  equal(s.doc.getSnapshot().edits.length, 1, "releasing afterwards commits nothing");

  // A cancelled pointer (a touch taken over by the browser) discards it too.
  await press(pixel(s.el, 4, 4));
  await act(() => { pixel(s.el, 4, 4).dispatchEvent(pointer("pointercancel")); });
  equal(inkAt(s.el), "0,0");
  equal(s.doc.getSnapshot().edits.length, 1);
});

test("a change under a running stroke is rebased onto, so the pointer keeps painting and the other view's pixels stay", async () => {
  const s = await setup();
  await show(s);
  await press(pixel(s.el, 4, 4));
  await enter(pixel(s.el, 5, 4));
  await act(() => { pixel(s.el, 6, 4).dispatchEvent(pointer("pointerenter", { pointerId: 2 })); });
  equal(inkAt(s.el), "0,0 4,4 5,4", "a second pointer paints nothing");
  // An edit from elsewhere (a script, another view of the same document) arrives while the pointer is still down.
  ok(s.doc.apply({ type: "set-font-pixels", glyph: 65, pixels: [{ x: 1, y: 1, ink: true }] }).ok);
  await settle();
  equal(inkAt(s.el), "0,0 1,1 4,4 5,4", "the arrival is shown with the stroke still on it, not instead of it");
  // The stroke keeps painting after the rebase, and its release is one edit carrying only its own cells.
  await enter(pixel(s.el, 6, 4));
  equal(inkAt(s.el), "0,0 1,1 4,4 5,4 6,4");
  await release(pixel(s.el, 6, 4));
  equal(s.doc.getSnapshot().edits.length, 2, "the outside edit plus the stroke");
  const rows = fontGlyphRows(s.doc.getSnapshot().values, 65);
  for (const [x, y] of [[1, 1], [4, 4], [5, 4], [6, 4]] as const) equal(fontPixelOf(rows, x, y), true, `${x},${y} is inked`);
  equal(s.doc.getSnapshot().dirty, true);
});

test("a stroke retains an already traversed pixel when another view draws and then undoes it", async () => {
  const s = await setup();
  await show(s);
  await press(pixel(s.el, 4, 4));
  ok(s.doc.apply({ type: "set-font-pixels", glyph: 65, pixels: [{ x: 4, y: 4, ink: true }] }).ok);
  await settle();
  ok(s.doc.undo().ok);
  await settle();
  equal(inkAt(s.el), "0,0 4,4", "the current stroke still intends to draw the pixel");
  await release(pixel(s.el, 4, 4));
  equal(s.doc.getSnapshot().edits.length, 1);
  equal(fontPixelOf(fontGlyphRows(s.doc.getSnapshot().values, 65), 4, 4), true);
});

test("release sends stroke intent even when the view has not received the latest Undo snapshot", async () => {
  const s = await setup();
  ok(s.doc.apply({ type: "set-font-pixels", glyph: 65, pixels: [{ x: 4, y: 4, ink: true }] }).ok);
  const matched = s.doc.getSnapshot();
  let hold = true;
  await show({ ...s, view: { ...s.view, getSnapshot: () => hold ? matched : s.doc.getSnapshot() } });
  await press(pixel(s.el, 4, 4));
  ok(s.doc.undo().ok);
  await settle();
  equal(inkAt(s.el), "0,0 4,4", "the view still has the matching revision");
  await release(pixel(s.el, 4, 4));
  hold = false;
  equal(s.doc.getSnapshot().edits.length, 1, "release reached the authoritative document as a new edit");
  equal(fontPixelOf(fontGlyphRows(s.doc.getSnapshot().values, 65), 4, 4), true);
});

test("the host's Undo and Redo are one button and one keyboard shortcut, from the grid, and follow the document's stack", async () => {
  const s = await setup();
  await show(s);
  const undo = () => control<HTMLButtonElement>(s.el, ".tkr-font-undo");
  const redo = () => control<HTMLButtonElement>(s.el, ".tkr-font-redo");
  equal(undo().disabled, true, "nothing to undo on a clean font");
  equal(redo().disabled, true);

  // Two keyboard edits on empty pixels, so the stack has two steps.
  await key(pixel(s.el, 0, 0), "ArrowDown");
  await key(pixel(s.el, 0, 1), " ");
  await settle();
  await key(pixel(s.el, 0, 1), "ArrowRight");
  await key(pixel(s.el, 1, 1), " ");
  await settle();
  equal(inkAt(s.el), "0,0 0,1 1,1");
  equal(undo().disabled, false);

  await act(() => { undo().click(); });
  await settle();
  equal(inkAt(s.el), "0,0 0,1", "the button takes the last edit back");
  equal(redo().disabled, false);
  await act(() => { redo().click(); });
  await settle();
  equal(inkAt(s.el), "0,0 0,1 1,1", "and redo puts it back");

  // Ctrl+Z and Ctrl+Y from the grid do the same through the host.
  await key(pixel(s.el, 1, 1), "z", { ctrlKey: true });
  await settle();
  equal(inkAt(s.el), "0,0 0,1");
  await key(pixel(s.el, 1, 1), "y", { ctrlKey: true });
  await settle();
  equal(inkAt(s.el), "0,0 0,1 1,1");
  await act(() => { undo().click(); });
  await act(() => { undo().click(); });
  await settle();
  equal(inkAt(s.el), "0,0", "two undo steps return the font to its saved glyph");
  equal(s.doc.getSnapshot().dirty, false);
});

test("Clear glyph empties the glyph as one edit and is unavailable when it is already empty", async () => {
  const s = await setup();
  await show(s);
  const clear = control<HTMLButtonElement>(s.el, ".tkr-font-clear");
  equal(clear.disabled, false);
  await act(() => { clear.click(); });
  await settle();
  deepEqual(fontGlyphRows(s.doc.getSnapshot().values, 65), [0, 0, 0, 0, 0, 0, 0, 0]);
  equal(s.doc.getSnapshot().edits[0]?.label, "Clear character 65 (“A”)");
  equal(control<HTMLButtonElement>(s.el, ".tkr-font-clear").disabled, true);
});

test("the preview's sample, size, styles and zoom are view state: they never edit or dirty the font, and a bad size keeps the last picture and says why", async () => {
  const s = await setup();
  await show(s);
  await type(control(s.el, ".tkr-font-sample"), "AAB");
  await type(control(s.el, ".tkr-font-size"), "20");
  for (const label of ["Bold", "Italics", "Underline"]) {
    const box = [...s.el.querySelectorAll<HTMLLabelElement>(".tkr-font-style")].find((entry) => entry.textContent?.trim() === label)?.querySelector("input");
    ok(box !== null && box !== undefined, label);
    await act(() => { box.click(); });
  }
  const zoom = control<HTMLSelectElement>(s.el, ".tkr-font-zoom");
  await act(() => {
    zoom.value = "3";
    zoom.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
  equal(s.doc.getSnapshot().dirty, false, "changing the preview leaves the document clean");
  equal(s.doc.getSnapshot().edits.length, 0);
  equal(state(s.el), "All changes saved");
  ok(s.el.querySelector('canvas[role="img"]') !== null);
  equal(s.el.querySelector('[role="alert"]'), null);
  await type(control(s.el, ".tkr-font-size"), "500");
  match(s.el.querySelector('[role="alert"]')?.textContent ?? "", /whole number from 1 to 128 pixels\. The picture still shows 20 pixels/);
  ok(s.el.querySelector('canvas[role="img"]') !== null, "the last good picture stays");
  await type(control(s.el, ".tkr-font-size"), "");
  match(s.el.querySelector('[role="alert"]')?.textContent ?? "", /whole number/);
  await type(control(s.el, ".tkr-font-size"), "12");
  equal(s.el.querySelector('[role="alert"]'), null);
  equal(s.doc.getSnapshot().dirty, false);
});

test("a refused save keeps every glyph edit in the document and the view, and Save tries again", async () => {
  const s = await setup();
  await show(s);
  await press(pixel(s.el, 3, 3));
  await release(pixel(s.el, 3, 3));
  s.host.failWrites({ code: "io-error", message: "the disk is full" });
  await act(() => { control<HTMLButtonElement>(s.el, ".tkr-font-save").click(); });
  await settle();
  match(s.el.querySelector(".tkr-font-error")?.textContent ?? "", /the disk is full/);
  equal(state(s.el), "Unsaved changes");
  equal(inkAt(s.el), "0,0 3,3", "the edit is still shown");
  deepEqual(s.host.bytesOf(PATH), ORIGINAL);
  equal(control<HTMLButtonElement>(s.el, ".tkr-font-save").disabled, false, "Save is available for another try");
  s.host.failWrites(null);
  await act(() => { control<HTMLButtonElement>(s.el, ".tkr-font-save").click(); });
  await settle();
  equal(state(s.el), "All changes saved");
  deepEqual(s.host.bytesOf(PATH), encoder.encode(fontText((glyph, row) => (glyph === 65 && row === 3 ? 0x10 : original(glyph, row)))));
});

test("edits are sent in input order without waiting for the first answer; Save still tracks both", async () => {
  const s = await setup();
  await show(s);
  s.gate.holding = true;
  await press(pixel(s.el, 1, 1));
  await release(pixel(s.el, 1, 1));
  await press(pixel(s.el, 2, 2));
  await release(pixel(s.el, 2, 2));
  equal(s.pending.busy(), true, "the host's save and close would wait for these");
  equal(s.doc.getSnapshot().edits.length, 2, "the document has both committed edits, even while the view awaits both replies");
  equal(s.gate.queue.length, 2, "the first unacknowledged edit does not hold back a second");
  s.gate.holding = false;
  await act(() => { for (const release of s.gate.queue.splice(0)) release(); });
  await s.pending.settle();
  await settle();
  equal(s.pending.busy(), false);
  deepEqual(fontGlyphRows(s.doc.getSnapshot().values, 65), [0x80, 0x40, 0x20, 0, 0, 0, 0, 0]);
  equal(s.doc.getSnapshot().edits.length, 2);
});

test("a font the writer would not reproduce byte for byte is shown read-only: no pixel or Save can change it", async () => {
  const compact = encoder.encode(["RPGTLKIT FONT", "2", "0", ...Array.from({ length: 2048 }, (_, index) => String(index === 65 * 8 ? 128 : 0))].join("\n"));
  const s = await setup(compact);
  await show(s);
  match(s.el.querySelector(".tkr-font-readonly")?.textContent ?? "", /Read only: .*first difference is at offset/);
  equal(pixel(s.el, 3, 3).disabled, true);
  equal(control<HTMLButtonElement>(s.el, ".tkr-font-clear").disabled, true);
  equal(control<HTMLButtonElement>(s.el, ".tkr-font-save").disabled, true);
  equal(inkAt(s.el), "0,0", "the glyph is still shown");
  await act(() => { slotButton(s.el, 67).click(); });
  equal(selectedSlot(s.el), 67, "browsing the strip still works");
  deepEqual(s.host.bytesOf(PATH), compact);
});

test("a change on disk is offered as a conflict with the save-and-keep choices of the other editors", async () => {
  const s = await setup();
  await show(s);
  await press(pixel(s.el, 3, 3));
  await release(pixel(s.el, 3, 3));
  s.host.seed(PATH, encoder.encode(fontText((glyph, row) => (glyph === 70 && row === 0 ? 1 : original(glyph, row)))));
  await act(async () => { await s.doc.checkExternal(); });
  await settle();
  ok(s.el.querySelector(".tkr-font-conflict") !== null);
  equal(pixel(s.el, 4, 4).disabled, true, "no edit while a conflict waits");
  equal(control<HTMLButtonElement>(s.el, ".tkr-font-save").disabled, true);
  await act(() => { control<HTMLButtonElement>(s.el, ".tkr-font-keep").click(); });
  await settle();
  equal(s.el.querySelector(".tkr-font-conflict"), null);
  equal(inkAt(s.el), "0,0 3,3", "my version is kept");
});

test("every control of the editor is a named button, field or group so the command palette can reach it", async () => {
  const s = await setup();
  await show(s);
  for (const element of s.el.querySelectorAll<HTMLElement>("button, input, select")) {
    const labels = element instanceof HTMLInputElement || element instanceof HTMLSelectElement ? [...(element.labels ?? [])].map((label) => label.textContent).join("") : "";
    const name = element.getAttribute("aria-label") ?? (labels !== "" ? labels : element.textContent ?? "");
    notEqual(name.trim(), "", `${element.className} has an accessible name`);
  }
  equal(s.el.querySelectorAll("[style]").length, 0, "no style attribute (ADR 0025 decision 6)");
});

test("two views of one font edit different pixels of the same glyph, and neither overwrites the other", async () => {
  const s = await setup();
  await show(s);
  const other = document.createElement("div");
  document.body.append(other);
  await act(() => { mount(other, { document: s.view, services: s.host, pendingEdits: s.pending }); });
  await settle();

  // Each view paints one pixel of A: a whole-glyph command from a stale copy would have erased the other's pixel.
  await act(() => { control<HTMLButtonElement>(s.el, '[data-pixel="1,1"]').click(); });
  await settle();
  await act(() => { control<HTMLButtonElement>(other, '[data-pixel="6,6"]').click(); });
  await settle();
  const rows = fontGlyphRows(s.doc.getSnapshot().values, 65);
  equal(fontPixelOf(rows, 1, 1), true, "the first view's pixel");
  equal(fontPixelOf(rows, 6, 6), true, "the second view's pixel, applied to what the glyph had become");
  equal(inkAt(s.el).includes("1,1") && inkAt(s.el).includes("6,6"), true, "both views show both pixels");
  equal(inkAt(other).includes("1,1") && inkAt(other).includes("6,6"), true);
  ok(s.doc.undo().ok);
  await settle();
  equal(fontPixelOf(fontGlyphRows(s.doc.getSnapshot().values, 65), 1, 1), true, "one Undo takes back one view's stroke only");
  equal(fontPixelOf(fontGlyphRows(s.doc.getSnapshot().values, 65), 6, 6), false);
});

test("a fast drag paints every cell it crossed, as one edit, so no intermediate pixel is skipped", async () => {
  const s = await setup(newFontBytes());
  await show(s);
  await press(pixel(s.el, 0, 0));
  // One jump from the corner to the opposite one: the pointer never entered the cells between.
  await enter(pixel(s.el, 7, 7));
  await release(pixel(s.el, 7, 7));
  const rows = fontGlyphRows(s.doc.getSnapshot().values, 65);
  const diagonal = fontLinePixels(0, 0, 7, 7);
  equal(diagonal.length, 8);
  for (const cell of diagonal) equal(fontPixelOf(rows, cell.x, cell.y), true, `the stroke passed ${cell.x},${cell.y}`);
  equal(s.doc.getSnapshot().edits.length, 1, "the whole drag is one edit");
});

test("Undo takes back the newest committed stroke without waiting for the view's late acknowledgements", async () => {
  const s = await setup(newFontBytes());
  await show(s);
  s.gate.holding = true;
  // Stroke one, then stroke two, both unanswered when Undo is pressed.
  await press(pixel(s.el, 0, 0));
  await release(pixel(s.el, 0, 0));
  await press(pixel(s.el, 0, 1));
  await release(pixel(s.el, 0, 1));
  equal(s.doc.getSnapshot().edits.length, 2, "the host has both strokes but has not replied");
  await act(() => { control<HTMLButtonElement>(s.el, ".tkr-font-undo").click(); });
  equal(s.doc.getSnapshot().edits.length, 1, "Undo already took back the newest stroke");
  s.gate.holding = false;
  await act(() => { for (const answer of s.gate.queue.splice(0)) answer(); });
  await s.pending.settle();
  await settle();
  const rows = fontGlyphRows(s.doc.getSnapshot().values, 65);
  equal(fontPixelOf(rows, 0, 0), true, "the first stroke stays");
  equal(fontPixelOf(rows, 0, 1), false, "the last stroke is the one undone");
  equal(s.doc.getSnapshot().edits.length, 1);
  equal(inkAt(s.el), "0,0", "and the grid shows what the font holds");
});

test("the buttons, the keyboard and the host's own history are one stack: each takes back the same edit", async () => {
  const s = await setup(newFontBytes());
  await show(s);
  const undo = () => control<HTMLButtonElement>(s.el, ".tkr-font-undo");
  await act(() => { pixel(s.el, 2, 2).click(); });
  await settle();
  await key(pixel(s.el, 2, 2), "ArrowRight");
  await key(pixel(s.el, 3, 2), " ");
  await settle();
  equal(inkAt(s.el), "2,2 3,2");
  await act(() => { undo().click(); });
  await settle();
  equal(inkAt(s.el), "2,2", "the button takes back the keyboard's edit");
  // The host's own undo (what the menu calls) takes back the pointer's edit next: one stack, not two.
  await act(() => { for (const answer of [s.doc.undo()]) ok(answer.ok); });
  await settle();
  equal(inkAt(s.el), "", "the same stack reached through the host");
  equal(undo().disabled, true);
  equal(control<HTMLButtonElement>(s.el, ".tkr-font-redo").disabled, false);
});
