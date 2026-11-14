// The Run panel (T-07, T-41; ADR 0022 D8) over the real launcher, workspace and the in-memory host, under the same DOM
// shim as the other view tests. It reaches the host only through platform-services: the launches stay distinct, a launch
// the host cannot do is disabled with the host's reason, unsaved work is saved first, a failed save is named, and the
// run's snapshot and status are shown.
import { createHash } from "node:crypto";
import { after, before, test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createDocumentWorkspace, createLauncher, type AnyDocument } from "@tk-reawakened/editor-model";
import type { Capability } from "@tk-reawakened/platform-services";
import { createMemoryPlatformServices, type MemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { exampleBoard, exampleMain } from "./fixtures.ts";

type Index = typeof import("../src/index.ts");
let mountRun: Index["mountRun"];
let act: (callback: () => void | Promise<void>) => Promise<void> | void;

before(async () => {
  GlobalRegistrator.register();
  ({ act } = await import("preact/test-utils"));
  ({ mountRun } = await import("@tk-reawakened/editor-ui"));
});

after(() => GlobalRegistrator.unregister());

const MAIN = "Main/example.gam";
const FILES = {
  [MAIN]: exampleMain(9),
  "Boards/village.brd": exampleBoard(),
  "Boards/caves.brd": exampleBoard(),
  "Prg/hello.prg": new Uint8Array([0x6d, 0x77, 0x69, 0x6e]),
  "Chrs/hero.tem": new Uint8Array([1]),
  "Bitmap/window.png": new Uint8Array([2]),
};
const sha = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const settle = async (): Promise<void> => {
  for (let round = 0; round < 6; round += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
};

interface Setup {
  readonly host: MemoryPlatformServices;
  readonly el: HTMLElement;
  readonly main: AnyDocument;
}

async function setup(capabilities: readonly Capability[], active: string | null = null): Promise<Setup> {
  document.body.replaceChildren();
  const host = createMemoryPlatformServices({ files: FILES, capabilities: ["folderWrite", ...capabilities], runRefusal: "its player boots only from the main file's start-up." });
  const workspace = createDocumentWorkspace({ projectId: "memory-project", services: host });
  const opened = await workspace.open(MAIN);
  ok(opened.ok);
  const el = document.createElement("div");
  document.body.append(el);
  await act(() => { mountRun(el, { launcher: createLauncher({ services: host, workspace }), fs: host.fs, layout: { projectFolder: "" }, active }); });
  await settle();
  return { host, el, main: opened.document };
}

function launchButton(el: HTMLElement, name: string): HTMLButtonElement {
  const button = [...el.querySelectorAll<HTMLButtonElement>("fieldset button")].find((candidate) => candidate.textContent === name);
  ok(button, `no ${name} button`);
  return button;
}

function fieldset(el: HTMLElement, legend: string): HTMLFieldSetElement {
  const found = [...el.querySelectorAll("fieldset")].find((candidate) => candidate.querySelector("legend")?.textContent === legend);
  ok(found, `no ${legend} section`);
  return found;
}

function labelled<T extends HTMLElement>(scope: HTMLElement, label: string, selector: string): T {
  const found = [...scope.querySelectorAll("label")].find((candidate) => candidate.firstChild?.textContent === label)?.querySelector<T>(selector);
  ok(found, `no ${label} field`);
  return found;
}

async function choose(select: HTMLSelectElement, ...values: string[]): Promise<void> {
  await act(() => {
    for (const option of select.options) option.selected = values.includes(option.value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function type(input: HTMLInputElement, value: string): Promise<void> {
  await act(() => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(() => { button.click(); });
  await settle();
}

test("the three launches are distinct, and one the host cannot do is disabled with the host's reason", async () => {
  const { el, host } = await setup(["runGame"]);
  deepEqual([...el.querySelectorAll("legend")].map((legend) => legend.textContent), ["Run game", "Test board", "Test program"]);
  equal(launchButton(el, "Run game").disabled, false);
  const board = launchButton(el, "Test board");
  equal(board.disabled, true);
  const reason = el.querySelector(`#${board.getAttribute("aria-describedby")}`);
  equal(reason?.textContent, "This host cannot start a board test: its player boots only from the main file's start-up.");
  equal(launchButton(el, "Test program").disabled, true);
  equal(host.runs.length, 0);
});

test("Run game saves unsaved work first and shows the run's snapshot and status", async () => {
  const { el, host, main } = await setup(["runGame"]);
  ok(main.apply({ type: "set-game-title", title: "Run from the panel" }).ok);
  await click(launchButton(el, "Run game"));
  equal(host.runs.length, 1);
  equal(main.getSnapshot().dirty, false, "saved before the run");
  const current = el.querySelector('[aria-label="Current run"]');
  ok(current);
  equal(current.querySelector(".tkr-run-state")?.textContent, "Running (tick 0)");
  const snapshot = current.querySelector('[aria-label="Run snapshot"]')!;
  equal(snapshot.querySelector("dd")?.textContent, "Game from its start-up");
  const hash = sha(host.bytesOf(MAIN)!);
  ok([...snapshot.querySelectorAll("dd")].some((dd) => dd.getAttribute("title") === hash), "the main file's SHA-256 is shown");

  await act(() => host.runs[0]!.report({ state: "stalled", stalledOn: "Tiles/grass.tst", tick: 12, board: "Boards/village.brd" }));
  equal(current.querySelector(".tkr-run-state")?.textContent, "Waiting for a file: Tiles/grass.tst (tick 12, on Boards/village.brd)");
  await act(() => host.runs[0]!.report({ state: "running", stalledOn: null, tick: 13, diagnostics: [{ code: "asset.missing", file: "Boards/village.brd", line: 0, message: "Tiles/gone.tst is missing" }] }));
  equal(current.querySelector(".tkr-run-diagnostics li")?.textContent, "Boards/village.brd: Tiles/gone.tst is missing (asset.missing)");
  const stop = [...current.querySelectorAll("button")].find((button) => button.textContent === "Stop")!;
  await click(stop);
  ok(host.runs[0]!.stopped());
  equal(current.querySelector(".tkr-run-state")?.textContent, "Ended: The run was stopped. (tick 13, on Boards/village.brd)");
});

test("a failed save stops the run and the panel names the document", async () => {
  const { el, host, main } = await setup(["runGame"]);
  ok(main.apply({ type: "set-game-title", title: "Not run" }).ok);
  host.failWrites({ code: "permission-denied", message: "read-only" });
  await click(launchButton(el, "Run game"));
  equal(host.runs.length, 0);
  const alert = el.querySelector('[role="alert"]');
  ok(alert?.textContent?.startsWith(`${MAIN} could not be saved`), alert?.textContent ?? "no alert");
});

test("Test board starts at the chosen board, position and party; the document in front is offered first", async () => {
  const { el, host } = await setup(["runGame", "runBoard"], "Boards/village.brd");
  const section = fieldset(el, "Test board");
  equal(labelled<HTMLSelectElement>(section, "Board", "select").value, "Boards/village.brd");
  await type(labelled<HTMLInputElement>(section, "Column", "input"), "4");
  await type(labelled<HTMLInputElement>(section, "Row", "input"), "7");
  await choose(labelled<HTMLSelectElement>(section, "Party", "select"), "Chrs/hero.tem");
  await click(launchButton(el, "Test board"));
  deepEqual(host.runs[0]!.launch, { kind: "board", main: MAIN, projectFolder: "", start: { board: "Boards/village.brd", x: 4, y: 7, layer: 1 }, party: ["Chrs/hero.tem"] });
  equal(el.querySelector('[aria-label="Run snapshot"] dd')?.textContent, "Board test at Boards/village.brd (4, 7, layer 1)");
});

test("Test program runs one program under the fixture the panel names", async () => {
  const { el, host } = await setup(["runProgram"]);
  const section = fieldset(el, "Test program");
  await choose(labelled<HTMLSelectElement>(section, "Start board", "select"), "Boards/caves.brd");
  await type(labelled<HTMLInputElement>(section, "Layer", "input"), "2");
  await type(labelled<HTMLInputElement>(section, "Font", "input"), "Arial");
  await type(labelled<HTMLInputElement>(section, "Font size", "input"), "14");
  await choose(labelled<HTMLSelectElement>(section, "Message window picture", "select"), "Bitmap/window.png");
  await click(launchButton(el, "Test program"));
  deepEqual(host.runs[0]!.launch, {
    kind: "program",
    main: MAIN,
    projectFolder: "",
    program: "Prg/hello.prg",
    fixture: { id: "Run panel test settings", party: [], font: "Arial", fontSize: 14, windowGraphic: "Bitmap/window.png", start: { board: "Boards/caves.brd", x: 1, y: 1, layer: 2 } },
  });
  equal(el.querySelector('[aria-label="Run snapshot"] dd')?.textContent, 'Program test of Prg/hello.prg with fixture "Run panel test settings" at Boards/caves.brd (1, 1, layer 2)');
});
