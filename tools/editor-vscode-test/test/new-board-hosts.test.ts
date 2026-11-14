// Story 12.10, T-20 "new board" in both hosts: the browser workbench shows the questions as a dialog and VS Code asks them
// one at a time. Both make the board through the model, never over an existing file, remember the last choices, can skip
// the questions by preference, and open the new board. The bridge also refuses a forged picture request.
import { deepEqual, equal, match, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { BinaryReader, readBoard } from "@tk-reawakened/core";
import { asksBeforeCreating, createPreferences, newBoardSettingsFrom } from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import type { DialogQuestion, DialogService } from "@tk-reawakened/platform-services";
import { MemoryDirectory, type WriteControl } from "../conformance/memory-directory.ts";
import { settle, type Act } from "../conformance/view.ts";

const gam = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/game/Main/example.gam", import.meta.url)));

let act: Act;
let createFolderProject: typeof import("@tk-reawakened/host-web/testing").createFolderProject;
let createWorkbench: typeof import("@tk-reawakened/host-web/testing").createWorkbench;
let runNewBoard: typeof import("@tk-reawakened/host-vscode/testing").runNewBoard;
let isEditorHostRequest: typeof import("@tk-reawakened/host-vscode/testing").isEditorHostRequest;
let RemoteDocument: typeof import("@tk-reawakened/host-vscode/testing").RemoteDocument;

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
  ({ runNewBoard, isEditorHostRequest, RemoteDocument } = await import("@tk-reawakened/host-vscode/testing"));
});

after(() => GlobalRegistrator.unregister());

class Dialogs implements DialogService {
  readonly asked: string[] = [];
  async ask<Id extends string>(question: DialogQuestion<Id>): Promise<Id> {
    this.asked.push(question.message);
    return question.cancel;
  }
  async pickSavePath(): Promise<string | null> { return null; }
}

function userStorage() {
  const items = new Map<string, string>();
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value), removeItem: (key: string) => void items.delete(key) };
}

function project() {
  const control: WriteControl = { refuse: false, hold: null, tick: 0 };
  const root = new MemoryDirectory("project", control);
  root.put("Main/example.gam", gam);
  const dialogs = new Dialogs();
  const web = createFolderProject(root as unknown as FileSystemDirectoryHandle, { id: "web:new-board", name: "New board" }, { dialogs, userSettings: userStorage() });
  document.body.replaceChildren();
  const element = document.createElement("div");
  document.body.append(element);
  return { root, dialogs, web, element };
}

const field = (element: HTMLElement, label: string): HTMLInputElement | HTMLSelectElement => {
  const target = [...element.querySelectorAll("label")].find((candidate) => candidate.textContent === label);
  const found = target === undefined ? null : element.querySelector<HTMLInputElement | HTMLSelectElement>(`#${CSS.escape(target.htmlFor)}`);
  if (found === null) throw new Error(`no field ${label}`);
  return found;
};
const type = async (target: HTMLInputElement | HTMLSelectElement, value: string, event = "input"): Promise<void> => {
  await act(() => { target.value = value; target.dispatchEvent(new Event(event, { bubbles: true })); });
};

test("the browser workbench asks the questions, makes the board, opens it and remembers the choices", async () => {
  const { web, element, root } = project();
  let bench!: ReturnType<typeof createWorkbench>;
  await act(() => { bench = createWorkbench(web, element); });
  await settle(act);
  const made = bench.newBoard();
  await settle(act);
  const dialog = element.querySelector('[role="dialog"][aria-label="New board"]');
  ok(dialog !== null, "the questions are shown");
  await type(field(element, "Name"), "meadow");
  await type(field(element, "Layout"), "iso-rotated", "change");
  await type(field(element, "Width in tiles"), "9");
  await type(field(element, "Height in tiles"), "7");
  await type(field(element, "Layers"), "3");
  await act(() => { element.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await settle(act);
  equal(await made, "Boards/meadow.brd");
  equal(element.querySelector('[role="dialog"]'), null, "the questions close");
  const bytes = root.read("Boards/meadow.brd");
  ok(bytes !== null);
  const read = readBoard(new BinaryReader(bytes));
  ok(read.ok);
  deepEqual([read.value.sizeX, read.value.sizeY, read.value.sizeL, read.value.coordType], [9, 7, 3, 2]);
  deepEqual(bench.tabs.getSnapshot().tabs.map((tab) => tab.path), ["Boards/meadow.brd"], "the new board is open in a tab");
  equal(element.querySelector(".tkr-editor-slot h2")?.textContent, "Board");

  // The next questions start from what was chosen.
  const again = bench.newBoard();
  await settle(act);
  equal(field(element, "Layout").value, "iso-rotated");
  equal(field(element, "Width in tiles").value, "9");
  await type(field(element, "Name"), "MEADOW");
  await act(() => { element.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await settle(act);
  match(element.querySelector('[role="alert"]')?.textContent ?? "", /already exists/);
  equal(element.querySelector('[role="dialog"]') !== null, true, "a refused creation keeps the questions open");
  deepEqual(root.read("Boards/meadow.brd"), bytes, "the existing board is untouched");
  await act(() => { element.querySelector<HTMLButtonElement>(".tkr-new-board-cancel")!.click(); });
  equal(await again, null, "cancelling makes nothing");
  bench.dispose();
});

test("with the dialog switched off the next board is made from the remembered choices, with a free name", async () => {
  const { web, element, root } = project();
  let bench!: ReturnType<typeof createWorkbench>;
  await act(() => { bench = createWorkbench(web, element); });
  await settle(act);
  const preferences = createPreferences({ settings: web.services.settings, projectLayer: false });
  await preferences.refresh();
  ok((await preferences.set("board.showNewBoardDialog", "user", false)).ok);
  ok((await preferences.set("board.new.coordSystem", "user", "iso-stacked")).ok);
  ok((await preferences.set("board.new.width", "user", 5)).ok);
  equal(asksBeforeCreating(preferences.getSnapshot()), false);
  deepEqual(newBoardSettingsFrom(preferences.getSnapshot()).coordSystem, "iso-stacked");
  equal(await bench.newBoard(), "Boards/untitled.brd");
  equal(element.querySelector('[role="dialog"]'), null, "no questions were asked");
  equal(await bench.newBoard(), "Boards/untitled 2.brd");
  const read = readBoard(new BinaryReader(root.read("Boards/untitled.brd")!));
  ok(read.ok);
  deepEqual([read.value.sizeX, read.value.coordType], [5, 1]);
  bench.dispose();
});

/** Answers in order; a `null` answer dismisses the question. */
function scripted(answers: readonly (string | null)[]) {
  const asked: string[] = [];
  const queue = [...answers];
  const next = (title: string): string | undefined => {
    asked.push(title);
    const answer = queue.shift();
    return answer === null || answer === undefined ? undefined : answer;
  };
  return {
    asked,
    ui: {
      input: async (question: { title: string; prompt: string; value: string; validate: (value: string) => string | null }) => {
        const answer = next(question.prompt);
        if (answer !== undefined) ok(question.validate(answer) === null || answer === "", `"${answer}" for ${question.prompt}: ${question.validate(answer)}`);
        return answer;
      },
      pick: async (question: { title: string }) => next(question.title),
    },
    remaining: () => queue.length,
  };
}

test("VS Code asks the questions one at a time and makes the same board; a dismissed question makes nothing", async () => {
  const host = createMemoryPlatformServices({});
  const layout = { projectFolder: "" };
  const dismissed = scripted(["cave", "iso-stacked", null]);
  const outcome = await runNewBoard({ fs: host.fs, layout, settings: host.settings, ui: dismissed.ui });
  equal(outcome.ok, false);
  equal(outcome.ok === false && outcome.reason, "cancelled");
  equal((await host.fs.list("Boards")).ok, false, "nothing was written");

  const answers = scripted(["cave", "iso-stacked", "pixels", "12", "10", "4", "sky.png"]);
  const made = await runNewBoard({ fs: host.fs, layout, settings: host.settings, ui: answers.ui });
  deepEqual(made, { ok: true, path: "Boards/cave.brd", warning: null });
  equal(answers.remaining(), 0);
  const bytes = await host.fs.read("Boards/cave.brd");
  ok(bytes.ok);
  const read = readBoard(new BinaryReader(bytes.value));
  ok(read.ok);
  deepEqual([read.value.sizeX, read.value.sizeY, read.value.sizeL, read.value.coordType, read.value.properties.backgroundImage], [12, 10, 4, 5, "sky.png"]);

  // The choices are remembered, a board of that name is not replaced, and a template offers its own layout.
  const next = scripted(["cave", "", "2d", "tiles", "3", "3", "1", ""]);
  const refused = await runNewBoard({ fs: host.fs, layout, settings: host.settings, ui: next.ui });
  equal(refused.ok, false);
  match(refused.ok ? "" : refused.message, /already exists/);
  const intact = await host.fs.read("Boards/cave.brd");
  ok(intact.ok);
  deepEqual(intact.value, bytes.value);
  const templated = scripted(["glade", "Boards/cave.brd", "iso-rotated", "tiles", "6", "6", "2", "sky.png"]);
  const second = await runNewBoard({ fs: host.fs, layout, settings: host.settings, ui: templated.ui });
  ok(second.ok, second.ok ? "" : second.message);
  const copy = await host.fs.read("Boards/glade.brd");
  ok(copy.ok);
  const copied = readBoard(new BinaryReader(copy.value));
  ok(copied.ok);
  equal(copied.value.properties.backgroundImage, "sky.png", "the template's background, which the question offered, is kept");
  const cleared = scripted(["clearing", "Boards/cave.brd", "iso-rotated", "tiles", "6", "6", "2", ""]);
  ok((await runNewBoard({ fs: host.fs, layout, settings: host.settings, ui: cleared.ui })).ok);
  const emptied = await host.fs.read("Boards/clearing.brd");
  ok(emptied.ok);
  const reread = readBoard(new BinaryReader(emptied.value));
  ok(reread.ok);
  equal(reread.value.properties.backgroundImage, "", "an author who clears the offered background gets none");
});

test("the bridge refuses a picture request that is not layer numbers and a background flag", () => {
  ok(isEditorHostRequest({ type: "preview", requestId: "a" }));
  ok(isEditorHostRequest({ type: "preview", requestId: "a", request: { visibleLayers: [0, 2], showBackground: false } }));
  ok(!isEditorHostRequest({ type: "preview", requestId: "a", request: { visibleLayers: [-1] } }));
  ok(!isEditorHostRequest({ type: "preview", requestId: "a", request: { visibleLayers: "all" } }));
  ok(!isEditorHostRequest({ type: "preview", requestId: "a", request: { showBackground: "no" } }));
  ok(!isEditorHostRequest({ type: "preview", requestId: "a", request: null }));
});

test("a board preference the extension host sends reaches the webview's document at once and is read when the next gesture happens", () => {
  const host = createMemoryPlatformServices({});
  const snapshot = { identity: { key: "k", projectId: "p", path: "Boards/a.brd" } } as never;
  const remote = new RemoteDocument("board", snapshot, { selection: null, path: null, scrollTop: 0 }, { postMessage: () => undefined, getState: () => undefined, setState: () => undefined }, { revertToDrawAfterFlood: true, recursiveFlood: false });
  deepEqual(remote.boardPreferences.get(), { revertToDrawAfterFlood: true, recursiveFlood: false });
  let heard = 0;
  const stop = remote.boardPreferences.subscribe(() => { heard += 1; });
  remote.receive({ type: "board-preferences", preferences: { revertToDrawAfterFlood: false, recursiveFlood: true } });
  deepEqual(remote.boardPreferences.get(), { revertToDrawAfterFlood: false, recursiveFlood: true });
  equal(heard, 1);
  stop();
  remote.receive({ type: "board-preferences", preferences: { revertToDrawAfterFlood: true, recursiveFlood: true } });
  equal(heard, 1, "a stopped listener hears nothing");
  ok(host !== undefined);
});
