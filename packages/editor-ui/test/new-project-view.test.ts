// The new-project wizard of story 11.10 (T-04) under the same DOM shim as the other view tests: labelled fields, a main
// file that follows the name, nothing ticked at first, unavailable starter items shown with their reason and impossible
// to tick, a folder that must be chosen, a failed creation that keeps what was typed, and a cancel that creates nothing.
import { after, before, test } from "node:test";
import { deepEqual, equal, match, ok } from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { NewProjectSettings } from "@tk-reawakened/editor-model";
import type { mountNewProject as MountNewProject } from "../src/index.ts";

let mountNewProject: typeof MountNewProject;
let act: (callback: () => void | Promise<void>) => Promise<void> | void;

before(async () => {
  // The DOM shim must exist before the view module loads, so the import cannot be static.
  GlobalRegistrator.register();
  ({ act } = await import("preact/test-utils"));
  ({ mountNewProject } = await import("@tk-reawakened/editor-ui"));
});

after(() => GlobalRegistrator.unregister());

interface Rig {
  readonly el: HTMLElement;
  readonly created: NewProjectSettings[];
  readonly chosen: { count: number };
  cancelled: number;
  /** What the folder dialog answers; `null` is a cancelled dialog. */
  folder: string | null;
  answer: { ok: true } | { ok: false; message: string; details?: readonly string[] };
}

async function show(): Promise<Rig> {
  const el = document.createElement("div");
  document.body.replaceChildren(el);
  const rig: Rig = { el, created: [], chosen: { count: 0 }, cancelled: 0, folder: "empty-folder", answer: { ok: true } };
  await act(() => {
    mountNewProject(el, {
      chooseDestination: () => { rig.chosen.count += 1; return Promise.resolve(rig.folder); },
      onCreate: (settings) => { rig.created.push(settings); return Promise.resolve(rig.answer); },
      onCancel: () => { rig.cancelled += 1; },
    });
  });
  return rig;
}

const field = (rig: Rig, label: string): HTMLInputElement => {
  const target = [...rig.el.querySelectorAll("label")].find((candidate) => candidate.textContent === label);
  const found = target === undefined ? null : rig.el.querySelector<HTMLInputElement>(`#${CSS.escape(target.htmlFor)}`);
  if (found === null) throw new Error(`no field labelled ${label}`);
  return found;
};
const type = async (input: HTMLInputElement, text: string): Promise<void> => {
  await act(() => { input.value = text; input.dispatchEvent(new Event("input", { bubbles: true })); });
};
const click = (button: Element): Promise<void> | void => act(async () => {
  (button as HTMLButtonElement).click();
  await Promise.resolve();
});
const submit = (rig: Rig): Promise<void> | void => act(async () => {
  rig.el.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await Promise.resolve();
});
const alerts = (rig: Rig): string[] => [...rig.el.querySelectorAll('[role="alert"]')].map((node) => node.textContent ?? "");
const choose = async (rig: Rig): Promise<void> => {
  await click(rig.el.querySelector(".tkr-new-project-choose")!);
  await act(async () => { await Promise.resolve(); });
};

test("every field has a visible label, nothing is ticked, and no problem is shown before the first attempt", async () => {
  const rig = await show();
  equal(field(rig, "Game name").value, "");
  equal(field(rig, "Main file").value, "");
  for (const label of ["Start-up program", "Empty start board", "Empty first character", "Built-in menu and battle", "Default tiles", "System programs", "Music pack"]) {
    equal(field(rig, label).type, "checkbox", `${label} is a labelled checkbox`);
    equal(field(rig, label).checked, false, `${label} starts unticked: nothing is copied unless asked for`);
  }
  deepEqual(alerts(rig), []);
  match(rig.el.querySelector(".tkr-new-project-starters p")?.textContent ?? "", /Nothing is copied unless you tick it/);
});

test("the main file follows the name until it is typed in", async () => {
  const rig = await show();
  await type(field(rig, "Game name"), "My Quest");
  equal(field(rig, "Main file").value, "MyQuest.gam");
  await type(field(rig, "Main file"), "quest.gam");
  await type(field(rig, "Game name"), "My Quest 2");
  equal(field(rig, "Main file").value, "quest.gam", "a typed main file is not overwritten");
});

test("unavailable starter items say why and cannot be ticked; available ones say what they write and where they came from", async () => {
  const rig = await show();
  const tiles = field(rig, "Default tiles");
  ok(tiles.disabled);
  match(rig.el.querySelector(`#${CSS.escape(tiles.id)}-detail`)?.textContent ?? "", /Not available: No rights-cleared tile art/);
  const board = field(rig, "Empty start board");
  equal(board.disabled, false);
  const detail = rig.el.querySelector(`#${CSS.escape(board.id)}-detail`)?.textContent ?? "";
  match(detail, /Writes: Boards\/start\.brd/);
  match(detail, /Provenance: Generated by the editor's board writer/);
  equal(board.getAttribute("aria-describedby"), `${board.id}-detail`);
});

test("a problem is said beside its field and nothing is created until the questions are answered and a folder is chosen", async () => {
  const rig = await show();
  await submit(rig);
  match(alerts(rig).join(" "), /Give the game a name/);
  match(alerts(rig).join(" "), /Choose the folder to make the project in/);
  equal(rig.created.length, 0);
  await type(field(rig, "Game name"), "Quest");
  await type(field(rig, "Main file"), "a/b");
  await submit(rig);
  match(alerts(rig).join(" "), /folder separator/);
  equal(field(rig, "Main file").getAttribute("aria-invalid"), "true");
  equal(rig.created.length, 0);
  await type(field(rig, "Main file"), "Quest");
  await submit(rig);
  equal(rig.created.length, 0, "still no folder");
});

test("creating passes exactly what was asked for, in tick order, and cancelling the folder dialog chooses nothing", async () => {
  const rig = await show();
  await type(field(rig, "Game name"), "Quest");
  rig.folder = null;
  await choose(rig);
  match(rig.el.querySelector(".tkr-new-project-destination")?.textContent ?? "", /No folder chosen/);
  rig.folder = "my-games";
  await choose(rig);
  equal(rig.el.querySelector(".tkr-new-project-destination")?.textContent, "my-games");
  await act(() => { const box = field(rig, "Empty first character"); box.checked = true; box.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(() => { const box = field(rig, "Start-up program"); box.checked = true; box.dispatchEvent(new Event("change", { bubbles: true })); });
  await submit(rig);
  deepEqual(rig.created, [{ gameName: "Quest", mainFile: "Quest.gam", starters: ["start-character", "start-program"] }]);
});

test("a failed creation lists what it is about, keeps what was typed and lets the person try again", async () => {
  const rig = await show();
  rig.answer = { ok: false, message: "2 paths would be replaced. Nothing was written.", details: ["Main/Quest.gam", "Prg/start.prg"] };
  await type(field(rig, "Game name"), "Quest");
  await choose(rig);
  await submit(rig);
  equal(rig.created.length, 1);
  match(alerts(rig).join(" "), /Nothing was written/);
  deepEqual([...rig.el.querySelectorAll(".tkr-new-project-failure li")].map((item) => item.textContent), ["Main/Quest.gam", "Prg/start.prg"]);
  equal(field(rig, "Game name").value, "Quest");
  rig.answer = { ok: true };
  await submit(rig);
  equal(rig.created.length, 2);
  equal(rig.el.querySelector(".tkr-new-project-failure"), null, "a new attempt clears the old failure");
});

test("Cancel and Escape create nothing", async () => {
  const rig = await show();
  await type(field(rig, "Game name"), "Quest");
  await choose(rig);
  await click(rig.el.querySelector(".tkr-new-project-cancel")!);
  equal(rig.cancelled, 1);
  await act(() => { rig.el.querySelector("form")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
  equal(rig.cancelled, 2);
  equal(rig.created.length, 0);
});
