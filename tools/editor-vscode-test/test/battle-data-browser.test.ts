// Story 13.10 (T-57, T-58) in the browser workbench: a special move opens from its file, edits through its form, and its
// linked status effect opens in its own editor tab through the shared visit, is edited and saved there, and the way back
// shows the move's link read from that saved file. The real `host-web` workbench, workspace and views run over an
// in-memory folder; expected bytes are patched by hand at the offsets of the committed annotated listings
// (docs/spec/examples/listings/fireball.spc.txt, burn.ste.txt).
import { deepEqual, equal, ok } from "node:assert/strict";
import { BinaryReader, readMainFile, writeMainFile } from "@tk-reawakened/core";
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

async function open(options: NonNullable<Parameters<typeof createFolderProject>[2]> = {}) {
  const control: WriteControl = { refuse: false, refuseNames: undefined, hold: null, tick: 0 };
  const root = new MemoryDirectory("project", control);
  root.put("Main/example.gam", gam);
  root.put(SPC, fireball);
  root.put(STE, burn);
  const web = createFolderProject(root as unknown as FileSystemDirectoryHandle, { id: "web:battle-data", name: "Battle data" }, { userSettings: userStorage(), ...options });
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

test("a mounted fight background picks and auditions from the same game after a nested game appears", { timeout: 1000 }, async () => {
  const outer = "Game/Example";
  const inner = `${outer}/Inner`;
  const main = readMainFile(new BinaryReader(gam, "Main/example.gam"));
  ok(main.ok);
  const nested = writeMainFile({ ...main.value, projectPath: inner, gameTitle: "Inner" });
  ok(nested.ok);
  const wav = (sample: number): Uint8Array => {
    const bytes = new Uint8Array(46);
    const view = new DataView(bytes.buffer);
    bytes.set(new TextEncoder().encode("RIFF"), 0);
    bytes.set(new TextEncoder().encode("WAVEfmt "), 8);
    bytes.set(new TextEncoder().encode("data"), 36);
    for (const [offset, value] of [[4, 38], [16, 16], [24, 8_000], [28, 16_000], [40, 2]] as const) view.setUint32(offset, value, true);
    for (const [offset, value] of [[20, 1], [22, 1], [32, 2], [34, 16]] as const) view.setUint16(offset, value, true);
    view.setInt16(44, sample, true);
    return bytes;
  };
  const outerTrack = wav(2_000);
  const played: Uint8Array[] = [];
  const { root, web, element, bench } = await open({
    dialogs: {
      ask: async (question) => question.choices.find(({ id }) => id === "use")?.id ?? question.cancel,
      pickSavePath: async () => null,
    },
    createAudioOutput: () => ({ play: async (bytes) => { played.push(bytes); return { ok: true }; }, stop() {} }),
  });
  try {
    const path = `${inner}/Bkrounds/forest.bkg`;
    root.put(path, example("Bkrounds/forest.bkg"));
    root.put(`${outer}/Media/battle.wav`, outerTrack);
    root.put(`${outer}/Media/outer.wav`, wav(4_000));
    root.put(`${inner}/Media/battle.wav`, wav(6_000));
    root.put(`${inner}/Media/inner.wav`, wav(8_000));
    await bench.openPath(path);
    await until(() => editor(element)?.getAttribute("data-tkr-editor") === "Fight background", "the fight background is mounted with the outer game");
    root.put("Main/nested.gam", nested.value);

    await click(button(element, "Choose battle music"));
    const picker = element.querySelector('[role="dialog"][aria-modal="true"]');
    ok(picker !== null, "the music picker opened");
    await until(() => picker.querySelector('[role="option"]') !== null, `the picker loaded its music options: ${picker.textContent}`);
    const options = [...picker.querySelectorAll<HTMLElement>('[role="option"]')];
    deepEqual(options.map((option) => option.textContent), ["battle.wav", "outer.wav"], "the picker's files belong to the same game as the still-mounted form");
    await click(options[0]!);
    await click(button(element, "Use battle.wav…"));
    await until(() => field(element, "Battle music file").value === "battle.wav", "the music reference was applied");

    await click(button(element, "Play battle music"));
    await until(() => played.length > 0, "the audition reads the selected reference");
    deepEqual(played, [outerTrack], "audition uses the same recording the picker offered, not the new game's same-named file");

    // Reopening the existing document through Save As refreshes the declared owners but keeps its mounted view.
    // Focus another background first, so the Run menu must fall back to this tab's own audition target.
    const other = `${outer}/Bkrounds/other.bkg`;
    root.put(other, example("Bkrounds/forest.bkg"));
    await bench.openPath(other);
    await until(() => bench.tabs.getSnapshot().active === web.workspace.documents().find((doc) => doc.identity.path === other)?.identity.key, "the other background is active");
    field(element, "Battle music file").focus();
    const background = web.workspace.documents().find((doc) => doc.identity.path === path);
    ok(background !== undefined);
    equal(await bench.openDocument(background), null);
    await settle(act);
    await click(button(element, "Application menu"));
    const run = [...element.querySelectorAll<HTMLElement>('[role="menuitem"][aria-haspopup="true"]')].find((item) => item.firstElementChild?.textContent === "Run");
    ok(run !== undefined, "the Run menu is available");
    await click(run);
    const play = [...element.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.trim() === "Play battle music");
    ok(play !== undefined, "the Run menu offers music audition");
    await click(play);
    await until(() => played.length === 2, "the Run menu auditions the selected reference");
    deepEqual(played[1], outerTrack, "a layout refresh does not change the mounted tab's chosen recording in the Run menu");
  } finally { bench.dispose(); }
});

test("a special move can choose the status effect of a newly declared nested game", { timeout: 1000 }, async () => {
  const { root, web, element, bench } = await open({
    dialogs: {
      ask: async (question) => question.choices.find(({ id }) => id === "use")?.id ?? question.cancel,
      pickSavePath: async () => null,
    },
  });
  try {
    const inner = "Game/Example/Inner";
    const move = `${inner}/${SPC}`;
    const status = `${inner}/StatusE/inner.ste`;
    root.put(move, fireball);
    root.put(status, burn);
    root.put("Game/Example/StatusE/outer.ste", burn);
    await bench.openPath(move);
    await until(() => editor(element)?.getAttribute("data-tkr-editor") === "Special move", "the nested move is mounted");
    const main = readMainFile(new BinaryReader(gam, "Main/example.gam"));
    ok(main.ok);
    const nested = writeMainFile({ ...main.value, projectPath: inner, gameTitle: "Inner" });
    ok(nested.ok);
    root.put("Main/nested.gam", nested.value);

    await click(button(element, "Choose status effect"));
    const picker = element.querySelector('[role="dialog"][aria-modal="true"]');
    ok(picker !== null);
    await until(() => picker.querySelector('[role="option"]') !== null, "the status effect picker lists its options");
    const options = [...picker.querySelectorAll<HTMLElement>('[role="option"]')];
    deepEqual(options.map((option) => option.textContent), ["inner.ste"], "the picker refreshes the nested game's ownership");
    await click(options[0]!);
    await click(button(element, "Use inner.ste…"));
    await until(() => !button(element, "Open status effect").disabled, "the chosen nested status link resolves");
    await click(button(element, "Open status effect"));
    await until(() => web.workspace.documents().some((doc) => doc.identity.path === status), "Open reaches exactly the chosen nested status document");
  } finally { bench.dispose(); }
});
