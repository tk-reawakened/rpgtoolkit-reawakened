// The shell of story 11.4 over the real workspace, tree, tabs, layout and the in-memory host, under the same DOM shim
// as the other view tests: the Files and Game panels, the tab strip, the resizable workbench and the asset picker.
// Assertions are on the DOM and on bytes. Every action is driven from the keyboard as well as by button.
import { after, before, test } from "node:test";
import { deepEqual, equal, match, notEqual, ok } from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  createAssetPicker,
  createDocumentWorkspace,
  createLayoutModel,
  createProjectTree,
  createTabs,
  type AnyDocument,
} from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices, type MemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { exampleBoard, exampleMain } from "./fixtures.ts";

type Index = typeof import("../src/index.ts");
let mountShell: Index["mountShell"];
let mountAssetPicker: Index["mountAssetPicker"];
let act: (callback: () => void | Promise<void>) => Promise<void> | void;

before(async () => {
  GlobalRegistrator.register();
  ({ act } = await import("preact/test-utils"));
  ({ mountShell, mountAssetPicker } = await import("@tk-reawakened/editor-ui"));
});

after(() => GlobalRegistrator.unregister());

const FILES = {
  "Main/example.gam": exampleMain(9),
  "Boards/village.brd": exampleBoard(),
  "Boards/caves/mine.brd": exampleBoard(),
  "Misc/readme.txt": new Uint8Array([2]),
};

const settle = async (): Promise<void> => {
  for (let round = 0; round < 6; round += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
};

interface Setup {
  readonly host: MemoryPlatformServices;
  readonly el: HTMLElement;
  readonly opened: AnyDocument[];
  readonly layout: ReturnType<typeof createLayoutModel>;
  readonly tabs: ReturnType<typeof createTabs>;
  readonly tree: ReturnType<typeof createProjectTree>;
  readonly workspace: ReturnType<typeof createDocumentWorkspace>;
  readonly editorSlot: () => HTMLElement | null;
  readonly openPaths: string[];
  readonly packageCalls: string[];
  readonly publishCalls: string[];
}

async function setup(capabilities: readonly ("folderWrite" | "fileWatch" | "openExternal")[] = ["folderWrite", "openExternal"]): Promise<Setup> {
  document.body.replaceChildren();
  const host = createMemoryPlatformServices({ files: FILES, capabilities });
  const workspace = createDocumentWorkspace({ projectId: "memory-project", services: host });
  const tree = createProjectTree({ services: host, workspace });
  const tabs = createTabs(workspace);
  const layout = createLayoutModel([
    { id: "files", title: "Files", side: "left", visible: true, size: 240, minSize: 120, maxSize: 480 },
    { id: "game", title: "Game", side: "left", visible: false, size: 240, minSize: 120, maxSize: 480 },
  ]);
  const el = document.createElement("div");
  document.body.append(el);
  const opened: AnyDocument[] = [];
  const openPaths: string[] = [];
  let slot: HTMLElement | null = null;
  const packageCalls: string[] = [];
  const publishCalls: string[] = [];
  await act(() => {
    mountShell(el, {
      layout,
      tabs,
      tree,
      projectLayout: { projectFolder: "" },
      fs: host.fs,
      canWriteFolder: capabilities.includes("folderWrite"),
      onOpened: (result) => {
        if (result.via === "document") {
          opened.push(result.document);
          tabs.open(result.document);
        }
      },
      onOpenPath: (path) => {
        openPaths.push(path);
        void tree.open(path).then((result) => {
          if (result.ok && result.via === "document") tabs.open(result.document);
        });
      },
      onPackage: async (mainPath, version) => {
        packageCalls.push(`${mainPath}@${version}`);
        return {
          ok: true,
          prepared: {
            package: { fileName: "game.tpk", bytes: new Uint8Array([1]) },
            descriptor: { fileName: "game.tpk.json", bytes: new Uint8Array([2]) },
            includedFiles: ["Main/example.gam"],
            excludedFiles: ["Saved/save.sav"],
          },
        };
      },
      onPublish: async (mainPath) => {
        publishCalls.push(mainPath);
        return { ok: true, destination: "Build/game.tpk" };
      },
      onDownload: async () => ({ ok: true }),
      onEditorElement: (element) => { slot = element; },
    });
  });
  await settle();
  return { host, el, opened, layout, tabs, tree, workspace, editorSlot: () => slot, openPaths, packageCalls, publishCalls };
}

const key = async (target: Element, name: string, init: KeyboardEventInit = {}): Promise<void> => {
  await act(() => { target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init })); });
  await settle();
};
const row = (el: HTMLElement, name: string): HTMLElement => {
  const found = [...el.querySelectorAll<HTMLElement>('[role="treeitem"]')].find((node) => node.textContent?.replace(/^[▸▾] /, "").trim() === name);
  if (found === undefined) throw new Error(`no row ${name}: ${[...el.querySelectorAll('[role="treeitem"]')].map((node) => node.textContent).join(", ")}`);
  return found;
};
const button = (el: HTMLElement, label: string): HTMLButtonElement => {
  const found = [...el.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === label || node.getAttribute("aria-label") === label);
  if (found === undefined) throw new Error(`no button ${label}`);
  return found;
};
const click = async (target: Element): Promise<void> => {
  await act(() => { (target as HTMLElement).click(); });
  await settle();
};

test("the Files panel lists the project, is one tab stop, and moves, expands and opens with the keyboard", async () => {
  const s = await setup();
  equal(s.el.querySelector('[role="tree"]')?.getAttribute("aria-label"), "Project files");
  const tabStops = s.el.querySelectorAll('[role="treeitem"][tabindex="0"]');
  equal(tabStops.length, 1, "one row is in the tab order");
  const boards = row(s.el, "Boards");
  equal(boards.getAttribute("aria-expanded"), "false");
  await click(boards);
  await key(boards, "ArrowRight");
  equal(row(s.el, "Boards").getAttribute("aria-expanded"), "true");
  await key(row(s.el, "Boards"), "ArrowDown");
  equal(document.activeElement, row(s.el, "caves"), "Down moves to the next row and focuses it");
  await key(row(s.el, "caves"), "ArrowLeft");
  equal(document.activeElement, row(s.el, "Boards"), "Left on a closed folder goes to its parent");
  await key(row(s.el, "Boards"), "End");
  equal(document.activeElement, row(s.el, "Misc"));
  await key(row(s.el, "Boards"), "Home");

  await key(row(s.el, "Boards"), "ArrowRight");
  await key(row(s.el, "Boards"), "ArrowDown");
  await key(row(s.el, "caves"), "ArrowDown");
  equal(document.activeElement, row(s.el, "village.brd"));
  await key(row(s.el, "village.brd"), "Enter");
  equal(s.opened.length, 1);
  equal(s.opened[0]?.kind, "board");
  equal(s.tabs.getSnapshot().tabs.length, 1);
  match(row(s.el, "village.brd").getAttribute("aria-label") ?? "", /board editor, open$/);
});

test("rows say what opening them does, including a file this host cannot open", async () => {
  const withOs = await setup(["folderWrite", "openExternal"]);
  await click(row(withOs.el, "Misc"));
  await key(row(withOs.el, "Misc"), "Enter");
  match(row(withOs.el, "readme.txt").getAttribute("aria-label") ?? "", /opens in another application/);
  await key(row(withOs.el, "readme.txt"), "Enter");
  deepEqual(withOs.host.openedExternally, ["Misc/readme.txt"]);

  const plain = await setup(["folderWrite"]);
  await click(row(plain.el, "Misc"));
  await key(row(plain.el, "Misc"), "Enter");
  match(row(plain.el, "readme.txt").getAttribute("aria-label") ?? "", /cannot be opened here/);
  await key(row(plain.el, "readme.txt"), "Enter");
  const alert = plain.el.querySelector(".tkr-files-message");
  equal(alert?.getAttribute("role"), "alert");
  match(alert?.textContent ?? "", /this host cannot open it in another application/);
  deepEqual(plain.host.openedExternally, []);
});

test("rename and delete work from F2 and Delete and from their buttons, refuse an open document, and delete asks", async () => {
  const s = await setup();
  await click(row(s.el, "Boards"));
  await key(row(s.el, "Boards"), "ArrowRight");
  await click(row(s.el, "village.brd"));
  await key(row(s.el, "village.brd"), "Enter");
  await key(row(s.el, "village.brd"), "F2");
  const field = s.el.querySelector<HTMLInputElement>('.tkr-files-rename-row input');
  ok(field !== null && field.value === "village.brd", "F2 opens the rename field with the current name");
  await act(() => { field.value = "town.brd"; field.dispatchEvent(new Event("input", { bubbles: true })); });
  await key(field, "Enter");
  match(s.el.querySelector(".tkr-files-message")?.textContent ?? "", /is open\. Close it before renaming/);
  notEqual(s.host.bytesOf("Boards/village.brd"), undefined, "nothing was renamed under an open document");
  await key(field, "Escape");
  equal(s.el.querySelector(".tkr-files-rename-row"), null);

  await key(row(s.el, "village.brd"), "Delete");
  match(s.el.querySelector(".tkr-files-message")?.textContent ?? "", /Close it before deleting/);
  equal(s.host.questions.length, 0);

  await s.tabs.close(s.opened[0]!.identity.key);
  await settle();
  await click(row(s.el, "village.brd"));
  await click(button(s.el, "Rename…"));
  const again = s.el.querySelector<HTMLInputElement>('.tkr-files-rename-row input')!;
  await act(() => { again.value = "town.brd"; again.dispatchEvent(new Event("input", { bubbles: true })); });
  await click(button(s.el, "Rename"));
  ok(s.host.bytesOf("Boards/town.brd") !== undefined);
  equal(s.host.bytesOf("Boards/village.brd"), undefined);
  s.host.answerQuestions("delete");
  await key(row(s.el, "town.brd"), "Delete");
  equal(s.host.bytesOf("Boards/town.brd"), undefined);
  match(s.host.questions[0]?.message ?? "", /Delete Boards\/town\.brd\?/);
});

test("the Game panel groups files by what they are, offers only files with an editor, and opens the same document as Files", async () => {
  const s = await setup();
  await click(button(s.el, "Game"));
  const group = s.el.querySelector('[role="group"][aria-label="Boards"]');
  ok(group !== null);
  const files = [...group.querySelectorAll<HTMLButtonElement>("button")].map((node) => node.textContent);
  deepEqual(files, ["caves/mine.brd", "village.brd"]);
  const animations = s.el.querySelector('[role="group"][aria-label="Animations"]');
  equal(animations?.querySelector("button")?.getAttribute("aria-disabled"), "true");
  match(animations?.querySelector("button")?.getAttribute("aria-label") ?? "", /no editor for this file yet/);

  await click(button(s.el, "Boards/village.brd"));
  deepEqual(s.openPaths, ["Boards/village.brd"]);
  equal(s.tabs.getSnapshot().tabs.length, 1);
  await click(row(s.el, "Boards"));
  await key(row(s.el, "Boards"), "ArrowRight");
  await key(row(s.el, "Boards"), "ArrowDown");
  await key(row(s.el, "caves"), "ArrowDown");
  await key(row(s.el, "village.brd"), "Enter");
  equal(s.tabs.getSnapshot().tabs.length, 1, "the same document from the other route is the same tab");
  equal(s.workspace.documents().length, 1);
  await key(button(s.el, "Boards/village.brd"), "ArrowDown");
  equal(document.activeElement?.getAttribute("aria-label"), "Misc/readme.txt, no editor for this file yet", "arrow keys move on through the groups");
  await key(document.activeElement ?? s.el, "ArrowDown");
  equal(document.activeElement?.getAttribute("aria-label"), "Misc/readme.txt, no editor for this file yet", "and stop at the last file");
});

test("tabs show unsaved work, move with the arrow keys, and a refused close says why and keeps the document", async () => {
  const s = await setup();
  await click(row(s.el, "Boards"));
  await key(row(s.el, "Boards"), "ArrowRight");
  await click(row(s.el, "village.brd"));
  await key(row(s.el, "village.brd"), "Enter");
  await key(row(s.el, "caves"), "ArrowUp");
  await key(row(s.el, "Boards"), "ArrowRight");
  await key(row(s.el, "caves"), "Enter");
  await key(row(s.el, "mine.brd"), "Enter");
  const tabs = [...s.el.querySelectorAll<HTMLElement>('[role="tab"]')];
  equal(tabs.length, 2);
  equal(tabs.filter((tab) => tab.getAttribute("aria-selected") === "true").length, 1);
  await key(s.el.querySelector('[role="tab"][aria-selected="true"]')!, "ArrowLeft");
  equal(s.el.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute("aria-label"), "Boards/village.brd");
  equal(document.activeElement?.getAttribute("aria-label"), "Boards/village.brd", "focus follows the tab");

  ok(s.opened[0]!.apply({ type: "set-tile", layer: 0, x: 0, y: 0, tile: "village.tst2" }).ok);
  await settle();
  match(s.el.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute("aria-label") ?? "", /unsaved changes$/);
  await key(s.el.querySelector('[role="tab"][aria-selected="true"]')!, "Delete");
  match(s.el.querySelector(".tkr-tabs-notice")?.textContent ?? "", /was not closed/);
  equal(s.tabs.getSnapshot().tabs.length, 2, "the unsaved document stays open");
});

test("panels show, hide and resize from buttons and the keyboard, and hiding keeps the document", async () => {
  const s = await setup();
  const files = (): HTMLElement | null => s.el.querySelector("#tkr-panel-files");
  ok(files() !== null);
  equal(s.el.querySelector("#tkr-panel-game"), null, "a hidden panel draws nothing");
  const toggle = button(s.el, "Game");
  equal(toggle.getAttribute("aria-pressed"), "false");
  await click(toggle);
  ok(s.el.querySelector("#tkr-panel-game") !== null);
  equal(button(s.el, "Game").getAttribute("aria-pressed"), "true");

  const separator = s.el.querySelector<HTMLElement>('[role="separator"][aria-label="Resize Files"]')!;
  equal(separator.getAttribute("aria-valuenow"), "240");
  ok(files()?.classList.contains("tkr-size-15"), "the size is a class (240 = 15 × 16), not a style attribute");
  await key(separator, "ArrowRight");
  equal(s.el.querySelector('[role="separator"][aria-label="Resize Files"]')?.getAttribute("aria-valuenow"), "256");
  ok(files()?.classList.contains("tkr-size-16"));
  const resized = s.el.querySelector<HTMLElement>('[role="separator"][aria-label="Resize Files"]')!;
  await key(resized, "ArrowLeft", { shiftKey: true });
  equal(s.el.querySelector('[role="separator"][aria-label="Resize Files"]')?.getAttribute("aria-valuenow"), "192");
  for (let step = 0; step < 20; step += 1) await key(s.el.querySelector('[role="separator"][aria-label="Resize Files"]')!, "ArrowLeft", { shiftKey: true });
  equal(s.el.querySelector('[role="separator"][aria-label="Resize Files"]')?.getAttribute("aria-valuenow"), "128", "the size stops at the panel's minimum (120 rounds up to a whole step)");

  await click(row(s.el, "Boards"));
  await key(row(s.el, "Boards"), "ArrowRight");
  await click(row(s.el, "village.brd"));
  await key(row(s.el, "village.brd"), "Enter");
  ok(s.opened[0]!.apply({ type: "set-tile", layer: 0, x: 0, y: 0, tile: "village.tst2" }).ok);
  await key(s.el.querySelector('[role="separator"][aria-label="Resize Files"]')!, "Enter");
  equal(files(), null, "Enter on the separator hides the panel");
  equal(s.workspace.documents().length, 1, "hiding a panel leaves the document open");
  equal(s.opened[0]!.getSnapshot().dirty, true, "and its unsaved edit untouched");
  await click(button(s.el, "Files"));
  ok(files() !== null);
  ok(s.editorSlot() !== null, "the editor slot is offered to the host");
});
test("package preflight displays its inventory and requires review before publishing", async () => {
  const s = await setup();
  await click(button(s.el, "Package game…"));
  await settle();
  const version = s.el.querySelector<HTMLInputElement>('input[type="text"][maxlength="128"]');
  ok(version);
  await act(() => { version.value = "1.2.3"; version.dispatchEvent(new Event("input", { bubbles: true })); });
  await click(button(s.el, "Prepare package"));
  await settle();
  deepEqual(s.packageCalls, ["Main/example.gam@1.2.3"]);
  deepEqual(s.publishCalls, []);
  const save = button(s.el, "Save package and descriptor…");
  equal(save.disabled, true, "publication waits for explicit inventory review");
  const details = s.el.querySelector("details");
  match(s.el.textContent ?? "", /Package output: game\.tpk; install descriptor: game\.tpk\.json/);
  match(s.el.textContent ?? "", /saved project files from the time it completed/);
  ok(details);
  await click(details.querySelector("summary")!);
  match(details.textContent ?? "", /Main\/example\.gam/);
  match(details.textContent ?? "", /Saved\/save\.sav/);
  const reviewed = s.el.querySelector<HTMLInputElement>('input[type="checkbox"]');
  ok(reviewed);
  await act(() => { reviewed.checked = true; reviewed.dispatchEvent(new Event("change", { bubbles: true })); });
  await click(save);
  deepEqual(s.publishCalls, ["Main/example.gam"]);
  match(s.el.querySelector('[role="status"]')?.textContent ?? "", /saved to Build\/game\.tpk/);
});


test("the shell writes no style attribute and no inline handler attribute (strict CSP, ADR 0025 decision 6)", async () => {
  const s = await setup();
  await click(button(s.el, "Game"));
  await click(row(s.el, "Boards"));
  for (const node of [s.el, ...s.el.querySelectorAll("*")]) {
    for (const name of node.getAttributeNames()) {
      notEqual(name, "style", `<${node.tagName.toLowerCase()}> has a style attribute`);
      ok(!name.startsWith("on"), `<${node.tagName.toLowerCase()}> has the handler attribute ${name}`);
    }
  }
});

function pickerSetup(host: MemoryPlatformServices, extensions: readonly string[] = [".png"]) {
  const picker = createAssetPicker({ services: host, layout: { projectFolder: "" }, kind: "bitmaps", extensions, field: "the hero's picture" });
  const el = document.createElement("div");
  document.body.replaceChildren(el);
  const done: { chosen: boolean; reference?: string }[] = [];
  void act(() => { mountAssetPicker(el, { picker, title: "Picture", onDone: (outcome) => { done.push(outcome); } }); });
  return { picker, el, done };
}

test("the picker lists the folder and its folders, confirms before it chooses, and Escape leaves the field as it was", async () => {
  const host = createMemoryPlatformServices({ files: { "Bitmap/a.png": new Uint8Array([1]), "Bitmap/sub/b.png": new Uint8Array([2]), "Bitmap/x.txt": new Uint8Array([3]) } });
  const { el, done, picker } = pickerSetup(host);
  await settle();
  const options = [...el.querySelectorAll('[role="option"]')].map((node) => node.textContent);
  deepEqual(options, ["a.png", "sub\\b.png"]);
  equal(el.querySelectorAll('[role="option"][tabindex="0"]').length, 1);
  await key(el.querySelector('[role="option"]')!, "ArrowDown");
  equal(document.activeElement?.textContent, "sub\\b.png");
  equal(picker.getSnapshot().selected, "sub\\b.png");
  equal(button(el, "Use sub\\b.png…").disabled, false);
  host.answerQuestions("cancel");
  await click(button(el, "Use sub\\b.png…"));
  deepEqual(done, [], "cancelling the confirmation chooses nothing and leaves the picker open");
  host.answerQuestions("use");
  await key(document.activeElement ?? el, "Enter");
  deepEqual(done, [{ chosen: true, reference: "sub\\b.png" }]);

  const second = pickerSetup(createMemoryPlatformServices({ files: { "Bitmap/a.png": new Uint8Array([1]) } }));
  await settle();
  await key(second.el.querySelector("section")!, "Escape");
  deepEqual(second.done, [{ chosen: false }], "Escape closes without choosing");
});

test("the picker copies a file in from outside after agreement, or explains why this host cannot", async () => {
  const host = createMemoryPlatformServices({ capabilities: ["folderWrite", "pickFile"] });
  const { el, done } = pickerSetup(host);
  await settle();
  match(el.querySelector(".tkr-picker-empty")?.textContent ?? "", /no matching files/);
  host.answerFilePicks({ name: "hero.png", bytes: new Uint8Array([9, 9]) });
  host.answerQuestions("copy");
  const subfolder = el.querySelector<HTMLInputElement>('input[type="text"]')!;
  await act(() => { subfolder.value = "people"; subfolder.dispatchEvent(new Event("input", { bubbles: true })); });
  await click(button(el, "Choose a file from outside the project…"));
  deepEqual(done, [{ chosen: true, reference: "people\\hero.png" }]);
  deepEqual(host.bytesOf("Bitmap/people/hero.png"), new Uint8Array([9, 9]));

  const none = createMemoryPlatformServices({ capabilities: ["folderWrite"] });
  const closed = pickerSetup(none);
  await settle();
  const outside = button(closed.el, "Choose a file from outside the project…");
  equal(outside.disabled, true);
  match(closed.el.querySelector(".tkr-picker-host-note")?.textContent ?? "", /cannot choose a file from outside the project/);
  equal(outside.getAttribute("aria-describedby"), closed.el.querySelector(".tkr-picker-host-note")?.id, "the button points at the explanation");
});
