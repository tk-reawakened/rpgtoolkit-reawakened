// Story 11.4 in the browser host: one project navigated from Game and Files into one document, a linked visit with its
// return, and an outside asset copied into its reserved folder. The real `host-web` workbench, workspace and views run
// over an in-memory folder in place of File System Access; only the browser's own picker and dialogs are scripted.
import { deepEqual, equal, match, notEqual, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { DialogQuestion, DialogService, OutsideFile } from "@tk-reawakened/platform-services";
import { MemoryDirectory, type WriteControl } from "../conformance/memory-directory.ts";
import { settle, type Act } from "../conformance/view.ts";

const gam = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/game/Main/example.gam", import.meta.url)));
const board = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/board/board_minor4.brd", import.meta.url)));

/** The browser's own dialogs, answered here as the user would: a queue of answers, and a queue of outside files. */
class ScriptedDialogs implements DialogService {
  readonly answers: string[] = [];
  readonly files: (OutsideFile | null)[] = [];
  readonly asked: string[] = [];
  async ask<Id extends string>(question: DialogQuestion<Id>): Promise<Id> {
    this.asked.push(question.message);
    const answer = this.answers.shift();
    return question.choices.find((choice) => choice.id === answer)?.id ?? question.cancel;
  }
  async pickSavePath(): Promise<string | null> { return null; }
  async pickFile(): Promise<OutsideFile | null> { return this.files.shift() ?? null; }
}

let act: Act;
let createFolderProject: typeof import("@tk-reawakened/host-web/testing").createFolderProject;
let createWorkbench: typeof import("@tk-reawakened/host-web/testing").createWorkbench;

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

function project() {
  const control: WriteControl = { refuse: false, hold: null, tick: 0 };
  const root = new MemoryDirectory("project", control);
  root.put("Main/example.gam", gam);
  root.put("Boards/village.brd", board);
  root.put("Boards/caves/mine.brd", board);
  root.put("Misc/readme.txt", new Uint8Array([2]));
  const dialogs = new ScriptedDialogs();
  const web = createFolderProject(root as unknown as FileSystemDirectoryHandle, { id: "web:navigation", name: "Navigation" }, { dialogs });
  document.body.replaceChildren();
  const element = document.createElement("div");
  document.body.append(element);
  return { root, dialogs, web, element };
}

const key = async (target: Element | null, name: string, init: KeyboardEventInit = {}): Promise<void> => {
  if (target === null) throw new Error("no element to press a key on");
  await act(() => { target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init })); });
  await settle(act);
};
const click = async (target: Element | null): Promise<void> => {
  if (target === null) throw new Error("no element to click");
  await act(() => { (target as HTMLElement).click(); });
  await settle(act);
};
const row = (element: HTMLElement, name: string): HTMLElement => {
  const found = [...element.querySelectorAll<HTMLElement>('[role="treeitem"]')].find((node) => node.textContent?.replace(/^[▸▾] /, "").trim() === name);
  if (found === undefined) throw new Error(`no row ${name}`);
  return found;
};
const button = (element: HTMLElement, label: string): HTMLButtonElement => {
  const found = [...element.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === label || node.getAttribute("aria-label") === label);
  if (found === undefined) throw new Error(`no button ${label}`);
  return found;
};

test("one project is navigated from Files and from Game into one board document, in one tab and one editor", async () => {
  const { web, element } = project();
  const bench = createWorkbench(web, element);
  await settle(act);
  await key(row(element, "Boards"), "ArrowRight");
  await key(row(element, "Boards"), "ArrowDown");
  await key(row(element, "caves"), "ArrowDown");
  await key(row(element, "village.brd"), "Enter");
  equal(web.workspace.documents().length, 1);
  deepEqual(bench.tabs.getSnapshot().tabs.map((tab) => tab.path), ["Boards/village.brd"]);
  equal(element.querySelector(".tkr-editor-slot h2")?.textContent, "Board", "the board editor is in the editor slot");

  await click(button(element, "Game"));
  const game = element.querySelector('[role="group"][aria-label="Boards"]');
  ok(game !== null);
  await click(button(element, "Boards/village.brd"));
  equal(web.workspace.documents().length, 1, "Game and Files reach one model");
  equal(bench.tabs.getSnapshot().tabs.length, 1, "in one tab");
  equal(element.querySelectorAll(".tkr-editor-slot .tkr-board").length, 1, "and one mounted editor");
  bench.dispose();
});

test("a board's tab shows an unsaved edit, and closing it asks; a refused close keeps the editor and its edit", async () => {
  const { web, element, dialogs } = project();
  const bench = createWorkbench(web, element);
  await settle(act);
  await bench.openPath("Boards/village.brd");
  await settle(act);
  const doc = web.workspace.documents()[0]!;
  ok(doc.apply({ type: "set-tile", layer: 0, x: 0, y: 0, tile: "village.tst2" }).ok);
  await settle(act);
  match(element.querySelector('[role="tab"]')?.getAttribute("aria-label") ?? "", /unsaved changes$/);
  await key(element.querySelector('[role="tab"]'), "Delete");
  equal(bench.tabs.getSnapshot().tabs.length, 1, "no answer is given, so the question is dismissed and the tab stays");
  match(dialogs.asked.at(-1) ?? "", /Save the changes to Boards\/village\.brd/);
  match(element.querySelector(".tkr-tabs-notice")?.textContent ?? "", /was not closed/);
  equal(element.querySelectorAll(".tkr-editor-slot .tkr-board").length, 1);
  bench.dispose();
});

test("a linked visit opens the target in a tab and returns to its origin, reopening it from the file if it was closed", async () => {
  const { web, element, dialogs } = project();
  const bench = createWorkbench(web, element);
  await settle(act);
  await bench.openPath("Boards/village.brd");
  const origin = web.workspace.documents()[0]!;
  const visited = await bench.visit(origin, "Boards/caves/mine.brd");
  ok(visited.ok);
  await settle(act);
  deepEqual(bench.tabs.getSnapshot().tabs.map((tab) => tab.path), ["Boards/village.brd", "Boards/caves/mine.brd"]);
  equal(bench.tabs.getSnapshot().active, visited.document.identity.key);
  equal(element.querySelectorAll(".tkr-editor-slot .tkr-board").length, 1, "only the active editor is mounted");

  const back = await bench.returnFromVisit();
  ok(back.ok && !back.reopened);
  await settle(act);
  equal(bench.tabs.getSnapshot().active, origin.identity.key);

  await bench.visit(origin, "Boards/caves/mine.brd");
  dialogs.answers.push("discard");
  await bench.tabs.close(origin.identity.key);
  await settle(act);
  equal(web.workspace.documents().length, 1, "the origin was closed during the visit");
  const reopened = await bench.returnFromVisit();
  ok(reopened.ok && reopened.reopened);
  match(reopened.message ?? "", /opened again from its file/);
  await settle(act);
  equal(bench.tabs.getSnapshot().active, reopened.document.identity.key);
  bench.dispose();
});

test("an outside asset is copied into its reserved folder only after the user agrees, and a refusal changes nothing", async () => {
  const { web, element, dialogs, root } = project();
  const bench = createWorkbench(web, element);
  await settle(act);
  ok(web.services.capabilities.has("pickFile"), "this host declares that it can choose a file from outside");

  const cancelled = bench.pickAsset({ kind: "bitmaps", extensions: [".png"], field: "the hero's picture" });
  await settle(act);
  equal(element.querySelector('[role="dialog"]')?.getAttribute("aria-label"), "Choose the hero's picture");
  dialogs.files.push({ name: "hero.png", bytes: new Uint8Array([7, 7]) });
  dialogs.answers.push("cancel");
  await click(button(element, "Choose a file from outside the project…"));
  equal(root.read("Bitmap/hero.png"), null, "cancelling the copy writes nothing");
  await click(button(element, "Cancel"));
  deepEqual(await cancelled, { chosen: false }, "the field keeps what it had");
  equal(element.querySelector('[role="dialog"]'), null);

  const chosen = bench.pickAsset({ kind: "bitmaps", extensions: [".png"], field: "the hero's picture" });
  await settle(act);
  dialogs.files.push({ name: "hero.png", bytes: new Uint8Array([7, 7]) });
  dialogs.answers.push("copy");
  await click(button(element, "Choose a file from outside the project…"));
  deepEqual(await chosen, { chosen: true, reference: "hero.png" });
  deepEqual(root.read("Bitmap/hero.png"), new Uint8Array([7, 7]));
  bench.dispose();
});

test("the browser says what it cannot do: no rename, no handing a file to the OS", async () => {
  const { web, element } = project();
  const bench = createWorkbench(web, element);
  await settle(act);
  await click(row(element, "Misc"));
  await key(row(element, "Misc"), "ArrowRight");
  match(row(element, "readme.txt").getAttribute("aria-label") ?? "", /cannot be opened here/);
  await key(row(element, "readme.txt"), "Enter");
  match(element.querySelector(".tkr-files-message")?.textContent ?? "", /this host cannot open it in another application/);
  await click(row(element, "readme.txt"));
  await click(button(element, "Rename…"));
  const field = element.querySelector<HTMLInputElement>('.tkr-files-rename-row input')!;
  await act(() => { field.value = "notes.txt"; field.dispatchEvent(new Event("input", { bubbles: true })); });
  await click(button(element, "Rename"));
  match(element.querySelector(".tkr-files-message")?.textContent ?? "", /does not provide a portable atomic rename/);
  bench.dispose();
});

test("the layout is kept as identifiers and restored by a new workbench on the same project, panels resize from the keyboard", async () => {
  const { web, element } = project();
  const first = createWorkbench(web, element);
  await settle(act);
  await click(button(element, "Game"));
  const separator = element.querySelector<HTMLElement>('[role="separator"][aria-label="Resize Files"]');
  await key(separator, "ArrowRight", { shiftKey: true });
  equal(element.querySelector('[role="separator"][aria-label="Resize Files"]')?.getAttribute("aria-valuenow"), "304");
  const saved = first.saveLayout();
  deepEqual(saved.panels.map((panel) => Object.keys(panel).sort().join()), ["id,side,size,visible", "id,side,size,visible"]);
  first.dispose();
  const stored = await web.services.settings.get("user", "workbench.layout");
  ok(stored.ok && typeof stored.value === "string" && stored.value.includes("304"), "the layout is in the user's settings");

  document.body.replaceChildren();
  const again = document.createElement("div");
  document.body.append(again);
  const second = createWorkbench(web, again);
  await settle(act);
  equal(again.querySelector('[role="separator"][aria-label="Resize Files"]')?.getAttribute("aria-valuenow"), "304", "the size came back");
  ok(again.querySelector("#tkr-panel-game") !== null, "so did the Game panel");
  notEqual(second.layout.getPanels().find((panel) => panel.id === "game")?.visible, false);
  second.dispose();
});
