// The run setup form, the run status view and the header Run control (T-07, T-41; ADR 0022 D8, D8.7) over the real
// launcher, workspace and the in-memory host, under the same DOM shim as the other view tests. They reach the host only
// through platform-services: the launches stay distinct, a launch the host cannot do is disabled with the host's reason,
// unsaved work is saved first, a failed save is named, the run's snapshot and status are shown, and setups are saved in
// and run from `.tkr/launch.json`.
import { createHash } from "node:crypto";
import { after, before, test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createDocumentWorkspace, createLauncher, LAUNCH_SETUPS_PATH, type AnyDocument, type Launcher } from "@tk-reawakened/editor-model";
import type { Capability, RunHandle } from "@tk-reawakened/platform-services";
import { createMemoryPlatformServices, type MemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import type { RunSetupOutcome, ViewHandle } from "@tk-reawakened/editor-ui";
import { exampleBoard, exampleMain } from "./fixtures.ts";

type Index = typeof import("../src/index.ts");
let mountRun: Index["mountRun"];
let mountRunStatus: Index["mountRunStatus"];
let mountRunControl: Index["mountRunControl"];
let act: (callback: () => void | Promise<void>) => Promise<void> | void;

before(async () => {
  GlobalRegistrator.register();
  ({ act } = await import("preact/test-utils"));
  ({ mountRun, mountRunStatus, mountRunControl } = await import("@tk-reawakened/editor-ui"));
});

after(() => GlobalRegistrator.unregister());

const MAIN = "Main/example.gam";
const FILES = {
  [MAIN]: exampleMain(9),
  "Boards/village.brd": exampleBoard(),
  "Boards/caves.brd": exampleBoard(),
  "Prg/hello.prg": new Uint8Array([0x6d, 0x77, 0x69, 0x6e]),
  "Chrs/hero.tem": new Uint8Array([1]),
  "Chrs/second.tem": new Uint8Array([3]),
  "Bitmap/window.png": new Uint8Array([2]),
};
const sha = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

interface Setup {
  readonly host: MemoryPlatformServices;
  readonly el: HTMLElement;
  readonly main: AnyDocument;
  readonly finishLaunch: () => Promise<unknown>;
  readonly launcher: Launcher;
  readonly view: ViewHandle;
  /** What the form said it did, latest last. */
  readonly outcomes: RunSetupOutcome[];
}

async function setup(capabilities: readonly Capability[], active: string | null = null, mainPath = MAIN, withStore = false): Promise<Setup> {
  document.body.replaceChildren();
  const files = { ...Object.fromEntries(Object.entries(FILES).filter(([path]) => path !== MAIN)), [mainPath]: exampleMain(9) };
  const host = createMemoryPlatformServices({ files, capabilities: ["folderWrite", ...capabilities], runRefusal: "its player boots only from the main file's start-up." });
  const workspace = createDocumentWorkspace({ projectId: "memory-project", services: host });
  const opened = await workspace.open(mainPath);
  ok(opened.ok);
  const el = document.createElement("div");
  document.body.append(el);
  const launcher = createLauncher({ services: host, workspace });
  const start = launcher.launch.bind(launcher);
  let pending: Promise<unknown> = Promise.resolve();
  launcher.launch = (request) => {
    const result = start(request);
    pending = result;
    return result;
  };
  let view: ViewHandle | undefined;
  const outcomes: RunSetupOutcome[] = [];
  const { saveLaunchSetup, deleteLaunchSetup } = await import("@tk-reawakened/editor-model");
  await act(() => {
    view = mountRun(el, {
      launcher,
      fs: host.fs,
      layout: { projectFolder: "" },
      active,
      onDone: (outcome) => outcomes.push(outcome),
      ...(withStore ? {
        store: { fs: host.fs, readOnly: null },
        onSave: async (saved, replacing) => { const result = await saveLaunchSetup(host.fs, saved, replacing ?? undefined); return result.ok ? null : result.message; },
        onDelete: async (name) => { const result = await deleteLaunchSetup(host.fs, name); return result.ok ? null : result.message; },
      } : {}),
    });
  });
  // The panel lists the project asynchronously; every section renders the Board choice once that listing lands.
  const listed = (): boolean => [...el.querySelectorAll("option")].some((option) => option.value === "Boards/village.brd");
  if (!listed()) {
    await new Promise<void>((resolve) => {
      const observer = new MutationObserver(() => {
        if (!listed()) return;
        observer.disconnect();
        resolve();
      });
      observer.observe(el, { childList: true, subtree: true });
    });
  }
  return { host, el, main: opened.document, finishLaunch: () => pending, launcher, view: view!, outcomes };
}

/** Let pending promises settle inside act until `done` holds, so every render they cause is flushed by act. */
async function until(done: () => boolean): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < 200 && !done(); turn += 1) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
  ok(done(), "the awaited state was never reached");
}

/** Show a run in the status view, as the host's Running game tab does. */
async function statusOf(run: RunHandle): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.append(el);
  await act(() => { mountRunStatus(el, run); });
  const current = el.querySelector<HTMLElement>('[aria-label="Current run"]');
  ok(current);
  return current;
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
    if (select.multiple) {
      Object.defineProperty(select, "selectedOptions", {
        configurable: true,
        value: [...select.options].filter((option) => values.includes(option.value)),
      });
    }
    try {
      select.dispatchEvent(new Event("change", { bubbles: true }));
    } finally {
      if (select.multiple) Reflect.deleteProperty(select, "selectedOptions");
    }
  });
}

async function type(input: HTMLInputElement, value: string): Promise<void> {
  await act(() => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(button: HTMLButtonElement, finishLaunch: Setup["finishLaunch"]): Promise<void> {
  await act(async () => { button.click(); await finishLaunch(); });
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

test("Run game saves unsaved work first; the status view shows the run's snapshot and status", async () => {
  const { el, host, main, finishLaunch } = await setup(["runGame"]);
  ok(main.apply({ type: "set-game-title", title: "Run from the panel" }).ok);
  await click(launchButton(el, "Run game"), finishLaunch);
  equal(host.runs.length, 1);
  equal(main.getSnapshot().dirty, false, "saved before the run");
  const current = await statusOf(host.runs[0]!.handle);
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
  await act(() => { stop.click(); });
  ok(host.runs[0]!.stopped());
  equal(current.querySelector(".tkr-run-state")?.textContent, "Ended: The run was stopped. (tick 13, on Boards/village.brd)");
});

test("the form tells its opener about the run it started, and a new run stops the one before", async () => {
  const { el, host, launcher, outcomes, finishLaunch } = await setup(["runGame"]);
  await click(launchButton(el, "Run game"), finishLaunch);
  deepEqual(outcomes, [{ kind: "launched", handle: host.runs[0]!.handle, setup: null }]);
  await act(async () => { await launcher.launch({ kind: "game", main: MAIN, projectFolder: "" }); });
  ok(host.runs[0]!.stopped(), "the earlier run is stopped, not orphaned");
  ok(!host.runs[1]!.stopped());
  equal(launcher.current(), host.runs[1]!.handle);
});

test("a main file outside Main/ is found and run", async () => {
  const { el, host, finishLaunch } = await setup(["runGame"], null, "Games/Only.gam");
  const button = launchButton(el, "Run game");
  equal(button.disabled, false);
  await click(button, finishLaunch);
  equal(host.runs[0]!.launch.main, "Games/Only.gam");
});

test("a failed save stops the run and the panel names the document", async () => {
  const { el, host, main, finishLaunch } = await setup(["runGame"]);
  ok(main.apply({ type: "set-game-title", title: "Not run" }).ok);
  host.failWrites({ code: "permission-denied", message: "read-only" });
  await click(launchButton(el, "Run game"), finishLaunch);
  equal(host.runs.length, 0);
  const alert = el.querySelector('[role="alert"]');
  ok(alert?.textContent?.startsWith(`${MAIN} could not be saved`), alert?.textContent ?? "no alert");
});

test("Test board requires a party and preserves selection order with the first member as leader", async () => {
  const { el, host, finishLaunch } = await setup(["runGame", "runBoard"], "Boards/village.brd");
  const section = fieldset(el, "Test board");
  equal(labelled<HTMLSelectElement>(section, "Board", "select").value, "Boards/village.brd");
  const runButton = launchButton(el, "Test board");
  equal(runButton.disabled, true);
  equal(section.querySelector(".tkr-run-unavailable")?.textContent, "Choose at least one character for the party.");
  await type(labelled<HTMLInputElement>(section, "Column", "input"), "4");
  await type(labelled<HTMLInputElement>(section, "Row", "input"), "7");
  const party = labelled<HTMLSelectElement>(section, "Party", "select");
  equal(party.multiple, true);
  deepEqual([...party.options].map((option) => option.value), ["Chrs/hero.tem", "Chrs/second.tem"]);
  await choose(party, "Chrs/second.tem");
  await choose(party, "Chrs/hero.tem", "Chrs/second.tem");
  equal(runButton.disabled, false);
  await click(runButton, finishLaunch);
  deepEqual(host.runs[0]!.launch, { kind: "board", main: MAIN, projectFolder: "", start: { board: "Boards/village.brd", x: 4, y: 7, layer: 1 }, party: ["Chrs/second.tem", "Chrs/hero.tem"], expectedFiles: null });
  equal((await statusOf(host.runs[0]!.handle)).querySelector('[aria-label="Run snapshot"] dd')?.textContent, "Board test at Boards/village.brd (4, 7, layer 1)");
});

test("Test program runs one program under the fixture the panel names", async () => {
  const { el, host, finishLaunch } = await setup(["runProgram"]);
  const section = fieldset(el, "Test program");
  await choose(labelled<HTMLSelectElement>(section, "Start board", "select"), "Boards/caves.brd");
  await type(labelled<HTMLInputElement>(section, "Layer", "input"), "2");
  await type(labelled<HTMLInputElement>(section, "Font", "input"), "Arial");
  await type(labelled<HTMLInputElement>(section, "Font size", "input"), "14");
  await choose(labelled<HTMLSelectElement>(section, "Message window picture", "select"), "Bitmap/window.png");
  await click(launchButton(el, "Test program"), finishLaunch);
  deepEqual(host.runs[0]!.launch, {
    kind: "program",
    main: MAIN,
    projectFolder: "",
    program: "Prg/hello.prg",
    fixture: { id: "Unsaved test settings", party: [], font: "Arial", fontSize: 14, windowGraphic: "Bitmap/window.png", start: { board: "Boards/caves.brd", x: 1, y: 1, layer: 2 } },
  });
  equal((await statusOf(host.runs[0]!.handle)).querySelector('[aria-label="Run snapshot"] dd')?.textContent, 'Program test of Prg/hello.prg with fixture "Unsaved test settings" at Boards/caves.brd (1, 1, layer 2)');
});

test("a named setup is saved in .tkr/launch.json and Save and run runs it with its name as the fixture id", async () => {
  const { el, host, outcomes, finishLaunch } = await setup(["runProgram"], "Prg/hello.prg", MAIN, true);
  await act(() => { [...el.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((tab) => tab.textContent === "Test program")!.click(); });
  const save = [...el.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Save")!;
  equal(save.disabled, true, "a setup needs a name");
  equal(el.querySelector(".tkr-run-save .tkr-run-unavailable")?.textContent, "Give the setup a name to save it.");
  await type(labelled<HTMLInputElement>(el, "Setup name", "input"), "Shop test");
  await choose(labelled<HTMLSelectElement>(fieldset(el, "Test program"), "Start board", "select"), "Boards/caves.brd");
  const saveAndRun = [...el.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Save and run")!;
  await act(() => { saveAndRun.click(); });
  await until(() => outcomes.length === 1);
  await act(async () => { await finishLaunch(); });
  deepEqual(JSON.parse(new TextDecoder().decode(host.bytesOf(LAUNCH_SETUPS_PATH)!)), {
    version: 1,
    configurations: [{ name: "Shop test", kind: "program", program: "Prg/hello.prg", fixture: { party: [], start: { board: "Boards/caves.brd", x: 1, y: 1, layer: 1 } } }],
  });
  equal(host.runs.length, 1);
  equal(host.runs[0]!.launch.kind === "program" ? host.runs[0]!.launch.fixture.id : null, "Shop test");
  deepEqual(outcomes.map((outcome) => outcome.kind === "launched" ? outcome.setup : outcome.kind), ["Shop test"]);
});

test("the Run control runs the game by default, lists saved setups, marks a bad one unavailable and runs the chosen setup", async () => {
  document.body.replaceChildren();
  const host = createMemoryPlatformServices({
    files: {
      ...FILES,
      [LAUNCH_SETUPS_PATH]: new TextEncoder().encode(JSON.stringify({
        version: 1,
        configurations: [
          { name: "Village", kind: "board", start: { board: "Boards/village.brd", x: 2, y: 3, layer: 1 }, party: ["Chrs/hero.tem"], seed: 5 },
          { name: "Broken", kind: "nope" },
        ],
      })),
    },
    capabilities: ["folderWrite", "runGame", "runBoard"],
  });
  const workspace = createDocumentWorkspace({ projectId: "memory-project", services: host });
  const launcher = createLauncher({ services: host, workspace });
  const remembered: (string | null)[] = [];
  const shown: RunHandle[] = [];
  const el = document.createElement("div");
  document.body.append(el);
  let control: ViewHandle | undefined;
  await act(() => {
    control = mountRunControl(el, {
      launcher,
      fs: host.fs,
      layout: { projectFolder: "" },
      main: MAIN,
      store: { fs: host.fs, readOnly: null },
      memory: { get: async () => null, set: (name) => { remembered.push(name); } },
      onRun: (handle) => shown.push(handle),
    });
  });
  const chooser = el.querySelector<HTMLSelectElement>('select[aria-label="Run setup"]')!;
  await until(() => chooser.options.length === 4);
  deepEqual([...chooser.options].map((option) => [option.textContent, option.disabled]), [
    ["Game start-up", false],
    ["Village", false],
    ['Broken (unavailable: kind must be "game", "board" or "program".)', true],
    ["Add setup…", false],
  ]);
  const run = el.querySelector<HTMLButtonElement>('button[aria-label="Run"]')!;
  await act(() => { run.click(); });
  await until(() => shown.length === 1);
  deepEqual(host.runs[0]!.launch, { kind: "game", main: MAIN, projectFolder: "" });
  ok([...el.querySelectorAll("button")].some((button) => button.textContent === "Stop"), "Stop shows while the game runs");
  await choose(chooser, "Village");
  deepEqual(remembered, ["Village"], "the choice is remembered per user");
  await act(() => { run.click(); });
  await until(() => shown.length === 2);
  deepEqual(host.runs[1]!.launch, { kind: "board", main: MAIN, projectFolder: "", seed: 5, start: { board: "Boards/village.brd", x: 2, y: 3, layer: 1 }, party: ["Chrs/hero.tem"], expectedFiles: null });
  ok(host.runs[0]!.stopped(), "the earlier run is stopped");
  deepEqual(shown, [host.runs[0]!.handle, host.runs[1]!.handle], "each run is handed to the host to show");
  // Unmount inside act so no effect is left scheduled after the DOM shim is removed.
  await act(() => { control!.dispose(); });
});
