// Story 11.10, T-04 and T-05 in both hosts: the browser workbench shows the wizard and VS Code asks the same questions one at
// a time. Both make the same project through the model: the 14 reserved folders, a main file that reads back, optional
// starter contents that are explicit, never over an existing file, nothing written on cancel, and a failed creation that
// keeps what it wrote and changes nothing that was there. The created project then opens and its references resolve.
import { deepEqual, equal, match, ok } from "node:assert/strict";
import { after, before, test } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { ASSET_FOLDERS, BinaryReader, PACKAGE_ROOT, readBoard, readMainFile, type AssetKind } from "@tk-reawakened/core";
import { STARTER_DEFINITIONS, createDocumentWorkspace, projectLayoutOfMain, referencePath, reservedFolder, type ProjectLayout, type StarterDefinition } from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices, type MemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import type { DialogQuestion, DialogService, ProjectHandle } from "@tk-reawakened/platform-services";
import type { createWorkbench as CreateWorkbench, newWebProject as NewWebProject } from "@tk-reawakened/host-web/testing";
import type { runNewProject as RunNewProject } from "@tk-reawakened/host-vscode/testing";
import type { Workbench } from "@tk-reawakened/host-web";
import { engineBoot } from "../conformance/engine-view.ts";
import { MemoryDirectory, type WriteControl } from "../conformance/memory-directory.ts";
import { settle, type Act } from "../conformance/view.ts";

let act: Act;
let createWorkbench: typeof CreateWorkbench;
let newWebProject: typeof NewWebProject;
let runNewProject: typeof RunNewProject;

before(async () => {
  GlobalRegistrator.register();
  const { act: preactAct } = await import("preact/test-utils");
  let queue: Promise<void> = Promise.resolve();
  act = (callback) => {
    const run = queue.then(() => preactAct(callback));
    queue = run.catch(() => undefined);
    return run;
  };
  ({ createWorkbench, newWebProject } = await import("@tk-reawakened/host-web/testing"));
  ({ runNewProject } = await import("@tk-reawakened/host-vscode/testing"));
});

after(() => GlobalRegistrator.unregister());

const KINDS = Object.keys(ASSET_FOLDERS) as AssetKind[];
const bystander = new Uint8Array([4, 2, 4, 2]);
const REGISTERED: ProjectHandle = { id: "web:new-project-test", name: "games" };

class Dialogs implements DialogService {
  async ask<Id extends string>(question: DialogQuestion<Id>): Promise<Id> { return question.cancel; }
  async pickSavePath(): Promise<string | null> { return null; }
}

function userStorage() {
  const items = new Map<string, string>();
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value), removeItem: (key: string) => void items.delete(key) };
}

function folder(files: Readonly<Record<string, Uint8Array>> = {}) {
  const control: WriteControl = { refuse: false, hold: null, tick: 0 };
  const root = new MemoryDirectory("games", control);
  for (const [path, bytes] of Object.entries(files)) root.put(path, bytes);
  document.body.replaceChildren();
  const element = document.createElement("div");
  document.body.append(element);
  return { root, control, element };
}

const field = (element: HTMLElement, label: string): HTMLInputElement => {
  const target = [...element.querySelectorAll("label")].find((candidate) => candidate.textContent === label);
  const found = target === undefined ? null : element.querySelector<HTMLInputElement>(`#${CSS.escape(target.htmlFor)}`);
  if (found === null) throw new Error(`no field ${label}: ${element.innerHTML}`);
  return found;
};
const type = async (target: HTMLInputElement, value: string): Promise<void> => {
  await act(() => { target.value = value; target.dispatchEvent(new Event("input", { bubbles: true })); });
};
const tick = async (element: HTMLElement, label: string): Promise<void> => {
  await act(() => { const box = field(element, label); box.checked = true; box.dispatchEvent(new Event("change", { bubbles: true })); });
};
const press = async (element: HTMLElement, selector: string): Promise<void> => {
  await act(() => { element.querySelector<HTMLButtonElement>(selector)!.click(); });
  await settle(act);
};
const submit = async (element: HTMLElement): Promise<void> => {
  await act(() => { element.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await settle(act);
};
const alerts = (element: HTMLElement): string => [...element.querySelectorAll('[role="alert"]')].map((node) => node.textContent ?? "").join(" ");

function folderNames(root: MemoryDirectory): string[] {
  return [...root.children].filter(([, entry]) => entry instanceof MemoryDirectory).map(([name]) => name).sort();
}
function mainOf(bytes: Uint8Array | null) {
  ok(bytes !== null, "the main file exists");
  const read = readMainFile(new BinaryReader(bytes, "Main/Quest.gam"));
  ok(read.ok, read.ok ? "" : read.error.message);
  return read.value;
}

/** Start the wizard over `element`, as the page's "New project…" button does. */
function startWizard(root: MemoryDirectory, element: HTMLElement, options: { picks?: () => Promise<FileSystemDirectoryHandle | null>; register?: () => Promise<ProjectHandle | null>; starters?: readonly StarterDefinition[] } = {}) {
  return newWebProject({
    element,
    dialogs: new Dialogs(),
    userSettings: userStorage(),
    pickDirectory: options.picks ?? (async () => root as unknown as FileSystemDirectoryHandle),
    register: options.register ?? (async () => REGISTERED),
    ...(options.starters === undefined ? {} : { starters: options.starters }),
  });
}
test("browser modal contains forward and reverse Tab focus", async () => {
  const { root, element } = folder();
  const made = startWizard(root, element);
  await settle(act);
  const first = field(element, "Game name");
  const last = element.querySelector<HTMLButtonElement>(".tkr-new-project-cancel")!;
  equal(document.activeElement, first);
  await act(() => { first.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })); });
  equal(document.activeElement, last, "Shift+Tab from the first control wraps to the last control");
  await act(() => { last.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })); });
  equal(document.activeElement, first, "Tab from the last control wraps to the first control");
  await act(() => { element.querySelector<HTMLFormElement>("form")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
  const cancelled = await made;
  equal(cancelled.ok, false);
});

function customStarter(): StarterDefinition {
  return {
    id: "custom-start-script",
    label: "Custom start script",
    description: "A project-specific starter.",
    writes: "Prg/custom.prg",
    provenance: "Test fixture.",
    unavailable: null,
    contribute: () => ({ files: [{ path: "Prg/custom.prg", bytes: new Uint8Array([99]) }], main: { startupPrg: "custom.prg" } }),
  };
}

test("injected starter definitions validate and are written by both hosts", async () => {
  const custom = customStarter();
  const { root, element } = folder();
  const made = startWizard(root, element, { starters: [custom] });
  await settle(act);
  await type(field(element, "Game name"), "Quest");
  equal(field(element, "Custom start script").disabled, false);
  await tick(element, "Custom start script");
  await press(element, ".tkr-new-project-choose");
  await submit(element);
  const web = await made;
  ok(web.ok);
  deepEqual([...root.read("Prg/custom.prg")!], [99]);
  equal(mainOf(root.read("Main/Quest.gam")).startupPrg, "custom.prg");
  web.project.deactivate();

  const host = createMemoryPlatformServices();
  const destinationFolder = destination(host);
  const vscode = await runNewProject({
    ui: scripted(["Quest", "Quest.gam", ["custom-start-script"]]).ui,
    chooseDestination: destinationFolder.chooseDestination,
    starters: [custom],
  });
  ok(vscode.ok, vscode.ok ? "" : vscode.message);
  deepEqual(host.bytesOf("Prg/custom.prg"), new Uint8Array([99]));
  equal(mainOf(host.bytesOf("Main/Quest.gam") ?? null).startupPrg, "custom.prg");
});

test("the browser wizard makes a blank project: the 14 folders, a main file that reads back, and the project opens on it", async () => {
  const { root, element } = folder({ "notes.txt": bystander });
  const made = startWizard(root, element);
  await settle(act);
  ok(element.querySelector('[role="dialog"][aria-label="New project"]') !== null, "the wizard is shown");
  await type(field(element, "Game name"), "Quest");
  equal(field(element, "Main file").value, "Quest.gam");
  await press(element, ".tkr-new-project-choose");
  equal(element.querySelector(".tkr-new-project-destination")?.textContent, "games");
  await submit(element);
  const result = await made;
  ok(result.ok);
  equal(result.mainPath, "Main/Quest.gam");
  equal(element.querySelector('[role="dialog"]'), null, "the wizard closes");
  deepEqual(folderNames(root), [...Object.values(ASSET_FOLDERS), "Main"].sort());
  const main = mainOf(root.read("Main/Quest.gam"));
  equal(main.gameTitle, "Quest");
  deepEqual([main.startupPrg, main.initBoard, main.initChar], ["", "", ""], "nothing was copied that was not asked for");
  deepEqual(root.read("notes.txt"), bystander, "a file already in the folder is untouched");

  // The project opens: its layout is read from the generated main file, every reserved folder resolves, and the main file opens in a tab.
  const layout = await projectLayoutOfMain(result.project.services.fs, result.project.project.id, result.mainPath);
  deepEqual(layout, { projectFolder: "" });
  for (const kind of KINDS) {
    const stat = await result.project.services.fs.stat(reservedFolder(layout, kind));
    ok(stat.ok && stat.value.kind === "directory", `${kind} resolves to ${reservedFolder(layout, kind)}`);
  }
  document.body.replaceChildren();
  const stage = document.createElement("div");
  document.body.append(stage);
  let bench!: Workbench;
  await act(() => { bench = createWorkbench(result.project, stage, { projectLayout: layout }); });
  await settle(act);
  await act(async () => { await bench.openPath(result.mainPath); });
  await settle(act);
  deepEqual(bench.tabs.getSnapshot().tabs.map((tab) => tab.path), ["Main/Quest.gam"]);
  equal(stage.querySelector(".tkr-settings input")?.getAttribute("value") ?? (stage.querySelector(".tkr-settings input") as HTMLInputElement | null)?.value, "Quest");
  bench.dispose();
  result.project.deactivate();
});

test("the browser wizard copies only the starter contents that were ticked, offers the rest as unavailable, and the references resolve", async () => {
  const { root, element } = folder();
  const made = startWizard(root, element);
  await settle(act);
  ok(field(element, "Music pack").disabled && field(element, "Default tiles").disabled, "unavailable items cannot be ticked");
  await type(field(element, "Game name"), "Quest");
  await tick(element, "Start-up program");
  await tick(element, "Empty start board");
  await press(element, ".tkr-new-project-choose");
  await submit(element);
  const result = await made;
  ok(result.ok);
  const main = mainOf(root.read("Main/Quest.gam"));
  deepEqual([main.startupPrg, main.initBoard, main.initChar, main.menuPlugin], ["start.prg", "start.brd", "", ""]);
  ok(root.read("Prg/start.prg") !== null && root.read("Boards/start.brd") !== null);
  equal(root.read("Chrs/start.tem"), null, "the character was not ticked, so none was made");
  equal(root.read("Tiles/anything"), null);
  const board = readBoard(new BinaryReader(root.read("Boards/start.brd")!, "Boards/start.brd"));
  ok(board.ok);

  // Both stored references resolve through the reserved folders, and the generated board opens in the workspace.
  const layout: ProjectLayout = await projectLayoutOfMain(result.project.services.fs, result.project.project.id, result.mainPath);
  for (const [kind, reference] of [["programs", main.startupPrg], ["boards", main.initBoard]] as const) {
    const stat = await result.project.services.fs.stat(referencePath(layout, kind, reference));
    ok(stat.ok && stat.value.kind === "file", `${reference} resolves`);
  }
  const opened = await result.project.workspace.open("Boards/start.brd");
  ok(opened.ok, opened.ok ? "" : JSON.stringify(opened));
  result.project.deactivate();
});

test("cancelling the wizard, or the folder dialog, writes nothing", async () => {
  const { root, element } = folder({ "notes.txt": bystander });
  const made = startWizard(root, element, { picks: async () => null });
  await settle(act);
  await type(field(element, "Game name"), "Quest");
  await press(element, ".tkr-new-project-choose");
  match(element.querySelector(".tkr-new-project-destination")?.textContent ?? "", /No folder chosen/);
  await submit(element);
  match(alerts(element), /Choose the folder/);
  await press(element, ".tkr-new-project-cancel");
  const result = await made;
  equal(result.ok, false);
  equal(!result.ok && result.reason, "cancelled");
  equal(element.querySelector('[role="dialog"]'), null);
  deepEqual([...root.children.keys()], ["notes.txt"], "the folder holds exactly what it held before");
});

test("an existing project is never replaced: the wizard lists every conflict, stays open, and a different main file name then succeeds", async () => {
  const existing = new Uint8Array([7, 7, 7]);
  const { root, element } = folder({ "Main/Quest.gam": existing, "Prg/start.prg": existing, "Boards/old.brd": bystander });
  const made = startWizard(root, element);
  await settle(act);
  await type(field(element, "Game name"), "Quest");
  await tick(element, "Start-up program");
  await press(element, ".tkr-new-project-choose");
  await submit(element);
  match(alerts(element), /conflicting paths were found.*already exists/);
  deepEqual([...element.querySelectorAll(".tkr-new-project-failure li")].map((item) => item.textContent), ["Prg/start.prg", "Main/Quest.gam"]);
  ok(element.querySelector('[role="dialog"]') !== null, "the wizard stays open");
  deepEqual(root.read("Main/Quest.gam"), existing);
  deepEqual(root.read("Prg/start.prg"), existing);
  equal(root.children.has("Tiles"), false, "no folder was made for a refused creation");

  // Untick the program (a program is the clash) and pick another main file: the same wizard now completes.
  await act(() => { const box = field(element, "Start-up program"); box.checked = false; box.dispatchEvent(new Event("change", { bubbles: true })); });
  await type(field(element, "Main file"), "Quest2");
  await submit(element);
  const result = await made;
  ok(result.ok);
  equal(result.mainPath, "Main/Quest2.gam");
  deepEqual(root.read("Main/Quest.gam"), existing, "the existing main file is as it was");
  deepEqual(root.read("Boards/old.brd"), bystander);
  result.project.deactivate();
});

test("a refused write leaves the wizard open with what was written and pending, deletes nothing, and finishes once the leftover is removed", async () => {
  const { root, control, element } = folder({ "notes.txt": bystander });
  const made = startWizard(root, element);
  await settle(act);
  await type(field(element, "Game name"), "Quest");
  await tick(element, "Start-up program");
  await press(element, ".tkr-new-project-choose");
  control.refuse = true;
  await submit(element);
  match(alerts(element), /Could not write Prg\/start\.prg/);
  match(alerts(element), /deletes nothing here, because it cannot prove that file is this write's own/);
  match(alerts(element), /Nothing that existed before was changed, and the editor deleted nothing/);
  deepEqual([...element.querySelectorAll(".tkr-new-project-failure li")].map((item) => item.textContent), ["Prg/start.prg", "Main/Quest.gam"]);
  equal(root.read("Main/Quest.gam"), null, "no main file was written");
  deepEqual(root.read("notes.txt"), bystander);
  // The browser created the file before the refused write committed anything: the wizard leaves it alone.
  deepEqual(root.read("Prg/start.prg"), new Uint8Array(0), "the empty file stays; the wizard cannot prove it made it");

  control.refuse = false;
  await submit(element);
  match(alerts(element), /Prg\/start\.prg already exists; the editor refuses existing files/);
  ok(element.querySelector('[role="dialog"]') !== null, "the wizard stays open");

  // The author removes the file it cannot prove it owns, and the same answers then finish the project.
  const programs = root.children.get("Prg");
  if (!(programs instanceof MemoryDirectory)) throw new Error("the Prg folder is missing");
  await act(async () => { await programs.removeEntry("start.prg"); });
  await submit(element);
  const result = await made;
  ok(result.ok, result.ok ? "" : result.message);
  ok(root.read("Main/Quest.gam") !== null && root.read("Prg/start.prg") !== null);
  result.project.deactivate();
});

test("a browser that cannot remember the folder still reports the project it made; one with no folder picker says so", async () => {
  const { root, element } = folder();
  const made = startWizard(root, element, { register: async () => null });
  await settle(act);
  await type(field(element, "Game name"), "Quest");
  await press(element, ".tkr-new-project-choose");
  await submit(element);
  const result = await made;
  equal(result.ok, false);
  equal(!result.ok && result.reason, "unregistered");
  ok(root.read("Main/Quest.gam") !== null, "the project exists on disk");
  match(!result.ok ? result.message : "", /Open project folder/);
  equal(element.querySelector('[role="dialog"]'), null);

  const noPicker = await newWebProject({ element, dialogs: new Dialogs(), userSettings: userStorage() });
  equal(noPicker.ok, false);
  equal(!noPicker.ok && noPicker.reason, "unsupported");
  equal(element.querySelector('[role="dialog"]'), null, "no wizard is shown that could not finish");
});

/** Answers in order; `undefined` dismisses the question. */
function scripted(answers: readonly (string | readonly string[] | undefined)[]) {
  const asked: string[] = [];
  const queue = [...answers];
  return {
    asked,
    remaining: () => queue.length,
    ui: {
      input: async (question: { prompt: string; validate: (value: string) => string | null }): Promise<string | undefined> => {
        asked.push(question.prompt);
        const answer = queue.shift();
        if (typeof answer === "string") ok(question.validate(answer) === null, `"${answer}" for ${question.prompt}: ${question.validate(answer)}`);
        return answer as string | undefined;
      },
      pickMany: async (question: { title: string; items: readonly { id: string; available: boolean }[] }): Promise<readonly string[] | undefined> => {
        asked.push(question.title);
        return queue.shift() as readonly string[] | undefined;
      },
    },
  };
}

function destination(host: MemoryPlatformServices) {
  let asked = 0;
  return { asks: () => asked, chooseDestination: async () => { asked += 1; return { handle: "destination", storage: host.fs }; } };
}

test("VS Code asks the questions one at a time and makes the same project; a dismissed question makes nothing", async () => {
  for (const dismissAt of [0, 1, 2]) {
    const host = createMemoryPlatformServices({ files: { "notes.txt": bystander } });
    const answers = ["Quest", "Quest.gam", ["start-program"]].map((answer, index) => (index === dismissAt ? undefined : answer));
    const dest = destination(host);
    const outcome = await runNewProject({ ui: scripted(answers).ui, chooseDestination: dest.chooseDestination });
    equal(outcome.ok, false);
    equal(outcome.ok === false && outcome.reason, "cancelled");
    equal(dest.asks(), 0, "the folder dialog is not shown after a dismissed question");
    const listed = await host.fs.list("");
    ok(listed.ok);
    deepEqual(listed.value.map((entry) => entry.name), ["notes.txt"], `dismissing question ${dismissAt} wrote nothing`);
  }
  const host = createMemoryPlatformServices();
  const dismissedFolder = await runNewProject({ ui: scripted(["Quest", "Quest.gam", []]).ui, chooseDestination: async () => undefined });
  equal(dismissedFolder.ok === false && dismissedFolder.reason, "cancelled");
  const empty = await host.fs.list("");
  ok(empty.ok);
  deepEqual(empty.value, [], "a dismissed folder dialog wrote nothing");
});

test("VS Code makes a blank project and one with starter contents, opens its main file and resolves its references", async () => {
  const blank = createMemoryPlatformServices();
  const dest = destination(blank);
  const asked = scripted(["Quest", "Quest.gam", []]);
  const made = await runNewProject({ ui: asked.ui, chooseDestination: dest.chooseDestination });
  deepEqual(made, { ok: true, handle: "destination", mainPath: "Main/Quest.gam", written: ["Main/Quest.gam"] });
  equal(asked.remaining(), 0);
  for (const kind of KINDS) {
    const stat = await blank.fs.stat(ASSET_FOLDERS[kind]);
    ok(stat.ok && stat.value.kind === "directory", `${ASSET_FOLDERS[kind]} exists`);
  }

  const full = createMemoryPlatformServices();
  const second = await runNewProject({ ui: scripted(["Quest", "Quest.gam", ["start-program", "start-board", "start-character", "builtin-menu-battle"]]).ui, chooseDestination: destination(full).chooseDestination });
  ok(second.ok);
  const main = mainOf(full.bytesOf("Main/Quest.gam") ?? null);
  deepEqual([main.startupPrg, main.initBoard, main.initChar, main.menuPlugin, main.fightPlugin], ["start.prg", "start.brd", "start.tem", "tk3menu.dll", "tk3fight.dll"]);
  const layout = await projectLayoutOfMain(full.fs, "memory-project", second.mainPath);
  for (const [kind, reference] of [["programs", main.startupPrg], ["boards", main.initBoard], ["characters", main.initChar]] as const) {
    ok((await full.fs.stat(referencePath(layout, kind, reference))).ok, `${reference} resolves`);
  }
  const workspace = createDocumentWorkspace({ projectId: "memory-project", services: { fs: full.fs, dialogs: full.dialogs, capabilities: full.capabilities } });
  ok((await workspace.open(second.mainPath)).ok, "the generated main file opens");
  ok((await workspace.open("Boards/start.brd")).ok, "the generated board opens");
  workspace.dispose();
});

test("VS Code refuses an unavailable starter item and an existing project before writing anything", async () => {
  const host = createMemoryPlatformServices();
  const unavailable = await runNewProject({ ui: scripted(["Quest", "Quest.gam", ["music"]]).ui, chooseDestination: destination(host).chooseDestination });
  ok(!unavailable.ok && unavailable.reason === "refused");
  match(unavailable.message, /Music pack is not available: No rights-cleared music/);
  const none = await host.fs.list("");
  ok(none.ok);
  deepEqual(none.value, []);

  const existing = new Uint8Array([9, 9]);
  const taken = createMemoryPlatformServices({ files: { "Main/Quest.gam": existing, "notes.txt": bystander } });
  const refused = await runNewProject({ ui: scripted(["Quest", "Quest.gam", []]).ui, chooseDestination: destination(taken).chooseDestination });
  ok(!refused.ok && refused.reason === "refused");
  match(refused.message, /Main\/Quest\.gam already exists; the editor refuses existing files.*Nothing was written/);
  deepEqual(taken.bytesOf("Main/Quest.gam"), existing);
  equal((await taken.fs.stat("Boards")).ok, false, "no folder was made");
});

test("a project either host creates boots in the real engine onto its start board, with no diagnostics when no plugin was asked for", async () => {
  const PATHS = ["Prg/start.prg", "Boards/start.brd", "Chrs/start.tem", "Main/Quest.gam"];
  // VS Code's project, over the memory host.
  const host = createMemoryPlatformServices();
  const second = await runNewProject({ ui: scripted(["Quest", "Quest.gam", ["start-program", "start-board", "start-character"]]).ui, chooseDestination: destination(host).chooseDestination });
  ok(second.ok);
  const vscodeBoot = engineBoot(Object.fromEntries(PATHS.map((path) => [path, host.bytesOf(path)!])), second.mainPath, 60, 20, PACKAGE_ROOT);
  deepEqual(vscodeBoot, { stage: "running", board: "boards/start.brd", diagnostics: [] });

  // The browser's project, over a folder handle: the same bytes boot the same way.
  const { root, element } = folder();
  const made = startWizard(root, element);
  await settle(act);
  await type(field(element, "Game name"), "Quest");
  for (const label of ["Start-up program", "Empty start board", "Empty first character"]) await tick(element, label);
  await press(element, ".tkr-new-project-choose");
  await submit(element);
  const result = await made;
  ok(result.ok);
  const webBoot = engineBoot(Object.fromEntries(PATHS.map((path) => [path, root.read(path)!])), result.mainPath, 60, 20, PACKAGE_ROOT);
  deepEqual(webBoot, vscodeBoot);
  deepEqual(root.read("Main/Quest.gam"), host.bytesOf("Main/Quest.gam"), "both hosts write the same main file for the same answers");
  result.project.deactivate();
});
