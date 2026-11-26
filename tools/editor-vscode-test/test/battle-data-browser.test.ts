// Story 13.10 (T-57, T-58) in the browser workbench: a special move opens from its file, edits through its form, and its
// linked status effect opens in its own editor tab through the shared visit, is edited and saved there, and the way back
// shows the move's link read from that saved file. The real `host-web` workbench, workspace and views run over an
// in-memory folder; expected bytes are patched by hand at the offsets of the committed annotated listings
// (docs/spec/examples/listings/fireball.spc.txt, burn.ste.txt).
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { MemoryDirectory, type WriteControl } from "../conformance/memory-directory.ts";
import { settle, type Act } from "../conformance/view.ts";
import type * as HostWebTesting from "@tk-reawakened/host-web/testing";

const gam = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/game/Main/example.gam", import.meta.url)));
const example = (path: string): Uint8Array => new Uint8Array(readFileSync(new URL(`../../../docs/spec/examples/game/Game/Example/${path}`, import.meta.url)));
const SPC = "SpcMove/fireball.spc";
const STE = "StatusE/burn.ste";
const fireball = example(SPC);
const burn = example(STE);
const FP = 0x1e;
const BATTLE = 0x37;
const HP_AMOUNT = 0x24;

const patched = (original: Uint8Array, edits: Readonly<Record<number, readonly number[]>>): Uint8Array => {
  const copy = original.slice();
  for (const [at, bytes] of Object.entries(edits)) copy.set(bytes, Number(at));
  return copy;
};

let act: Act;
let createFolderProject: typeof HostWebTesting.createFolderProject;
let createWorkbench: typeof HostWebTesting.createWorkbench;

before(async () => {
  GlobalRegistrator.register();
  const { act: preactAct } = await import("preact/test-utils");
  let queue: Promise<void> = Promise.resolve();
  act = (callback) => {
    const run = queue.then(() => preactAct(callback));
    queue = run.catch(() => undefined);
    return run;
  };
  ({ createFolderProject, createWorkbench } = await import("@tk-reawakened/host-web/testing"));
});

after(() => GlobalRegistrator.unregister());

function userStorage(): { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void } {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

async function open() {
  const control: WriteControl = { refuse: false, refuseNames: undefined, hold: null, tick: 0 };
  const root = new MemoryDirectory("project", control);
  root.put("Main/example.gam", gam);
  root.put(SPC, fireball);
  root.put(STE, burn);
  const web = createFolderProject(root as unknown as FileSystemDirectoryHandle, { id: "web:battle-data", name: "Battle data" }, { userSettings: userStorage() });
  document.body.replaceChildren();
  const element = document.createElement("div");
  document.body.append(element);
  let bench!: ReturnType<typeof createWorkbench>;
  await act(() => { bench = createWorkbench(web, element); });
  await settle(act);
  return { root, web, element, bench };
}

async function until(condition: () => boolean, message: string): Promise<void> {
  for (let round = 0; round < 300 && !condition(); round += 1) await settle(act, 1);
  ok(condition(), message);
}
/** The editor of the tab in front: the workbench keeps every open tab's pane and hides the others. */
const editor = (element: HTMLElement): HTMLElement | null => element.querySelector<HTMLElement>(".tkr-editor-pane:not([hidden]) [data-tkr-editor]");
const field = (element: HTMLElement, label: string): HTMLInputElement => {
  const found = element.querySelector<HTMLInputElement>(`.tkr-editor-pane:not([hidden]) input[aria-label="${label}"]`);
  if (found === null) throw new Error(`no field ${label}: ${editor(element)?.textContent}`);
  return found;
};
const button = (element: HTMLElement, label: string): HTMLButtonElement => {
  const scope = element.querySelector<HTMLElement>(".tkr-editor-pane:not([hidden])") ?? element;
  const found = [...scope.querySelectorAll<HTMLButtonElement>("button"), ...element.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.getAttribute("aria-label") === label || node.textContent?.trim() === label);
  if (found === undefined) throw new Error(`no button ${label}`);
  return found;
};
async function type(input: HTMLInputElement, value: string): Promise<void> {
  await act(() => { input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(() => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  await settle(act);
}
const click = async (target: HTMLElement): Promise<void> => {
  await act(() => { target.click(); });
  await settle(act);
};

test("a special move edits and saves through the workbench, and reopens with its signed damage and inverted flag", async () => {
  const { root, web, element, bench } = await open();
  try {
    await bench.openPath(SPC);
    await until(() => editor(element)?.getAttribute("data-tkr-editor") === "Special move", "the special move editor is in the editor slot");
    equal(field(element, "Usable in battle").checked, false, "the stored battle byte 1 shows as not usable");
    await type(field(element, "Damage (FP)"), "-30");
    await act(() => { const box = field(element, "Usable in battle"); box.checked = true; box.dispatchEvent(new Event("change", { bubbles: true })); });
    await settle(act);
    const expected = patched(fireball, { [FP]: [0xe2, 0xff, 0xff, 0xff], [BATTLE]: [0] });
    deepEqual(web.workspace.documents()[0]!.serialize(), expected);
    deepEqual(root.read(SPC), fireball, "nothing is written until Save");
    const saved = await web.workspace.saveAll();
    ok(saved.every((entry) => entry.result.ok));
    deepEqual(root.read(SPC), expected);

    bench.dispose();
    const second = await open();
    second.root.put(SPC, expected);
    await second.bench.openPath(SPC);
    await until(() => editor(second.element)?.getAttribute("data-tkr-editor") === "Special move", "the saved move reopens");
    equal(field(second.element, "Damage (FP)").value, "-30");
    equal(field(second.element, "Usable in battle").checked, true);
    second.bench.dispose();
  } finally { bench.dispose(); }
});

test("the linked status effect opens in its own editor, saves there, and the way back reads the move's link from the saved file", async () => {
  const { root, web, element, bench } = await open();
  try {
    await bench.openPath(SPC);
    await until(() => editor(element)?.getAttribute("data-tkr-editor") === "Special move", "the special move editor is in the editor slot");
    await until(() => element.textContent?.includes("Burn: 3 rounds; removes 2 HP each round.") === true, "the link shows the saved status effect");
    await click(button(element, "Open status effect"));
    await until(() => editor(element)?.getAttribute("data-tkr-editor") === "Status effect", "the status effect opens in its own editor");
    equal(web.workspace.documents().length, 2, "the linked file is its own document with its own history");
    await type(field(element, "HP per round"), "-5");
    await click(button(element, "Save"));
    const expected = patched(burn, { [HP_AMOUNT]: [0xfb, 0xff] });
    deepEqual(root.read(STE), expected);
    deepEqual(root.read(SPC), fireball, "the move's own file was not touched by editing its link");
    await click(button(element, "Return to board"));
    await until(() => editor(element)?.getAttribute("data-tkr-editor") === "Special move", "the way back shows the move");
    await until(() => element.textContent?.includes("Burn: 3 rounds; restores 5 HP each round.") === true, "the move's link now describes the saved change");
  } finally { bench.dispose(); }
});

test("Open hands over the exact openable program file path checked from Media, not a rewritten Prg path (#3589)", async () => {
  const { root, web, element, bench } = await open();
  const BKG = "Game/Example/Bkrounds/forest.bkg";
  const PROGRAM = "Game/Example/Media/tone.prg";
  try {
    root.put(BKG, example("Bkrounds/forest.bkg"));
    root.put(PROGRAM, new TextEncoder().encode('message("hello")\n'));
    await bench.openPath(BKG);
    await until(() => editor(element)?.getAttribute("data-tkr-editor") === "Fight background", "the fight background editor is in the slot");
    await type(field(element, "Battle music file"), "tone.prg");
    await until(() => !button(element, "Open battle music").disabled, "the checked file enables Open");
    await click(button(element, "Open battle music"));
    await until(() => web.workspace.documents().length === 2, "the checked file opened as its own document");
    deepEqual(web.workspace.documents().map((document) => document.identity.path).sort(), [BKG, PROGRAM], "the exact checked path opened");
    deepEqual(root.read(PROGRAM), new TextEncoder().encode('message("hello")\n'), "the program bytes were not rewritten");
    equal(element.textContent?.includes("Game/Prg/"), false, "no reserved-folder rewrite was tried");
  } finally { bench.dispose(); }
});
