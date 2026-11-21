import { after, before, test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createDocumentIdentity, openNativeGeometryDocument, type NativeGeometryKind } from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import type { mount as mountEditor } from "../src/index.ts";

let mount: typeof mountEditor;
let act: (callback: () => void | Promise<void>) => void | Promise<void>;
before(async () => {
  // The UI reads browser globals at module initialization, so register the DOM before loading it.
  GlobalRegistrator.register();
  ({ act } = await import("preact/test-utils"));
  ({ mount } = await import("@tk-reawakened/editor-ui"));
});
after(() => GlobalRegistrator.unregister());

const TILE_PATH = "Tiles/fence.tkrtle";
const PACK_PATH = "Packs/props.tkrpack";
const TILE = `contract: tile
version: 1.0.0-pre.1
# A village fence.
name: Fence # display name
projection: 2d
role: decorative
visual:
  transparent: {mode: alpha}
  sample: {file: art/fence.png, rect: [0, 0, 32, 32]} # sample
pluginData:
  com.example.glow:
    version: 1.0.0
    data: {bloom: 0.4} # opaque
`;
const PACK = `contract: asset-pack
version: 1.0.0-pre.1
name: Props
projection: 2d
grid:
  tileWidth: 32
  tileHeight: 32
sources:
  - id: atlas
    file: Bitmap/props.png
assets:
  - id: gate
    name: Gate
    kind: prop
    anchor: {x: 16, y: 32, snap: bottom-center}
    visuals:
      - source: atlas
        rect: [0, 0, 32, 32]
  - id: fence
    name: Fence
    kind: prop
    anchor: {x: 16, y: 32, snap: bottom-center}
    visuals:
      - source: atlas
        rect: [32, 0, 32, 32]
`;
const RAIL_LINE = "  - {label: Rail, closed: false, points: [[-4, 20], [36, 20]]}";
const WITH_RAIL = TILE.replace("# sample\n", `# sample\nsolid:\n${RAIL_LINE}\n`);

async function open(kind: NativeGeometryKind, path: string, text: string) {
  const host = createMemoryPlatformServices({ files: { [path]: new TextEncoder().encode(text) } });
  const opened = await openNativeGeometryDocument(kind, host.fs, createDocumentIdentity("memory-project", path));
  ok(opened.ok);
  const root = document.createElement("div");
  document.body.append(root);
  const handle = mount(root, { document: opened.document, services: host });
  const text_ = () => new TextDecoder().decode(opened.document.serialize());
  return { doc: opened.document, root, handle, text: text_ };
}

const buttonOf = (root: HTMLElement, label: string): HTMLButtonElement => {
  const found = [...root.querySelectorAll("button")].find((candidate) => candidate.textContent === label || candidate.getAttribute("aria-label") === label);
  ok(found, `no button named ${label}`);
  return found;
};
const fieldOf = (root: HTMLElement, label: string): HTMLInputElement | HTMLSelectElement => {
  const found = [...root.querySelectorAll("label")].find((candidate) => candidate.textContent?.trim() === label);
  const control = found?.control;
  ok(control instanceof HTMLInputElement || control instanceof HTMLSelectElement, `no field labelled ${label}`);
  return control;
};
const click = (button: HTMLElement) => act(() => button.click());
const type = (input: HTMLInputElement, value: string) => act(() => { input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); });
const check = (input: HTMLInputElement, checked: boolean) => act(() => { input.checked = checked; input.dispatchEvent(new Event("change", { bubbles: true })); });
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const status = (root: HTMLElement): string => root.querySelector("[data-tkr-geometry-status]")?.textContent ?? "";

test("a fence barrier is drawn from labelled fields, applied once, and the author's text stays", async () => {
  const { doc, root, handle, text } = await open("native-tile", TILE_PATH, TILE);
  try {
    ok(root.querySelector("section[data-tkr-geometry]"), "the editor region is present");
    ok(root.querySelector("svg[data-tkr-geometry-canvas]"), "the drawing surface is present");
    await click(buttonOf(root, "New solid barrier"));
    ok(buttonOf(root, "Apply shape").disabled, "an empty draft cannot be applied");
    await type(fieldOf(root, "Shape label") as HTMLInputElement, "Rail");
    await click(buttonOf(root, "Add point"));
    await click(buttonOf(root, "Add point"));
    await type(fieldOf(root, "Point 1 X") as HTMLInputElement, "-4");
    await type(fieldOf(root, "Point 1 Y") as HTMLInputElement, "20");
    await type(fieldOf(root, "Point 2 X") as HTMLInputElement, "36");
    await type(fieldOf(root, "Point 2 Y") as HTMLInputElement, "20");
    equal(buttonOf(root, "Apply shape").disabled, false);
    equal(text(), TILE, "nothing is written before Apply");
    await click(buttonOf(root, "Apply shape"));
    await settle();
    equal(text(), WITH_RAIL);
    equal(doc.getSnapshot().edits.length, 1);
    equal(root.querySelector("fieldset[aria-label='Shape being drawn']"), null, "the draft closes after Apply");
    ok(root.querySelector("[data-tkr-shape='solid:0']"), "the barrier is listed");
  } finally { handle.dispose(); root.remove(); }
});

test("cancelling a draft writes nothing and leaves the document clean", async () => {
  const { doc, root, handle, text } = await open("native-tile", TILE_PATH, TILE);
  try {
    await click(buttonOf(root, "New walk-behind region"));
    await type(fieldOf(root, "Shape label") as HTMLInputElement, "Roof");
    await click(buttonOf(root, "Add point"));
    await click(buttonOf(root, "Cancel draft"));
    equal(root.querySelector("fieldset[aria-label='Shape being drawn']"), null);
    ok(status(root).includes("Nothing was written"));
    equal(text(), TILE);
    equal(doc.getSnapshot().dirty, false);
    equal(doc.getSnapshot().edits.length, 0);
  } finally { handle.dispose(); root.remove(); }
});

test("a point needs whole numbers and enough company; the reason is shown and Apply waits", async () => {
  const { root, handle } = await open("native-tile", TILE_PATH, TILE);
  try {
    await click(buttonOf(root, "New solid barrier"));
    await type(fieldOf(root, "Shape label") as HTMLInputElement, "Rail");
    await click(buttonOf(root, "Add point"));
    ok(buttonOf(root, "Apply shape").disabled);
    ok(root.querySelector("[data-tkr-geometry-problem]")?.textContent?.includes("at least two points"));
    await click(buttonOf(root, "Add point"));
    await type(fieldOf(root, "Point 2 X") as HTMLInputElement, "1.5");
    ok(root.querySelector("[data-tkr-geometry-problem]")?.textContent?.includes("Point 2 X must be a whole number"));
    await type(fieldOf(root, "Point 2 X") as HTMLInputElement, "-8");
    equal(buttonOf(root, "Apply shape").disabled, false, "negative whole numbers are fine");
    await check(fieldOf(root, "Closed") as HTMLInputElement, true);
    ok(root.querySelector("[data-tkr-geometry-problem]")?.textContent?.includes("at least three points"));
  } finally { handle.dispose(); root.remove(); }
});

test("clicking the drawing adds a whole-pixel point only while a shape is open", async () => {
  const { root, handle } = await open("native-tile", TILE_PATH, TILE);
  try {
    const surface = root.querySelector("svg[data-tkr-geometry-canvas]") as SVGSVGElement;
    // The 32-pixel tile and its margin span authored x and y from -8 to 40: one screen unit is one authored pixel here.
    surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 48, height: 48, right: 48, bottom: 48, x: 0, y: 0, toJSON: () => ({}) });
    await act(() => { surface.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 12, clientY: 28 })); });
    equal(root.querySelector("fieldset[aria-label='Shape being drawn']"), null, "no draft, no point");
    await click(buttonOf(root, "New solid barrier"));
    await act(() => { surface.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 12, clientY: 28 })); });
    equal((fieldOf(root, "Point 1 X") as HTMLInputElement).value, "4");
    equal((fieldOf(root, "Point 1 Y") as HTMLInputElement).value, "20");
    await act(() => { surface.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 16, clientY: 16 })); });
    ok(root.textContent?.includes("Pointer: 8, 8."));
  } finally { handle.dispose(); root.remove(); }
});

test("an existing barrier is edited, then removed, and the document returns to its first text", async () => {
  const { doc, root, handle, text } = await open("native-tile", TILE_PATH, WITH_RAIL);
  try {
    await click(root.querySelector("[data-tkr-shape='solid:0']") as HTMLElement);
    equal((fieldOf(root, "Shape label") as HTMLInputElement).value, "Rail");
    equal((fieldOf(root, "Point 1 X") as HTMLInputElement).value, "-4");
    await type(fieldOf(root, "Point 2 X") as HTMLInputElement, "40");
    await click(buttonOf(root, "Apply shape"));
    await settle();
    equal(text(), TILE.replace("# sample\n", "# sample\nsolid:\n  - {label: Rail, closed: false, points: [[-4, 20], [40, 20]]}\n"));
    await click(root.querySelector("[data-tkr-shape='solid:0']") as HTMLElement);
    await click(buttonOf(root, "Remove shape"));
    await settle();
    equal(text(), TILE);
    equal(doc.getSnapshot().edits.length, 2);
    ok(doc.undo().ok);
    ok(doc.undo().ok);
    equal(text(), WITH_RAIL);
  } finally { handle.dispose(); root.remove(); }
});

test("a walk-behind region is always closed and carries the chosen mask bits", async () => {
  const { root, handle, text } = await open("native-tile", TILE_PATH, TILE);
  try {
    await click(buttonOf(root, "New walk-behind region"));
    ok(!root.textContent?.includes("Closed"), "walk-behind has no open or closed choice");
    await type(fieldOf(root, "Shape label") as HTMLInputElement, "Upper gate");
    await check(fieldOf(root, "Covers background") as HTMLInputElement, true);
    await check(fieldOf(root, "Intersects the frame") as HTMLInputElement, true);
    for (const [x, y] of [["0", "0"], ["32", "0"], ["32", "-24"]] as const) {
      await click(buttonOf(root, "Add point"));
      const at = root.querySelectorAll("ol[aria-label='Points'] > li").length;
      await type(fieldOf(root, `Point ${at} X`) as HTMLInputElement, x);
      await type(fieldOf(root, `Point ${at} Y`) as HTMLInputElement, y);
    }
    await click(buttonOf(root, "Apply shape"));
    await settle();
    equal(text(), TILE.replace("# sample\n", "# sample\nunder:\n  - {label: Upper gate, attributes: 5, closed: true, points: [[0, 0], [32, 0], [32, -24]]}\n"));
  } finally { handle.dispose(); root.remove(); }
});

test("a pack asset is chosen first; the other asset and the pack's text are not touched", async () => {
  const { root, handle, text } = await open("native-asset-pack", PACK_PATH, PACK);
  try {
    const select = fieldOf(root, "Pack asset") as HTMLSelectElement;
    deepEqual([...select.options].map((option) => option.value), ["gate", "fence"]);
    await act(() => { select.value = "fence"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await click(buttonOf(root, "New solid barrier"));
    ok((fieldOf(root, "Pack asset") as HTMLSelectElement).disabled, "the asset cannot change under an open draft");
    await type(fieldOf(root, "Shape label") as HTMLInputElement, "Rail");
    await click(buttonOf(root, "Add point"));
    await click(buttonOf(root, "Add point"));
    await type(fieldOf(root, "Point 1 X") as HTMLInputElement, "-16");
    await type(fieldOf(root, "Point 1 Y") as HTMLInputElement, "-8");
    await type(fieldOf(root, "Point 2 X") as HTMLInputElement, "16");
    await type(fieldOf(root, "Point 2 Y") as HTMLInputElement, "-8");
    await click(buttonOf(root, "Apply shape"));
    await settle();
    equal(text(), PACK.replace("        rect: [32, 0, 32, 32]\n", "        rect: [32, 0, 32, 32]\n    solid:\n      - {label: Rail, closed: false, points: [[-16, -8], [16, -8]]}\n"));
  } finally { handle.dispose(); root.remove(); }
});

test("a draft for an asset that disappears from the authoritative text is discarded, never committed into the fallback asset", async () => {
  const { doc, root, handle, text } = await open("native-asset-pack", PACK_PATH, PACK);
  try {
    await act(() => { const select = fieldOf(root, "Pack asset") as HTMLSelectElement; select.value = "fence"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await click(buttonOf(root, "New solid barrier"));
    await type(fieldOf(root, "Shape label") as HTMLInputElement, "Rail");
    await click(buttonOf(root, "Add point"));
    await click(buttonOf(root, "Add point"));
    await type(fieldOf(root, "Point 2 X") as HTMLInputElement, "8");
    equal(buttonOf(root, "Apply shape").disabled, false);
    // The document itself changes: a restored version has no `fence` asset, so the view would fall back to `gate`.
    const gateOnly = PACK.slice(0, PACK.indexOf("  - id: fence"));
    const restored = doc.restoreVersion(new TextEncoder().encode(gateOnly));
    ok(restored.ok);
    await settle();
    equal(root.querySelector("fieldset[aria-label='Shape being drawn']"), null, "the stale draft is gone");
    ok(status(root).includes("draft was discarded"));
    deepEqual([...(fieldOf(root, "Pack asset") as HTMLSelectElement).options].map((option) => option.value), ["gate"]);
    equal(text(), gateOnly, "nothing was written into the remaining asset");
    equal(doc.getSnapshot().edits.length, 1);
  } finally { handle.dispose(); root.remove(); }
});
