import { after, before, test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createDocumentIdentity, openSpriteDocument, type SpriteActorKind, type SpriteDocument } from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices, type MemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import type { ViewContext, ViewHandle } from "../src/mount.ts";
import { exampleCharacter, exampleItem } from "./fixtures.ts";

const CASES = [
  { kind: "character", path: "Chrs/hero.tem", bytes: exampleCharacter() },
  { kind: "item", path: "Item/chest.itm", bytes: exampleItem() },
] as const;

let mount: (el: HTMLElement, context: ViewContext) => ViewHandle;
let act: (callback: () => void | Promise<void>) => Promise<void> | void;

before(async () => {
  GlobalRegistrator.register();
  // Preact binds its event system to the host DOM; load it after happy-dom has installed that host.
  ({ act } = await import("preact/test-utils"));
  ({ mount } = await import("../dist/mount.js"));
});

after(() => GlobalRegistrator.unregister());

interface Setup {
  readonly host: MemoryPlatformServices;
  readonly doc: SpriteDocument;
  readonly el: HTMLElement;
}

async function setup(kind: SpriteActorKind, path: string, bytes: Uint8Array): Promise<Setup> {
  const host = createMemoryPlatformServices({ files: { [path]: bytes } });
  const opened = await openSpriteDocument(kind, host.fs, createDocumentIdentity("memory-project", path));
  if (!opened.ok) throw new Error(`could not open ${path}: ${JSON.stringify(opened.error)}`);
  const el = document.createElement("div");
  document.body.append(el);
  return { host, doc: opened.document, el };
}

async function show(s: Setup): Promise<ViewHandle> {
  let handle: ViewHandle | undefined;
  await act(() => { handle = mount(s.el, { document: s.doc, services: s.host }); });
  if (handle === undefined) throw new Error("mount returned nothing");
  return handle;
}

async function input(el: HTMLElement, selector: string, value: string): Promise<void> {
  await act(() => {
    const field = el.querySelector<HTMLInputElement>(selector);
    if (field === null) throw new Error(`no input ${selector}`);
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

test("characters and items share accessible stance, filename assignment and numeric polygon editing", async () => {
  for (const entry of CASES) {
    const s = await setup(entry.kind, entry.path, entry.bytes);
    const handle = await show(s);
    equal(s.el.querySelector(".tkr-sprite-graphics")?.getAttribute("aria-label"), `${entry.kind} sprite graphics`);
    equal(s.el.querySelectorAll('input[aria-label$="animation file"]').length >= 16, true, "walk and idle directions are independently named inputs");
    equal(s.el.querySelector("fieldset legend")?.textContent, "Directional walk animations");
    const assign = [...s.el.querySelectorAll("button")].find((button) => button.textContent === "Assign eight directions");
    ok(assign !== undefined, "filename wizard is available");

    await input(s.el, 'input[placeholder="hero_walk_*.anm"]', "Misc/hero_walk_*.anm");
    await act(async () => { assign?.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    deepEqual(s.doc.getSnapshot().movementAnimations, ["Misc/hero_walk_S.anm", "Misc/hero_walk_N.anm", "Misc/hero_walk_E.anm", "Misc/hero_walk_W.anm", "Misc/hero_walk_NW.anm", "Misc/hero_walk_NE.anm", "Misc/hero_walk_SW.anm", "Misc/hero_walk_SE.anm"]);
    const legends = [...s.el.querySelectorAll("legend")].map((legend) => legend.textContent);
    equal(legends.includes("Battle stances"), entry.kind === "character", "battle slots are specific to characters");

    await act(() => s.el.querySelector<HTMLButtonElement>('button[aria-pressed="false"]')?.click());
    const coordinateLabel = [...s.el.querySelectorAll("label")].find((label) => label.textContent === "Point 1 X");
    if (coordinateLabel === undefined) throw new Error("numeric polygon X coordinate label is missing");
    const coordinate = s.el.querySelector<HTMLInputElement>(`#${coordinateLabel.htmlFor}`);
    if (coordinate === null) throw new Error("numeric polygon coordinate is missing");
    const yLabel = [...s.el.querySelectorAll("label")].find((label) => label.textContent === "Point 1 Y");
    if (yLabel === undefined) throw new Error("numeric polygon Y coordinate is missing");
    const yCoordinate = s.el.querySelector<HTMLInputElement>(`#${yLabel.htmlFor}`);
    if (yCoordinate === null) throw new Error("numeric polygon Y coordinate is missing");
    await act(async () => {
      coordinate.value = "-12";
      coordinate.dispatchEvent(new Event("change", { bubbles: true }));
      yCoordinate.value = "7";
      yCoordinate.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    deepEqual(s.doc.getSnapshot().vectorBases?.[1]?.points[0], { x: -12, y: 7 }, "fast X/Y edits preserve both axes");
    const pointCount = s.doc.getSnapshot().vectorBases?.[1]?.points.length ?? 0;
    await act(async () => {
      const svg = s.el.querySelector<SVGSVGElement>(".tkr-sprite-base-canvas");
      ok(svg !== null);
      svg.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    equal(s.doc.getSnapshot().vectorBases?.[1]?.points.length, pointCount, "a background pointer down does not drag vertex zero");
    await act(async () => {
      const add = [...s.el.querySelectorAll("button")].find((button) => button.textContent === "Add polygon point at origin");
      ok(add !== undefined);
      add.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    equal(s.doc.getSnapshot().vectorBases?.[1]?.points.length, pointCount + 1, "polygon points can be added with the keyboard-accessible button");

    await act(async () => {
      const save = [...s.el.querySelectorAll("button")].find((button) => button.textContent === "Save sprite");
      if (save === undefined) throw new Error("Save sprite button is missing");
      save.click();
      await s.doc.save();
    });
    deepEqual(s.host.bytesOf(entry.path), s.doc.serialize(), "Save writes the edited actor bytes");
    handle.dispose();
    s.el.remove();
  }
});
