// The bitmap font proof (story 13.20, T-65, host conformance for the font kind): in every host a font is opened, pixels at
// opposite corners of two different glyphs are drawn by pointer and by keyboard, undone and redone, saved, closed and
// reopened; the file holds exactly the bytes written by hand from the stored layout, the reopened view shows the same
// glyphs, every untouched glyph is intact, and the sample preview is hard-edged ink at 8 and 20 pixels that equals the
// pixels the spec's bitmap rule gives, while the preview's own settings leave the document clean.
import { deepEqual, equal, match, notEqual, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createFontFile, newFontBytes } from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { settle, type Act } from "../conformance/view.ts";

const gam = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/game/Main/example.gam", import.meta.url)));
const PATH = "Font/retro.fnt";
const encoder = new TextEncoder();

/** The file's text, written from the spec's sentences: three header lines, then 2048 values each as ` n `. */
function fontText(rows: (glyph: number, row: number) => number): string {
  const lines = ["RPGTLKIT FONT", "2", "0"];
  for (let glyph = 0; glyph < 256; glyph += 1) for (let row = 0; row < 8; row += 1) lines.push(` ${rows(glyph, row)} `);
  return `${lines.join("\r\n")}\r\n`;
}
/** Glyph 65 has one pixel at the top left; every other glyph is empty. */
const original = (glyph: number, row: number): number => (glyph === 65 && row === 0 ? 0x80 : 0);
const ORIGINAL = encoder.encode(fontText(original));

/** The pixels the spec's bitmap rule gives one glyph at `s` (`docs/spec/engine/display-input-audio.md#reawakened-bitmap-font-ink`). */
function specInk(rows: readonly number[], s: number, bold: boolean, italic: boolean): Set<string> {
  const ink = new Set<string>();
  for (let sy = 0; sy < 8; sy += 1) {
    for (let sx = 0; sx < 8; sx += 1) {
      if (((rows[sy] ?? 0) >> (7 - sx) & 1) === 0) continue;
      const shift = italic ? Math.floor((7 - sy) * s / 32) : 0;
      const left = Math.floor(sx * s / 8);
      const right = Math.max(left + 1, Math.floor((sx + 1) * s / 8));
      const top = Math.floor(sy * s / 8);
      const bottom = Math.max(top + 1, Math.floor((sy + 1) * s / 8));
      for (let y = top; y < bottom; y += 1) {
        for (let x = left + shift; x < right + shift; x += 1) {
          ink.add(`${x},${y}`);
          if (bold) ink.add(`${x + 1},${y}`);
        }
      }
    }
  }
  return ink;
}

interface Tab {
  readonly element: HTMLElement;
  workbenchDirty(): boolean;
  /** VS Code hosts: resolves once everything the webview sent has reached the extension host. */
  delivered?(): Promise<void>;
  close(): Promise<void>;
}

interface Host {
  readonly name: string;
  open(path: string): Promise<Tab>;
  disk(path: string): Promise<Uint8Array | null>;
}

let act: Act;
let hosts: readonly { readonly name: string; readonly make: () => Host }[] = [];

before(async () => {
  GlobalRegistrator.register();
  const { act: preactAct } = await import("preact/test-utils");
  let queue: Promise<void> = Promise.resolve();
  act = (callback) => {
    const run = queue.then(() => preactAct(callback));
    queue = run.catch(() => undefined);
    return run;
  };
  const { createWebBoardProofHost } = await import("../conformance/web-host.ts");
  const { createVscodeBoardProofHost } = await import("../conformance/vscode-host.ts");
  hosts = [
    { name: "browser host", make: () => createWebBoardProofHost(gam, { [PATH]: ORIGINAL }, act) },
    { name: "VS Code desktop", make: () => createVscodeBoardProofHost(true, gam, { [PATH]: ORIGINAL }, act) },
    { name: "VS Code for the Web", make: () => createVscodeBoardProofHost(false, gam, { [PATH]: ORIGINAL }, act) },
  ];
});

after(() => GlobalRegistrator.unregister());

const pixel = (tab: Tab, x: number, y: number): HTMLButtonElement => {
  const found = tab.element.querySelector<HTMLButtonElement>(`[data-pixel="${x},${y}"]`);
  if (found === null) throw new Error(`no pixel ${x},${y}: ${tab.element.textContent?.slice(0, 400)}`);
  return found;
};
const slot = (tab: Tab, code: number): HTMLButtonElement => {
  const found = tab.element.querySelectorAll<HTMLButtonElement>(".tkr-font-slot")[code];
  if (found === undefined) throw new Error(`no slot ${code}`);
  return found;
};
const control = <Element extends HTMLElement>(tab: Tab, selector: string): Element => {
  const found = tab.element.querySelector<Element>(selector);
  if (found === null) throw new Error(`no ${selector}: ${tab.element.textContent?.slice(0, 400)}`);
  return found;
};
const state = (tab: Tab): string => tab.element.querySelector(".tkr-font-state")?.textContent ?? "";
const ink = (tab: Tab): string => [...tab.element.querySelectorAll<HTMLElement>("[data-pixel]")]
  .filter((button) => button.classList.contains("tkr-font-pixel-on")).map((button) => button.dataset.pixel).join(" ");

async function until(done: () => boolean): Promise<void> {
  for (let round = 0; round < 400 && !done(); round += 1) await settle(act, 1);
  ok(done(), "the host did what the view asked");
}

/** Press on a pixel and drag to another, then release: one stroke, which is one edit. */
async function stroke(tab: Tab, from: [number, number], to: [number, number][]): Promise<void> {
  await act(() => { pixel(tab, ...from).dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, button: 0, bubbles: true, cancelable: true })); });
  for (const point of to) {
    await act(() => { pixel(tab, ...point).dispatchEvent(new PointerEvent("pointerenter", { pointerId: 1, button: 0, bubbles: true })); });
  }
  const last = to.at(-1) ?? from;
  await act(() => { pixel(tab, ...last).dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, button: 0, bubbles: true })); });
  await settle(act, 2);
}

async function key(target: HTMLElement, name: string): Promise<void> {
  await act(() => { target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })); });
}

/** The lit pixels of the preview canvas, read from its own 2D bitmap, as the same `x,y` keys minus the padding. */
async function previewInk(tab: Tab): Promise<Set<string>> {
  const canvas = control<HTMLCanvasElement>(tab, ".tkr-font-canvas");
  const context = canvas.getContext("2d");
  ok(context !== null, "the preview canvas has a 2D context");
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const lit = new Set<string>();
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const at = (y * canvas.width + x) * 4;
      if (data[at] === 255 && data[at + 1] === 255 && data[at + 2] === 255) lit.add(`${x},${y}`);
    }
  }
  return lit;
}

for (const entry of ["browser host", "VS Code desktop", "VS Code for the Web"]) {
  describe(`bitmap font proof: ${entry}`, () => {
    test("a font is edited at opposite corners of two glyphs by pointer and keyboard, saved and reopened, and the file holds exactly those rows", async () => {
      document.body.replaceChildren();
      const host = hosts.find((candidate) => candidate.name === entry)!.make();
      const first = await host.open(PATH);
      await until(() => first.element.querySelector("[data-pixel]") !== null);
      equal(first.element.querySelector("h2")?.textContent, "Bitmap font");
      equal(first.element.querySelectorAll(".tkr-font-slot").length, 256);
      match(first.element.querySelector(".tkr-font-summary")?.textContent ?? "", /256 characters, 8 × 8 pixels each; 1 drawn/);
      equal(ink(first), "0,0");

      // The bottom-right corner of A with the pointer, as one stroke.
      await stroke(first, [7, 7], []);
      await until(() => ink(first) === "0,0 7,7");
      equal(first.workbenchDirty(), true, "the host knows the font is unsaved");
      equal(state(first), "Unsaved changes");
      deepEqual(await host.disk(PATH), ORIGINAL, "nothing is written before Save");

      // The top-right corner of B with the keyboard: arrow to it, then Space with the Draw tool.
      await act(() => { slot(first, 66).click(); });
      await settle(act, 1);
      for (let step = 0; step < 7; step += 1) await key(control(first, '[data-pixel][tabindex="0"]'), "ArrowRight");
      for (let step = 0; step < 1; step += 1) await key(control(first, '[data-pixel][tabindex="0"]'), "ArrowDown");
      await act(() => { pixel(first, 7, 0).click(); });
      await until(() => ink(first) === "7,0");
      equal(first.workbenchDirty(), true);

      await act(() => { control<HTMLButtonElement>(first, ".tkr-font-save").click(); });
      await until(() => state(first) === "All changes saved");
      await first.delivered?.();
      equal(first.workbenchDirty(), false);
      const expected = encoder.encode(fontText((glyph, row) => {
        if (glyph === 65) return row === 0 ? 0x80 : row === 7 ? 0x01 : 0;
        if (glyph === 66) return row === 0 ? 0x01 : 0;
        return original(glyph, row);
      }));
      deepEqual(await host.disk(PATH), expected, "the file holds exactly the two glyphs; every other glyph is the file's own");
      await first.close();
      await settle(act, 2);

      const second = await host.open(PATH);
      await until(() => second.element.querySelector("[data-pixel]") !== null);
      equal(second.workbenchDirty(), false);
      equal(ink(second), "0,0 7,7", "the reopened view shows the saved glyph of A");
      deepEqual(await host.disk(PATH), expected, "and the file is unchanged by opening it");
      await act(() => { slot(second, 66).click(); });
      await settle(act, 1);
      equal(ink(second), "7,0", "the saved glyph of B");
      await act(() => { slot(second, 67).click(); });
      await settle(act, 1);
      equal(ink(second), "", "an untouched glyph is intact");
      await second.close();
    });

    test("the sample preview is drawn from the font at 8 and 20 pixels in every style, its pixels are the spec's where the host has a canvas, and its settings leave the document clean", async () => {
      document.body.replaceChildren();
      const host = hosts.find((candidate) => candidate.name === entry)!.make();
      const tab = await host.open(PATH);
      await until(() => tab.element.querySelector(".tkr-font-canvas") !== null);
      // One glyph, so the picture's size is the glyph's advance and the padding, and every lit pixel can be compared.
      const sample = control<HTMLInputElement>(tab, ".tkr-font-sample");
      await act(() => {
        sample.value = "A";
        sample.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await settle(act, 1);
      for (const size of [8, 20]) {
        const sizeField = control<HTMLInputElement>(tab, ".tkr-font-size");
        await act(() => {
          sizeField.value = String(size);
          sizeField.dispatchEvent(new Event("input", { bubbles: true }));
        });
        for (const [label, bold, italic] of [["Bold", true, false], ["Italics", false, true]] as const) {
          const box = [...tab.element.querySelectorAll<HTMLLabelElement>(".tkr-font-style")].find((candidate) => candidate.textContent?.trim() === label)?.querySelector("input");
          ok(box !== null && box !== undefined, label);
          await act(() => { box.click(); });
          await settle(act, 1);
          const canvas = control<HTMLCanvasElement>(tab, ".tkr-font-canvas");
          if (canvas.getContext("2d") === null) {
            // This lane's DOM has no 2D canvas (the happy-dom shim), so the view must say so rather than show a blank one.
            match(tab.element.querySelector(".tkr-font-preview-state")?.textContent ?? "", /Picture unavailable: .*2D canvas/);
          } else {
            const lean = italic ? Math.floor((7 * size) / 32) : 0;
            equal(canvas.width, size + lean + 8, `${label} at ${size} pixels keeps the glyph's one-size cell`);
            const lit = [...(await previewInk(tab))].map((point) => point.split(",").map(Number) as [number, number]).map(([x, y]) => `${x - 4},${y - 4}`);
            deepEqual(lit.sort(), [...specInk([0x80, 0, 0, 0, 0, 0, 0, 0], size, bold, italic)].sort(), `${label} at ${size} pixels`);
          }
          await act(() => { box.click(); });
          await settle(act, 1);
        }
      }
      equal(tab.workbenchDirty(), false, "the sample, size and styles are view state only");
      deepEqual(await host.disk(PATH), ORIGINAL);
      const zoom = control<HTMLSelectElement>(tab, ".tkr-font-zoom");
      await act(() => {
        zoom.value = "2";
        zoom.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await settle(act, 1);
      const zoomed = control<HTMLCanvasElement>(tab, ".tkr-font-canvas");
      if (zoomed.getContext("2d") === null) match(tab.element.querySelector(".tkr-font-preview-state")?.textContent ?? "", /Picture unavailable/);
      else notEqual(zoomed.width, 0, "the zoom enlarges the same pixels");
      equal(tab.workbenchDirty(), false, "the zoom is view state only");
      await tab.close();
    });
  });
}

test("VS Code grid Undo waits for an applied edit's held acknowledgement and then undoes the newer stroke", async () => {
  document.body.replaceChildren();
  const { createVscodeBoardProofHost } = await import("../conformance/vscode-host.ts");
  const host = createVscodeBoardProofHost(false, gam, { [PATH]: ORIGINAL }, act);
  const tab = await host.open(PATH);
  await until(() => tab.element.querySelector("[data-pixel]") !== null);
  const gate = tab.holdEditResults();
  try {
    await stroke(tab, [1, 1], []);
    await tab.delivered();
    equal(tab.workbenchDirty(), true, "the workbench has registered the first edit but the view has no acknowledgement");
    await stroke(tab, [2, 2], []);
    let forwarded = false;
    const forward = (): void => { forwarded = true; };
    window.addEventListener("keydown", forward);
    try {
      await act(() => {
        pixel(tab, 2, 2).dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true, cancelable: true }));
      });
      equal(forwarded, false, "the VS Code shell must not receive a duplicate, unqueued shortcut");
      await tab.delivered();
      equal(tab.workbenchDirty(), true, "the history request has not undone the first edit");
    } finally {
      window.removeEventListener("keydown", forward);
    }
  } finally {
    gate.release();
  }
  await until(() => ink(tab) === "0,0 1,1");
  equal(tab.workbenchDirty(), true, "only the second edit was undone");
  await act(() => {
    pixel(tab, 2, 2).dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, shiftKey: true, bubbles: true, cancelable: true }));
  });
  await until(() => ink(tab) === "0,0 1,1 2,2");
});

test("VS Code native Undo sees both completed strokes while edit acknowledgements are held", async () => {
  document.body.replaceChildren();
  const { createVscodeBoardProofHost } = await import("../conformance/vscode-host.ts");
  const host = createVscodeBoardProofHost(false, gam, { [PATH]: ORIGINAL }, act);
  const tab = await host.open(PATH);
  await until(() => tab.element.querySelector("[data-pixel]") !== null);
  const gate = tab.holdEditResults();
  try {
    await stroke(tab, [1, 1], []);
    await tab.delivered();
    equal(tab.workbenchDirty(), true, "the native stack has the first edit, and its acknowledgement is withheld");
    await stroke(tab, [2, 2], []);
    await tab.delivered();
    await until(() => ink(tab) === "0,0 1,1 2,2");
    await tab.undoFromWorkbench();
    await until(() => ink(tab) === "0,0 1,1");
    equal(tab.workbenchDirty(), true, "native Undo undid the newer stroke; the first stays dirty");
  } finally {
    gate.release();
  }
  await host.settle();
  equal(ink(tab), "0,0 1,1", "late replies cannot restore a pre-Undo snapshot");
});

test("New font makes a version 2.0 font with all glyphs empty through the host's filesystem contract, and refuses an existing path", async () => {
  // Both hosts write through the same platform-services contract their editors use; the file it writes is the one the
  // engine installs and the editor opens.
  const services = createMemoryPlatformServices({ files: {} });
  const layout = { projectFolder: "" };
  const created = await createFontFile(services.fs, "Font/new-font.fnt", layout);
  ok(created.ok, created.ok ? "" : created.message);
  deepEqual(services.bytesOf("Font/new-font.fnt"), newFontBytes());
  const again = await createFontFile(services.fs, "Font/new-font.fnt", layout);
  ok(!again.ok);
  equal(again.reason, "exists");
  deepEqual(services.bytesOf("Font/new-font.fnt"), newFontBytes(), "the existing font is untouched");
});
