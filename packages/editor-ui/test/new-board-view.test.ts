// The new-board questions of story 12.10 (T-20) under the same DOM shim as the other view tests: labelled fields, the
// pixel size beside the size, a problem beside its field, a failed creation that keeps what was typed, templates, and a
// cancel that creates nothing.
import { after, before, test } from "node:test";
import { deepEqual, equal, match, ok } from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { DEFAULT_NEW_BOARD, type NewBoardSettings } from "@tk-reawakened/editor-model";
import type { mountNewBoard as MountNewBoard } from "../src/index.ts";

let mountNewBoard: typeof MountNewBoard;
let act: (callback: () => void | Promise<void>) => Promise<void> | void;

before(async () => {
  // The DOM shim must exist before the view module loads, so the import cannot be static.
  GlobalRegistrator.register();
  ({ act } = await import("preact/test-utils"));
  ({ mountNewBoard } = await import("@tk-reawakened/editor-ui"));
});

after(() => GlobalRegistrator.unregister());

interface Deferred<T> { readonly promise: Promise<T>; readonly resolve: (value: T) => void }

/** A promise settled from outside, for an answer a test releases when it chooses. */
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

interface Rig {
  readonly el: HTMLElement;
  readonly created: NewBoardSettings[];
  cancelled: number;
  answer: { ok: true } | { ok: false; message: string };
  /** When set, `describeTemplate` and `onCreate` wait for these instead of answering at once. */
  hold: boolean;
  describing: Map<string, () => void>;
  holdCreate: Deferred<{ ok: true } | { ok: false; message: string }> | null;
}

const TEMPLATE: Partial<NewBoardSettings> = { coordSystem: "iso-rotated", pixelCoordinates: true, width: 7, height: 5, layers: 4, backgroundImage: "sky.png" };
const OTHER: Partial<NewBoardSettings> = { coordSystem: "2d", pixelCoordinates: false, width: 3, height: 3, layers: 1, backgroundImage: "" };

async function show(templates: readonly { path: string; name: string }[] = []): Promise<Rig> {
  const el = document.createElement("div");
  document.body.append(el);
  const rig: Rig = { el, created: [], cancelled: 0, answer: { ok: true }, hold: false, describing: new Map(), holdCreate: null };
  await act(() => {
    mountNewBoard(el, {
      initial: { ...DEFAULT_NEW_BOARD, coordSystem: "iso-stacked", width: 12, height: 9, layers: 3 },
      templates,
      describeTemplate: (path) => {
        const answer = path === "Boards/bad.brd" ? "Could not read the template Boards/bad.brd: gone" : TEMPLATE;
        if (!rig.hold) return Promise.resolve(answer);
        const held = deferred<Partial<NewBoardSettings> | string>();
        rig.describing.set(path, () => held.resolve(path === "Boards/other.brd" ? OTHER : answer));
        return held.promise;
      },
      onCreate: (settings) => {
        rig.created.push(settings);
        if (rig.holdCreate === null) return Promise.resolve(rig.answer);
        return rig.holdCreate.promise;
      },
      onCancel: () => { rig.cancelled += 1; },
    });
  });
  return rig;
}

const field = <T extends HTMLElement>(rig: Rig, label: string): T => {
  const labels = [...rig.el.querySelectorAll("label")].filter((candidate) => candidate.textContent === label);
  const target = labels[0]?.htmlFor === undefined ? null : rig.el.querySelector<T>(`#${CSS.escape(labels[0].htmlFor)}`);
  if (target === null) throw new Error(`no field labelled ${label}`);
  return target;
};
const type = async (input: HTMLInputElement, text: string): Promise<void> => {
  await act(() => { input.value = text; input.dispatchEvent(new Event("input", { bubbles: true })); });
};
const submit = (rig: Rig): Promise<void> | void => act(async () => {
  rig.el.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await Promise.resolve();
});
const alerts = (rig: Rig): string[] => [...rig.el.querySelectorAll('[role="alert"]')].map((node) => node.textContent ?? "");

test("every field has a visible label, starts with the remembered choices, and the pixel size is shown", async () => {
  const rig = await show();
  equal(field<HTMLSelectElement>(rig, "Layout").value, "iso-stacked");
  equal(field<HTMLInputElement>(rig, "Width in tiles").value, "12");
  equal(field<HTMLInputElement>(rig, "Height in tiles").value, "9");
  equal(field<HTMLInputElement>(rig, "Layers").value, "3");
  match(rig.el.querySelector(".tkr-new-board-summary")?.textContent ?? "", /736 × 128 pixels, 324 stored cells/);
  await act(() => { const select = field<HTMLSelectElement>(rig, "Layout"); select.value = "2d"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  match(rig.el.querySelector(".tkr-new-board-summary")?.textContent ?? "", /384 × 288 pixels/);
  deepEqual(alerts(rig), [], "no problem is shown before the first attempt");
});

test("a problem is said beside its field, and nothing is created until the questions are answered", async () => {
  const rig = await show();
  await submit(rig);
  match(alerts(rig).join(" "), /Give the board a name/);
  equal(rig.created.length, 0);
  await type(field(rig, "Name"), "village");
  await type(field(rig, "Width in tiles"), "0");
  await submit(rig);
  match(alerts(rig).join(" "), /width must be a whole number from 1 to 1000/i);
  equal(field<HTMLInputElement>(rig, "Width in tiles").getAttribute("aria-invalid"), "true");
  equal(rig.created.length, 0);
});

test("creating passes what was typed, and a refused creation says why and keeps the questions", async () => {
  const rig = await show();
  rig.answer = { ok: false, message: "Boards/village.brd already exists" };
  await type(field(rig, "Name"), "village");
  await type(field(rig, "Layers"), "5");
  await submit(rig);
  equal(rig.created.length, 1);
  deepEqual(rig.created[0], { ...DEFAULT_NEW_BOARD, name: "village", coordSystem: "iso-stacked", width: 12, height: 9, layers: 5 });
  match(alerts(rig).join(" "), /already exists/);
  equal(field<HTMLInputElement>(rig, "Name").value, "village", "what was typed is kept");
});

test("choosing a template fills the layout, size, layers and background, and an unreadable template says why", async () => {
  const rig = await show([{ path: "Boards/start.brd", name: "start.brd" }, { path: "Boards/bad.brd", name: "bad.brd" }]);
  const select = field<HTMLSelectElement>(rig, "Start from");
  await act(async () => { select.value = "Boards/start.brd"; select.dispatchEvent(new Event("change", { bubbles: true })); await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  equal(field<HTMLSelectElement>(rig, "Layout").value, "iso-rotated");
  equal(field<HTMLInputElement>(rig, "Width in tiles").value, "7");
  equal(field<HTMLInputElement>(rig, "Layers").value, "4");
  equal(field<HTMLInputElement>(rig, "Background image").value, "sky.png");
  ok(field<HTMLInputElement>(rig, "Use pixel coordinates").checked);
  await type(field(rig, "Name"), "second");
  await submit(rig);
  equal(rig.created[0]?.template, "Boards/start.brd");
  await act(async () => { select.value = "Boards/bad.brd"; select.dispatchEvent(new Event("change", { bubbles: true })); await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  match(alerts(rig).join(" "), /gone/);
});

test("Cancel and Escape create nothing", async () => {
  const rig = await show();
  await act(() => rig.el.querySelector<HTMLButtonElement>(".tkr-new-board-cancel")!.click());
  equal(rig.cancelled, 1);
  await act(() => { rig.el.querySelector("form")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
  equal(rig.cancelled, 2);
  equal(rig.created.length, 0);
});

test("a slow answer for an earlier template never replaces a later choice", async () => {
  const rig = await show([{ path: "Boards/start.brd", name: "start.brd" }, { path: "Boards/other.brd", name: "other.brd" }]);
  rig.hold = true;
  const select = field<HTMLSelectElement>(rig, "Start from");
  await act(() => { select.value = "Boards/start.brd"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(() => { select.value = "Boards/other.brd"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  // The later choice answers first, the earlier one last.
  await act(async () => { rig.describing.get("Boards/other.brd")!(); await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  equal(field<HTMLInputElement>(rig, "Width in tiles").value, "3");
  await act(async () => { rig.describing.get("Boards/start.brd")!(); await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  equal(field<HTMLInputElement>(rig, "Width in tiles").value, "3", "the earlier answer was ignored");
  equal(field<HTMLSelectElement>(rig, "Layout").value, "2d");
  // Choosing a blank board while an answer is on its way keeps it blank.
  await act(() => { select.value = "Boards/start.brd"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(() => { select.value = ""; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => { rig.describing.get("Boards/start.brd")!(); await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  equal(field<HTMLInputElement>(rig, "Width in tiles").value, "3", "a late template does not overwrite a blank board's fields");
  await type(field(rig, "Name"), "blank");
  await submit(rig);
  equal(rig.created[0]?.template, null, "and the board is made blank");
});

test("Cancel and Escape do nothing while the board is being made, so a board is never both cancelled and created", async () => {
  const rig = await show();
  rig.holdCreate = deferred();
  await type(field(rig, "Name"), "village");
  await submit(rig);
  equal(rig.created.length, 1, "creation is under way");
  equal(rig.el.querySelector<HTMLButtonElement>(".tkr-new-board-cancel")!.disabled, true);
  await act(() => rig.el.querySelector<HTMLButtonElement>(".tkr-new-board-cancel")!.click());
  await act(() => { rig.el.querySelector("form")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
  equal(rig.cancelled, 0, "nothing was cancelled");
  await act(async () => { rig.holdCreate!.resolve({ ok: false, message: "the folder is read-only" }); await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  match(alerts(rig).join(" "), /read-only/);
  equal(rig.el.querySelector<HTMLButtonElement>(".tkr-new-board-cancel")!.disabled, false, "Cancel works again once the creation has failed");
  await act(() => rig.el.querySelector<HTMLButtonElement>(".tkr-new-board-cancel")!.click());
  equal(rig.cancelled, 1);
});

test("a chosen template cannot be created from until its own layout, size and background have been read (#2546)", async () => {
  const rig = await show([{ path: "Boards/start.brd", name: "start.brd" }]);
  rig.hold = true;
  await type(field(rig, "Name"), "second");
  const select = field<HTMLSelectElement>(rig, "Start from");
  await act(() => { select.value = "Boards/start.brd"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  const create = rig.el.querySelector<HTMLButtonElement>(".tkr-new-board-create")!;
  equal(create.disabled, true, "Create waits for the template");
  match(rig.el.textContent ?? "", /Reading the template/);
  await submit(rig);
  equal(rig.created.length, 0, "submitting with Enter does not make a board with the old size, layout or background either");
  await act(async () => { rig.describing.get("Boards/start.brd")!(); await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  equal(create.disabled, false);
  await submit(rig);
  equal(rig.created.length, 1);
  deepEqual(
    [rig.created[0]?.template, rig.created[0]?.coordSystem, rig.created[0]?.width, rig.created[0]?.backgroundImage],
    ["Boards/start.brd", "iso-rotated", 7, "sky.png"],
    "the board is made with the template's own fields",
  );
});

test("a template that cannot be read does not leave Create waiting", async () => {
  const rig = await show([{ path: "Boards/bad.brd", name: "bad.brd" }]);
  rig.hold = true;
  const select = field<HTMLSelectElement>(rig, "Start from");
  await act(() => { select.value = "Boards/bad.brd"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  equal(rig.el.querySelector<HTMLButtonElement>(".tkr-new-board-create")!.disabled, true);
  await act(async () => { rig.describing.get("Boards/bad.brd")!(); await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  match(alerts(rig).join(" "), /gone/);
  equal(rig.el.querySelector<HTMLButtonElement>(".tkr-new-board-create")!.disabled, false);
});
