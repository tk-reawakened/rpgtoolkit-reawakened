import { after, before, test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createDocumentIdentity, openSpriteDocument, type ApplyResult, type SpriteActorKind, type SpriteCommand, type SpriteDocument } from "@tk-reawakened/editor-model";
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
function replaceApply(doc: SpriteDocument, apply: (command: SpriteCommand) => Promise<ApplyResult>): void {
  // Inject delayed host behavior while preserving the production model's synchronous apply contract.
  const delayedDocument = doc as unknown as { apply: (command: SpriteCommand) => Promise<ApplyResult> };
  delayedDocument.apply = apply;
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
test("custom stance drafts stay with their stance across acknowledgement and deletion", async () => {
  const s = await setup("character", "Chrs/drafts.tem", exampleCharacter());
  ok((await s.doc.apply({ type: "add-custom-stance", name: "First", file: "" })).ok);
  ok((await s.doc.apply({ type: "add-custom-stance", name: "Second", file: "" })).ok);
  const handle = await show(s);
  const rows = () => [...s.el.querySelectorAll<HTMLElement>(".tkr-sprite-custom")];
  const animation = rows()[2]?.querySelectorAll<HTMLInputElement>("input")[1];
  const name = rows()[1]?.querySelector<HTMLInputElement>("input");
  if (animation === undefined || name === null || name === undefined) throw new Error("custom stance inputs are missing");
  await act(() => {
    animation.value = "second-unsaved.anm";
    animation.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => {
    name.value = "First renamed";
    name.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => { name.focus(); animation.focus(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  equal(s.doc.getSnapshot().customStances[1]?.handle, "First renamed");
  equal(rows()[2]?.querySelectorAll<HTMLInputElement>("input")[1]?.value, "second-unsaved.anm", "acknowledging one stance does not clear another stance's typed draft");
  await act(async () => {
    rows()[1]?.querySelector<HTMLButtonElement>("button")?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  equal(s.doc.getSnapshot().customStances.length, 2);
  equal(rows()[1]?.querySelectorAll<HTMLInputElement>("input")[1]?.value, "second-unsaved.anm", "deleting a row does not shift its neighbor's draft");
  handle.dispose();
  s.el.remove();
});

test("duplicate stance rename keeps stable row drafts through a deferred acknowledgement", async () => {
  const s = await setup("character", "Chrs/duplicate-drafts.tem", exampleCharacter());
  ok((await s.doc.apply({ type: "add-custom-stance", name: "First", file: "" })).ok);
  ok((await s.doc.apply({ type: "add-custom-stance", name: "Second", file: "" })).ok);
  const apply = s.doc.apply.bind(s.doc);
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const firstApply = new Promise<void>((resolve) => { started = resolve; });
  replaceApply(s.doc, async (command) => {
    if (command.type === "rename-custom-stance") {
      started();
      await gate;
    }
    return apply(command);
  });
  const handle = await show(s);
  const rows = () => [...s.el.querySelectorAll<HTMLElement>(".tkr-sprite-custom")];
  const firstName = rows()[1]?.querySelector<HTMLInputElement>("input");
  const secondAnimation = rows()[2]?.querySelectorAll<HTMLInputElement>("input")[1];
  if (firstName == null || secondAnimation == null) throw new Error("duplicate custom stance inputs are missing");
  await act(() => {
    secondAnimation.value = "second-row-draft.anm";
    secondAnimation.dispatchEvent(new Event("input", { bubbles: true }));
    firstName.value = "Second";
    firstName.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => { firstName.focus(); secondAnimation.focus(); });
  await firstApply;
  await act(() => {
    firstName.value = "Second newer draft";
    firstName.dispatchEvent(new Event("input", { bubbles: true }));
  });
  release();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  deepEqual(s.doc.getSnapshot().customStances.slice(-2).map((stance) => stance.handle), ["Second", "Second"]);
  equal(rows()[1]?.querySelector<HTMLInputElement>("input")?.value, "Second newer draft", "acknowledgement does not clear a newer draft for the same renamed row");
  equal(rows()[2]?.querySelectorAll<HTMLInputElement>("input")[1]?.value, "second-row-draft.anm", "a duplicate rename cannot transfer the neighboring row's draft");
  handle.dispose();
  s.el.remove();
});

test("Add point queued behind a rejected coordinate rebases on acknowledged geometry", async () => {
  const s = await setup("character", "Chrs/rejected-add-point.tem", exampleCharacter());
  const originalBases = s.doc.getSnapshot().vectorBases!;
  const originalPoint = originalBases[1]!.points[0]!;
  const originalLength = originalBases[1]!.points.length;
  const apply = s.doc.apply.bind(s.doc);
  const rejection = s.doc.apply({ type: "set-sprite-bases", bases: [] });
  ok(!rejection.ok);
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const firstApply = new Promise<void>((resolve) => { started = resolve; });
  let rejectFirst = true;
  replaceApply(s.doc, async (command) => {
    if (command.type === "set-sprite-bases" && rejectFirst) {
      rejectFirst = false;
      started();
      await gate;
      return rejection;
    }
    return apply(command);
  });
  const handle = await show(s);
  await act(() => s.el.querySelector<HTMLButtonElement>('button[aria-pressed="false"]')?.click());
  const xLabel = [...s.el.querySelectorAll("label")].find((label) => label.textContent === "Point 1 X");
  ok(xLabel !== undefined);
  const x = s.el.querySelector<HTMLInputElement>(`#${xLabel.htmlFor}`);
  ok(x !== null);
  await act(() => { x.value = "-12"; x.dispatchEvent(new Event("change", { bubbles: true })); });
  await firstApply;
  await act(() => {
    const add = [...s.el.querySelectorAll("button")].find((button) => button.textContent === "Add polygon point at origin");
    ok(add !== undefined);
    add.click();
  });
  release();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const points = s.doc.getSnapshot().vectorBases![1]!.points;
  deepEqual(points[0], originalPoint, "the rejected coordinate is not carried into the next edit");
  equal(points.length, originalLength + 1, "Add appends to the acknowledged polygon");
  deepEqual(points.at(-1), { x: 0, y: 0 });
  handle.dispose();
  s.el.remove();
});
test("conflict reload discards filename drafts and a later blur cannot restore them", async () => {
  const path = "Chrs/conflict-reload.tem";
  const s = await setup("character", path, exampleCharacter());
  const remote = await openSpriteDocument("character", s.host.fs, createDocumentIdentity("memory-project", path));
  if (!remote.ok) throw new Error("could not open the remote sprite revision");
  ok((await s.doc.apply({ type: "set-sprite-timing", speed: 0.5, idleTime: 4 })).ok);
  ok(remote.document.apply({ type: "set-sprite-timing", speed: 1.25, idleTime: 2 }).ok);
  const externalBytes = remote.document.serialize();
  const externalWrite = await s.host.fs.writeProject("memory-project", path, externalBytes);
  ok(externalWrite.ok);
  const handle = await show(s);
  const field = s.el.querySelector<HTMLInputElement>('input[aria-label="South animation file"]');
  ok(field !== null);
  await act(() => {
    field.value = "Misc/discard-this-draft.anm";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.focus();
  });
  equal(await s.doc.checkExternal(), "conflict");
  const reload = [...s.el.querySelectorAll("button")].find((button) => button.textContent === "Reload from disk");
  ok(reload !== undefined);
  await act(async () => { reload.click(); await Promise.resolve(); });
  equal(s.doc.getSnapshot().conflict, null);
  equal(s.doc.getSnapshot().dirty, false);
  equal(s.doc.getSnapshot().speed, 1.25);
  equal(field.value, remote.document.getSnapshot().movementAnimations[0], "reload removes the unsubmitted filename draft and reveals disk content");
  const reloadedBytes = s.doc.serialize();
  await act(() => { field.focus(); field.blur(); });
  equal(s.doc.getSnapshot().movementAnimations[0], remote.document.getSnapshot().movementAnimations[0], "blur after reload cannot apply the discarded filename");
  equal(s.doc.getSnapshot().dirty, false);
  deepEqual(s.doc.serialize(), reloadedBytes);
  handle.dispose();
  s.el.remove();
});

test("sprite save waits for queued polygon edits and writes their acknowledged bytes", async () => {
  const s = await setup("character", "Chrs/queued-save.tem", exampleCharacter());
  ok((await s.doc.apply({ type: "set-sprite-timing", speed: 1.25, idleTime: 0.25 })).ok);
  const apply = s.doc.apply.bind(s.doc);
  const save = s.doc.save.bind(s.doc);
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const firstApply = new Promise<void>((resolve) => { started = resolve; });
  const order: string[] = [];
  replaceApply(s.doc, async (command) => {
    if (command.type === "set-sprite-bases") {
      order.push("base-start");
      started();
      await gate;
      order.push("base-finished");
    }
    return apply(command);
  });
  s.doc.save = async () => { order.push("save"); return save(); };
  const handle = await show(s);
  const xLabel = [...s.el.querySelectorAll("label")].find((label) => label.textContent === "Point 1 X");
  ok(xLabel !== undefined);
  const x = s.el.querySelector<HTMLInputElement>(`#${xLabel.htmlFor}`);
  ok(x !== null);
  await act(() => { x.value = "-13"; x.dispatchEvent(new Event("change", { bubbles: true })); });
  await firstApply;
  await act(async () => {
    const saveButton = [...s.el.querySelectorAll("button")].find((button) => button.textContent === "Save sprite");
    ok(saveButton !== undefined);
    saveButton.click();
    await Promise.resolve();
  });
  deepEqual(order, ["base-start"], "Save waits rather than overtaking the pending polygon operation");
  release();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  deepEqual(order, ["base-start", "base-finished", "save"]);
  equal(s.doc.getSnapshot().dirty, false);
  deepEqual(s.host.bytesOf("Chrs/queued-save.tem"), s.doc.serialize());
  handle.dispose();
  s.el.remove();
});

test("a rejected polygon edit is removed before a later queued edit is applied", async () => {
  const s = await setup("character", "Chrs/rejected-queue.tem", exampleCharacter());
  const original = s.doc.getSnapshot().vectorBases?.[1]?.points[0];
  ok(original !== undefined);
  const apply = s.doc.apply.bind(s.doc);
  const rejection = s.doc.apply({ type: "set-sprite-bases", bases: [] });
  ok(!rejection.ok);
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const firstApply = new Promise<void>((resolve) => { started = resolve; });
  let rejectFirst = true;
  replaceApply(s.doc, async (command) => {
    if (command.type === "set-sprite-bases" && rejectFirst) {
      rejectFirst = false;
      started();
      await gate;
      return rejection;
    }
    return apply(command);
  });
  const handle = await show(s);
  await act(() => s.el.querySelector<HTMLButtonElement>('button[aria-pressed="false"]')?.click());
  const xLabel = [...s.el.querySelectorAll("label")].find((label) => label.textContent === "Point 1 X");
  const yLabel = [...s.el.querySelectorAll("label")].find((label) => label.textContent === "Point 1 Y");
  ok(xLabel !== undefined && yLabel !== undefined);
  const x = s.el.querySelector<HTMLInputElement>(`#${xLabel.htmlFor}`);
  const y = s.el.querySelector<HTMLInputElement>(`#${yLabel.htmlFor}`);
  ok(x !== null && y !== null);
  await act(() => {
    x.value = "-12";
    x.dispatchEvent(new Event("change", { bubbles: true }));
    y.value = "7";
    y.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await firstApply;
  release();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  deepEqual(s.doc.getSnapshot().vectorBases?.[1]?.points[0], { x: original.x, y: 7 }, "the second edit rebases on confirmed state instead of inheriting rejected X");
  handle.dispose();
  s.el.remove();
});
