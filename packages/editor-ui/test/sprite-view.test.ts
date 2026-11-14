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

test("undo restores a deleted stance identity at its original row after delayed acknowledgement", async () => {
  const s = await setup("character", "Chrs/undo-stance.tem", exampleCharacter());
  ok((await s.doc.apply({ type: "add-custom-stance", name: "First", file: "" })).ok);
  ok((await s.doc.apply({ type: "add-custom-stance", name: "Second", file: "" })).ok);
  const apply = s.doc.apply.bind(s.doc);
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const deleteStarted = new Promise<void>((resolve) => { started = resolve; });
  replaceApply(s.doc, async (command) => {
    const result = await apply(command);
    if (command.type === "delete-custom-stance" && command.index === 1) {
      started();
      await gate;
    }
    return result;
  });
  const handle = await show(s);
  const rows = () => [...s.el.querySelectorAll<HTMLElement>(".tkr-sprite-custom")];
  const secondAnimation = rows()[2]?.querySelectorAll<HTMLInputElement>("input")[1];
  if (secondAnimation == null) throw new Error("second custom stance animation input is missing");
  await act(() => {
    secondAnimation.value = "following-row-draft.anm";
    secondAnimation.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => rows()[1]?.querySelector<HTMLButtonElement>("button")?.click());
  await act(async () => { await deleteStarted; await new Promise((resolve) => setTimeout(resolve, 0)); });
  equal(rows()[1]?.querySelectorAll<HTMLInputElement>("input")[1]?.value, "following-row-draft.anm", "snapshot-before-result removes the deleted key immediately so the draft stays with its row");
  release();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  equal(s.doc.getSnapshot().customStances.at(-1)?.handle, "Second");
  await act(() => { ok(s.doc.undo().ok, "the acknowledged stance deletion can be undone"); });
  deepEqual(s.doc.getSnapshot().customStances.slice(-2).map((stance) => stance.handle), ["First", "Second"]);
  equal(rows()[2]?.querySelectorAll<HTMLInputElement>("input")[1]?.value, "following-row-draft.anm", "undo reinserts the deleted row key before the following stance without moving its draft");
  handle.dispose();
  s.el.remove();
});

test("duplicate stance deletes undo against their exact history identities", async () => {
  const s = await setup("character", "Chrs/duplicate-stance-undo.tem", exampleCharacter());
  ok((await s.doc.apply({ type: "add-custom-stance", name: "X", file: "" })).ok);
  ok((await s.doc.apply({ type: "add-custom-stance", name: "X", file: "" })).ok);
  const handle = await show(s);
  const rows = () => [...s.el.querySelectorAll<HTMLElement>(".tkr-sprite-custom")];
  await act(() => rows()[1]?.querySelector<HTMLButtonElement>("button")?.click());
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(() => rows()[1]?.querySelector<HTMLButtonElement>("button")?.click());
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(() => { ok(s.doc.undo().ok, "undo restores the second duplicate stance"); });
  const restoredSecond = rows()[1]?.querySelectorAll<HTMLInputElement>("input")[1];
  ok(restoredSecond !== undefined);
  await act(() => {
    restoredSecond.value = "x2-after-undo.anm";
    restoredSecond.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => { ok(s.doc.undo().ok, "undo restores the first duplicate stance ahead of the second"); });
  equal(rows()[2]?.querySelectorAll<HTMLInputElement>("input")[1]?.value, "x2-after-undo.anm", "the X2 draft remains with X2 after both history records are undone");
  handle.dispose();
  s.el.remove();
});

test("undoing an added stance retires its key before the next add", async () => {
  const s = await setup("character", "Chrs/undo-add-new-add.tem", exampleCharacter());
  const handle = await show(s);
  const rows = () => [...s.el.querySelectorAll<HTMLElement>(".tkr-sprite-custom")];
  await act(() => { ok(s.doc.apply({ type: "add-custom-stance", name: "Temporary", file: "" }).ok); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const temporary = rows().at(-1)?.querySelectorAll<HTMLInputElement>("input")[1];
  ok(temporary !== undefined);
  await act(() => {
    temporary.value = "must-not-leak.anm";
    temporary.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => { ok(s.doc.undo().ok, "undo removes the temporary stance"); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(() => { ok(s.doc.apply({ type: "add-custom-stance", name: "Replacement", file: "" }).ok); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  equal(rows().at(-1)?.querySelectorAll<HTMLInputElement>("input")[1]?.value, "", "a new stance receives a fresh key rather than reusing the undone stance draft");
  handle.dispose();
  s.el.remove();
});

test("delete undo redo undo preserves the surviving duplicate stance identity", async () => {
  const s = await setup("character", "Chrs/delete-undo-redo-undo.tem", exampleCharacter());
  const handle = await show(s);
  const rows = () => [...s.el.querySelectorAll<HTMLElement>(".tkr-sprite-custom")];
  await act(() => { ok(s.doc.apply({ type: "add-custom-stance", name: "X", file: "" }).ok); });
  await act(() => { ok(s.doc.apply({ type: "add-custom-stance", name: "X", file: "" }).ok); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const x2 = rows().at(-1)?.querySelectorAll<HTMLInputElement>("input")[1];
  ok(x2 !== undefined);
  await act(() => {
    x2.value = "x2-survives-cycle.anm";
    x2.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => rows()[1]?.querySelector<HTMLButtonElement>("button")?.click());
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(() => { ok(s.doc.undo().ok, "undo restores deleted X1"); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(() => { ok(s.doc.redo().ok, "redo deletes X1 again"); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(() => { ok(s.doc.undo().ok, "a second undo restores X1 with its original row key"); });
  equal(rows()[2]?.querySelectorAll<HTMLInputElement>("input")[1]?.value, "x2-survives-cycle.anm", "the surviving X2 draft stays on X2 after delete/undo/redo/undo");
  handle.dispose();
  s.el.remove();
});

test("separately acknowledged stance additions append keys in applied order", async () => {
  const s = await setup("character", "Chrs/pending-add-order.tem", exampleCharacter());
  const apply = s.doc.apply.bind(s.doc);
  let releaseFirst!: () => void;
  let startFirst!: () => void;
  let releaseSecond!: () => void;
  let startSecond!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
  const firstStarted = new Promise<void>((resolve) => { startFirst = resolve; });
  const secondStarted = new Promise<void>((resolve) => { startSecond = resolve; });
  let additions = 0;
  replaceApply(s.doc, async (command) => {
    if (command.type === "add-custom-stance") {
      if (additions++ === 0) {
        startFirst();
        await firstGate;
      } else {
        startSecond();
        await secondGate;
      }
    }
    return apply(command);
  });
  const handle = await show(s);
  const rows = () => [...s.el.querySelectorAll<HTMLElement>(".tkr-sprite-custom")];
  const form = s.el.querySelector<HTMLFormElement>("form");
  ok(form !== null);
  const nameInput = form.querySelector<HTMLInputElement>('input[name="stance-name"]');
  ok(nameInput !== null);
  const requestAdd = (name: string): void => {
    nameInput.value = name;
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  };
  await act(() => { requestAdd("First pending"); requestAdd("Second pending"); });
  await act(async () => { await Promise.all([firstStarted, secondStarted]); });
  releaseFirst();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const firstAnimation = rows().at(-1)?.querySelectorAll<HTMLInputElement>("input")[1];
  ok(firstAnimation !== undefined);
  await act(() => {
    firstAnimation.value = "first-pending.anm";
    firstAnimation.dispatchEvent(new Event("input", { bubbles: true }));
  });
  releaseSecond();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  equal(rows().at(-2)?.querySelectorAll<HTMLInputElement>("input")[1]?.value, "first-pending.anm", "the first acknowledgement keeps its draft in the first added row");
  equal(rows().at(-1)?.querySelectorAll<HTMLInputElement>("input")[1]?.value, "", "the second acknowledgement appends a separate fresh identity");
  handle.dispose();
  s.el.remove();
});

test("coalesced delete and add reconcile stance keys when the row count is unchanged", async () => {
  const s = await setup("character", "Chrs/coalesced-stance-edits.tem", exampleCharacter());
  const handle = await show(s);
  const rows = () => [...s.el.querySelectorAll<HTMLElement>(".tkr-sprite-custom")];
  await act(() => {
    ok(s.doc.apply({ type: "add-custom-stance", name: "X1", file: "" }).ok);
    ok(s.doc.apply({ type: "add-custom-stance", name: "X2", file: "" }).ok);
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const x1 = rows()[1]?.querySelectorAll<HTMLInputElement>("input")[1];
  const x2 = rows()[2]?.querySelectorAll<HTMLInputElement>("input")[1];
  ok(x1 !== undefined);
  ok(x2 !== undefined);
  await act(() => {
    x1.value = "x1-draft.anm";
    x1.dispatchEvent(new Event("input", { bubbles: true }));
    x2.value = "x2-draft.anm";
    x2.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => {
    ok(s.doc.apply({ type: "delete-custom-stance", index: 1 }).ok);
    ok(s.doc.apply({ type: "add-custom-stance", name: "Y", file: "" }).ok);
  });
  equal(s.doc.getSnapshot().customStances.length, 3, "delete and add leave the custom-stance row count unchanged");
  equal(rows()[1]?.querySelectorAll<HTMLInputElement>("input")[1]?.value, "x2-draft.anm", "the surviving X2 row keeps its draft after coalesced history changes");
  equal(rows()[2]?.querySelectorAll<HTMLInputElement>("input")[1]?.value, "", "new Y does not inherit the deleted X1 draft");
  handle.dispose();
  s.el.remove();
});

test("coalesced temporary stance add and delete preserve existing drafts", async () => {
  const s = await setup("character", "Chrs/coalesced-add-delete.tem", exampleCharacter());
  const handle = await show(s);
  const rows = () => [...s.el.querySelectorAll<HTMLElement>(".tkr-sprite-custom")];
  await act(() => { ok(s.doc.apply({ type: "add-custom-stance", name: "Survivor", file: "" }).ok); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const survivorAnimation = rows().at(-1)?.querySelectorAll<HTMLInputElement>("input")[1];
  ok(survivorAnimation !== undefined);
  await act(() => {
    survivorAnimation.value = "survivor-draft.anm";
    survivorAnimation.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const customCount = s.doc.getSnapshot().customStances.length;
  await act(() => {
    ok(s.doc.apply({ type: "add-custom-stance", name: "Temporary", file: "" }).ok);
    ok(s.doc.apply({ type: "delete-custom-stance", index: customCount }).ok);
  });
  equal(s.doc.getSnapshot().customStances.length, customCount, "coalesced add and delete leave the row count unchanged");
  equal(rows().at(-1)?.querySelectorAll<HTMLInputElement>("input")[1]?.value, "survivor-draft.anm", "the existing row retains its draft when a later added row is deleted in the same render");
  handle.dispose();
  s.el.remove();
});

test("Remove point rebases on the acknowledged coordinate edit", async () => {
  const s = await setup("character", "Chrs/queued-remove-point.tem", exampleCharacter());
  const original = s.doc.getSnapshot().vectorBases![1]!.points.map((point) => ({ ...point }));
  const apply = s.doc.apply.bind(s.doc);
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const firstStarted = new Promise<void>((resolve) => { started = resolve; });
  let delayFirst = true;
  replaceApply(s.doc, async (command) => {
    if (command.type === "set-sprite-bases" && delayFirst) {
      delayFirst = false;
      started();
      await gate;
    }
    return apply(command);
  });
  const handle = await show(s);
  await act(() => s.el.querySelector<HTMLButtonElement>('button[aria-pressed="false"]')?.click());
  const xLabel = [...s.el.querySelectorAll("label")].find((label) => label.textContent === "Point 1 X");
  if (xLabel === undefined) throw new Error("activation point X input is missing");
  const x = s.el.querySelector<HTMLInputElement>(`#${xLabel.htmlFor}`);
  if (x === null) throw new Error("activation point X input is missing");
  await act(() => { x.value = "-12"; x.dispatchEvent(new Event("change", { bubbles: true })); });
  await firstStarted;
  await act(() => {
    const remove = [...s.el.querySelectorAll("button")].find((button) => button.textContent === "Remove point 2");
    ok(remove !== undefined);
    remove.click();
  });
  release();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const points = s.doc.getSnapshot().vectorBases![1]!.points;
  deepEqual(points[0], { x: -12, y: original[0]!.y }, "removing a different point preserves the coordinate edit acknowledged before it");
  deepEqual(points.slice(1), original.slice(2), "the queued remove deletes point two from the acknowledged polygon");
  handle.dispose();
  s.el.remove();
});

test("deferred double removal waits for fresh point indices", async () => {
  const s = await setup("character", "Chrs/deferred-double-remove.tem", exampleCharacter());
  const bases = s.doc.getSnapshot().vectorBases!.map((base) => ({ points: base.points.map((point) => ({ ...point })) }));
  const points = [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }, { x: 4, y: 4 }, { x: 5, y: 5 }];
  bases[1] = { points };
  ok((await s.doc.apply({ type: "set-sprite-bases", bases })).ok);
  const apply = s.doc.apply.bind(s.doc);
  let releaseFirst!: () => void;
  let startFirst!: () => void;
  let releaseSecond!: () => void;
  let startSecond!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
  const firstStarted = new Promise<void>((resolve) => { startFirst = resolve; });
  const secondStarted = new Promise<void>((resolve) => { startSecond = resolve; });
  let applications = 0;
  replaceApply(s.doc, async (command) => {
    if (command.type === "set-sprite-bases" && applications === 0) {
      applications += 1;
      startFirst();
      await firstGate;
    } else if (command.type === "set-sprite-bases" && applications === 1) {
      applications += 1;
      startSecond();
      await secondGate;
    }
    return apply(command);
  });
  const handle = await show(s);
  await act(() => s.el.querySelector<HTMLButtonElement>('button[aria-pressed="false"]')?.click());
  const removePoint1 = [...s.el.querySelectorAll("button")].find((button) => button.textContent === "Remove point 1");
  ok(removePoint1 !== undefined);
  await act(() => removePoint1.click());
  await act(async () => { await firstStarted; await new Promise((resolve) => setTimeout(resolve, 0)); });
  const staleRemovePoint3 = [...s.el.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Remove point 3");
  ok(staleRemovePoint3 !== undefined);
  equal(staleRemovePoint3.disabled, true, "structural point removal is disabled until the preceding edit is acknowledged");
  await act(() => staleRemovePoint3.click());
  equal(applications, 1, "a second removal using stale row indices is not queued");

  releaseFirst();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const refreshedRemovePoint2 = [...s.el.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Remove point 2");
  ok(refreshedRemovePoint2 !== undefined);
  await act(() => refreshedRemovePoint2.click());
  await secondStarted;
  releaseSecond();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  deepEqual(s.doc.getSnapshot().vectorBases![1]!.points, [points[1], points[3], points[4]], "the two user removals target A then C despite the index shift");
  handle.dispose();
  s.el.remove();
});

test("blocked pointer release outside does not poison the next drag", async () => {
  const s = await setup("character", "Chrs/blocked-pointer.tem", exampleCharacter());
  const bases = s.doc.getSnapshot().vectorBases!.map((base) => ({ points: base.points.map((point) => ({ ...point })) }));
  bases[1] = { points: [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }, { x: 4, y: 4 }, { x: 5, y: 5 }] };
  ok((await s.doc.apply({ type: "set-sprite-bases", bases })).ok);
  const apply = s.doc.apply.bind(s.doc);
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const firstStarted = new Promise<void>((resolve) => { started = resolve; });
  replaceApply(s.doc, async (command) => {
    if (command.type === "set-sprite-bases") {
      started();
      await gate;
    }
    return apply(command);
  });
  const handle = await show(s);
  await act(() => s.el.querySelector<HTMLButtonElement>('button[aria-pressed="false"]')?.click());
  const removeFirst = [...s.el.querySelectorAll("button")].find((button) => button.textContent === "Remove point 1");
  ok(removeFirst !== undefined);
  await act(() => removeFirst.click());
  await act(async () => { await firstStarted; await new Promise((resolve) => setTimeout(resolve, 0)); });
  const svg = s.el.querySelector<SVGSVGElement>(".tkr-sprite-base-canvas");
  ok(svg !== null);
  Object.defineProperty(svg, "getScreenCTM", { value: () => ({ inverse: () => ({}) }) });
  Object.defineProperty(svg, "createSVGPoint", { value: () => ({
    x: 0,
    y: 0,
    matrixTransform() { return { x: this.x, y: this.y }; },
  }) });
  const pointer = (type: string, x = 0, y = 0): Event => {
    const event = new Event(type, { bubbles: true });
    Object.defineProperty(event, "pointerId", { value: 73 });
    Object.defineProperty(event, "clientX", { value: x });
    Object.defineProperty(event, "clientY", { value: y });
    return event;
  };
  const blockedVertex = svg.querySelector('[data-point-index="2"]');
  ok(blockedVertex !== null);
  await act(() => { blockedVertex.dispatchEvent(pointer("pointerdown")); });
  release();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(() => { document.body.dispatchEvent(pointer("pointerup")); });

  const nextDragVertex = svg.querySelector('[data-point-index="1"]');
  ok(nextDragVertex !== null);
  await act(() => { nextDragVertex.dispatchEvent(pointer("pointerdown", 2, 3)); });
  await act(() => {
    svg.dispatchEvent(pointer("pointermove", 12, 13));
    svg.dispatchEvent(pointer("pointerup", 12, 13));
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  deepEqual(s.doc.getSnapshot().vectorBases![1]!.points, [{ x: 2, y: 2 }, { x: 12, y: 13 }, { x: 4, y: 4 }, { x: 5, y: 5 }], "outside release clears the blocked pointer id so the next drag with the same id applies");
  handle.dispose();
  s.el.remove();
});

test("blocked pointer release inside suppresses the following click", async () => {
  const s = await setup("character", "Chrs/blocked-pointer-inside.tem", exampleCharacter());
  const bases = s.doc.getSnapshot().vectorBases!.map((base) => ({ points: base.points.map((point) => ({ ...point })) }));
  bases[1] = { points: [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }, { x: 4, y: 4 }, { x: 5, y: 5 }] };
  ok((await s.doc.apply({ type: "set-sprite-bases", bases })).ok);
  const apply = s.doc.apply.bind(s.doc);
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const firstStarted = new Promise<void>((resolve) => { started = resolve; });
  replaceApply(s.doc, async (command) => {
    if (command.type === "set-sprite-bases") {
      started();
      await gate;
    }
    return apply(command);
  });
  const handle = await show(s);
  await act(() => s.el.querySelector<HTMLButtonElement>('button[aria-pressed="false"]')?.click());
  const removeFirst = [...s.el.querySelectorAll("button")].find((button) => button.textContent === "Remove point 1");
  ok(removeFirst !== undefined);
  await act(() => removeFirst.click());
  await act(async () => { await firstStarted; await new Promise((resolve) => setTimeout(resolve, 0)); });
  const svg = s.el.querySelector<SVGSVGElement>(".tkr-sprite-base-canvas");
  ok(svg !== null);
  Object.defineProperty(svg, "getScreenCTM", { value: () => ({ inverse: () => ({}) }) });
  Object.defineProperty(svg, "createSVGPoint", { value: () => ({
    x: 0,
    y: 0,
    matrixTransform() { return { x: this.x, y: this.y }; },
  }) });
  const pointer = (type: string): Event => {
    const event = new Event(type, { bubbles: true });
    Object.defineProperty(event, "pointerId", { value: 91 });
    Object.defineProperty(event, "clientX", { value: 0 });
    Object.defineProperty(event, "clientY", { value: 0 });
    return event;
  };
  const blockedVertex = svg.querySelector('[data-point-index="2"]');
  ok(blockedVertex !== null);
  await act(() => { blockedVertex.dispatchEvent(pointer("pointerdown")); });
  release();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(() => {
    svg.dispatchEvent(pointer("pointerup"));
    svg.dispatchEvent(new Event("click", { bubbles: true }));
  });
  equal(s.doc.getSnapshot().vectorBases![1]!.points.length, 4, "the inside release followed by its click does not append a point");
  handle.dispose();
  s.el.remove();
});

test("blocked pointer cancellation clears the gesture before the next drag", async () => {
  const s = await setup("character", "Chrs/blocked-pointer-cancel.tem", exampleCharacter());
  const bases = s.doc.getSnapshot().vectorBases!.map((base) => ({ points: base.points.map((point) => ({ ...point })) }));
  bases[1] = { points: [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }, { x: 4, y: 4 }, { x: 5, y: 5 }] };
  ok((await s.doc.apply({ type: "set-sprite-bases", bases })).ok);
  const apply = s.doc.apply.bind(s.doc);
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const firstStarted = new Promise<void>((resolve) => { started = resolve; });
  replaceApply(s.doc, async (command) => {
    if (command.type === "set-sprite-bases") {
      started();
      await gate;
    }
    return apply(command);
  });
  const handle = await show(s);
  await act(() => s.el.querySelector<HTMLButtonElement>('button[aria-pressed="false"]')?.click());
  const removeFirst = [...s.el.querySelectorAll("button")].find((button) => button.textContent === "Remove point 1");
  ok(removeFirst !== undefined);
  await act(() => removeFirst.click());
  await act(async () => { await firstStarted; await new Promise((resolve) => setTimeout(resolve, 0)); });
  const svg = s.el.querySelector<SVGSVGElement>(".tkr-sprite-base-canvas");
  ok(svg !== null);
  Object.defineProperty(svg, "getScreenCTM", { value: () => ({ inverse: () => ({}) }) });
  Object.defineProperty(svg, "createSVGPoint", { value: () => ({
    x: 0,
    y: 0,
    matrixTransform() { return { x: this.x, y: this.y }; },
  }) });
  const pointer = (type: string, x = 0, y = 0): Event => {
    const event = new Event(type, { bubbles: true });
    Object.defineProperty(event, "pointerId", { value: 92 });
    Object.defineProperty(event, "clientX", { value: x });
    Object.defineProperty(event, "clientY", { value: y });
    return event;
  };
  const blockedVertex = svg.querySelector('[data-point-index="2"]');
  ok(blockedVertex !== null);
  await act(() => { blockedVertex.dispatchEvent(pointer("pointerdown")); });
  await act(() => { svg.dispatchEvent(pointer("pointercancel")); });
  release();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const nextVertex = svg.querySelector('[data-point-index="1"]');
  ok(nextVertex !== null);
  await act(() => { nextVertex.dispatchEvent(pointer("pointerdown", 2, 3)); });
  await act(() => {
    svg.dispatchEvent(pointer("pointermove", 12, 13));
    svg.dispatchEvent(pointer("pointerup", 12, 13));
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  deepEqual(s.doc.getSnapshot().vectorBases![1]!.points, [{ x: 2, y: 2 }, { x: 12, y: 13 }, { x: 4, y: 4 }, { x: 5, y: 5 }], "cancellation clears the blocked pointer id so the next drag can move a point");
  handle.dispose();
  s.el.remove();
});

test("coordinate input cannot retarget a shifted vertex during pending removal", async () => {
  const s = await setup("character", "Chrs/coordinate-during-remove.tem", exampleCharacter());
  const bases = s.doc.getSnapshot().vectorBases!.map((base) => ({ points: base.points.map((point) => ({ ...point })) }));
  const points = [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }, { x: 4, y: 4 }, { x: 5, y: 5 }];
  bases[1] = { points };
  ok((await s.doc.apply({ type: "set-sprite-bases", bases })).ok);
  const apply = s.doc.apply.bind(s.doc);
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const firstStarted = new Promise<void>((resolve) => { started = resolve; });
  let applications = 0;
  replaceApply(s.doc, async (command) => {
    if (command.type === "set-sprite-bases") {
      applications += 1;
      if (applications === 1) {
        started();
        await gate;
      }
    }
    return apply(command);
  });
  const handle = await show(s);
  await act(() => s.el.querySelector<HTMLButtonElement>('button[aria-pressed="false"]')?.click());
  const removeFirst = [...s.el.querySelectorAll("button")].find((button) => button.textContent === "Remove point 1");
  ok(removeFirst !== undefined);
  await act(() => removeFirst.click());
  await act(async () => { await firstStarted; await new Promise((resolve) => setTimeout(resolve, 0)); });
  const xLabel = [...s.el.querySelectorAll("label")].find((label) => label.textContent === "Point 3 X");
  ok(xLabel !== undefined);
  const staleCoordinate = s.el.querySelector<HTMLInputElement>(`#${xLabel.htmlFor}`);
  ok(staleCoordinate !== null);
  equal(staleCoordinate.disabled, true, "coordinate inputs are disabled while removal may change their row identity");
  await act(() => {
    staleCoordinate.value = "99";
    staleCoordinate.dispatchEvent(new Event("change", { bubbles: true }));
  });
  release();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  equal(applications, 1, "the disabled stale coordinate does not enqueue a second polygon command");
  deepEqual(s.doc.getSnapshot().vectorBases![1]!.points, points.slice(1), "the shifted D vertex retains its original coordinates");
  handle.dispose();
  s.el.remove();
});

test("base import shares the polygon queue and blocks save until queued edits finish", async () => {
  const path = "Chrs/import-queue.tem";
  const sourcePath = "Chrs/import-source.tem";
  const s = await setup("character", path, exampleCharacter());
  ok((await s.host.fs.writeProject("memory-project", sourcePath, exampleCharacter())).ok);
  const source = await openSpriteDocument("character", s.host.fs, createDocumentIdentity("memory-project", sourcePath));
  if (!source.ok) throw new Error("could not open the base import fixture");
  const importedBases = source.document.getSnapshot().vectorBases!.map((base, index) => ({
    points: base.points.map((point, pointIndex) => index === 1 && pointIndex === 0 ? { x: 12, y: 13 } : { ...point }),
  }));
  ok(source.document.apply({ type: "set-sprite-bases", bases: importedBases }).ok);
  ok((await s.host.fs.writeProject("memory-project", sourcePath, source.document.serialize())).ok);
  ok((await s.doc.apply({ type: "set-sprite-timing", speed: 1.25, idleTime: 0.25 })).ok);

  const order: string[] = [];
  const apply = s.doc.apply.bind(s.doc);
  let baseApplications = 0;
  replaceApply(s.doc, async (command) => {
    if (command.type === "set-sprite-bases") order.push(baseApplications++ === 0 ? "import" : "coordinate");
    return apply(command);
  });
  const save = s.doc.save.bind(s.doc);
  let finishSave!: () => void;
  const saved = new Promise<void>((resolve) => { finishSave = resolve; });
  s.doc.save = async () => {
    order.push("save");
    const result = await save();
    finishSave();
    return result;
  };

  let releaseRead!: () => void;
  let startRead!: () => void;
  const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
  const readStarted = new Promise<void>((resolve) => { startRead = resolve; });
  const readProject = s.host.fs.readProject.bind(s.host.fs);
  const delayedFs = s.host.fs as unknown as { readProject: typeof s.host.fs.readProject };
  delayedFs.readProject = async (projectId, assetPath) => {
    if (assetPath === sourcePath) {
      startRead();
      await readGate;
    }
    return readProject(projectId, assetPath);
  };

  const handle = await show(s);
  await input(s.el, 'input[placeholder="Chrs/hero.tem or Item/key.itm"]', sourcePath);
  await act(() => {
    const importButton = [...s.el.querySelectorAll("button")].find((button) => button.textContent === "Import both bases");
    ok(importButton !== undefined);
    importButton.click();
  });
  await readStarted;
  await act(() => s.el.querySelector<HTMLButtonElement>('button[aria-pressed="false"]')?.click());
  const xLabel = [...s.el.querySelectorAll("label")].find((label) => label.textContent === "Point 1 X");
  if (xLabel === undefined) throw new Error("activation point X input is missing");
  const x = s.el.querySelector<HTMLInputElement>(`#${xLabel.htmlFor}`);
  if (x === null) throw new Error("activation point X input is missing");
  await act(() => { x.value = "99"; x.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(() => {
    const saveButton = [...s.el.querySelectorAll("button")].find((button) => button.textContent === "Save sprite");
    ok(saveButton !== undefined);
    saveButton.click();
  });
  deepEqual(order, [], "the unresolved import fences geometry writes and save");
  releaseRead();
  await act(async () => { await saved; });
  deepEqual(order, ["import", "coordinate", "save"], "import, queued geometry edit, and save keep invocation order");
  const finalActivation = s.doc.getSnapshot().vectorBases![1]!.points;
  deepEqual(finalActivation[0], { x: 99, y: 13 }, "the queued coordinate applies to imported geometry instead of being overwritten by it");
  deepEqual(s.host.bytesOf(path), s.doc.serialize(), "save writes the result after all queued geometry operations");
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
