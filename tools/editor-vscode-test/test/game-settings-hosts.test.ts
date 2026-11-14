// Story 11.6 (#1704): in every host the docs example game's main file is opened, a representative field of every
// T-10 to T-14 category is staged through the view, Cancel is shown to leave the file alone, Apply makes the document
// dirty without writing, Save writes exactly the bytes the model makes of the same changes (unknown trailing data kept),
// the reopened view shows the values, and the real engine boots the saved project onto the board the settings chose.
import { deepEqual, equal, ok } from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createDocumentIdentity, createMainDocument, type MainSettingsChanges } from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { engineBoot } from "../conformance/engine-view.ts";
import { GAME } from "../conformance/suite.ts";
import { settle, type Act } from "../conformance/view.ts";

const gameRoot = fileURLToPath(new URL("../../../docs/spec/examples/game/", import.meta.url));
const ascii = (text: string): number[] => Array.from(text, (char) => char.charCodeAt(0));
/** Unknown data after the last legacy row: a package list naming one package, then bytes no reader knows (`#tkr-package-list-extension`). */
const TRAILING = Uint8Array.from([...ascii("TKRPLUG"), 0, 1, 0, ...ascii("stock_battle"), 0, 0xde, 0xad, 0xbe, 0xef]);
const OPAQUE = Uint8Array.from([0xde, 0xad, 0xbe, 0xef]);
const gam = Uint8Array.from([...readFileSync(join(gameRoot, "Main", "example.gam")), ...TRAILING]);

/** The example game's project files (not its main file or saves), plus a second board for the settings to choose. */
function projectFiles(): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const project = join(gameRoot, "Game");
  for (const entry of readdirSync(project, { recursive: true, encoding: "utf8" })) {
    const full = join(project, entry);
    if (statSync(full).isFile()) files[`Game/${entry.split("\\").join("/")}`] = new Uint8Array(readFileSync(full));
  }
  files["Game/Example/Boards/forest.brd"] = files["Game/Example/Boards/village.brd"]!;
  return files;
}
const FILES = projectFiles();

/** One representative change in every category, as the view stages them below. */
const CHANGES: MainSettingsChanges = {
  useJoystick: false,
  movementScanCodes: [0x20, 0, 0xd0, 0, 0xcb, 0, 0xc8, 0],
  defaultSoundFont: "media/gm.sf2",
  initBoard: "forest.brd",
  pathfindHeuristic: 3,
  gameSpeed: 2,
  fightType: 1,
  chances: 7,
  resolution: 1,
  showFpsInTitle: true,
  packages: ["stock_battle", "stock_menu"],
};

/** The bytes the model makes of `CHANGES`: the oracle for what every host must write. */
function expectedBytes(): Uint8Array {
  const host = createMemoryPlatformServices({ files: { [GAME]: gam } });
  const opened = createMainDocument(host.fs, createDocumentIdentity("oracle", GAME), gam);
  ok(opened.ok);
  const applied = opened.document.apply({ type: "apply-settings", changes: CHANGES });
  ok(applied.ok, applied.ok ? "" : applied.rejection.message);
  return opened.document.serialize();
}

interface Tab {
  readonly element: HTMLElement;
  workbenchDirty(): boolean;
  close(): Promise<void>;
}

interface Host {
  open(path: string): Promise<Tab>;
  disk(path: string): Promise<Uint8Array | null>;
}

let act: Act;
let hosts: readonly { readonly name: string; readonly make: () => Host }[] = [];

before(async () => {
  GlobalRegistrator.register();
  // Preact and the hosts read the DOM when they are first evaluated, so they are imported once the shim is registered.
  const { act: preactAct } = await import("preact/test-utils");
  let queue: Promise<void> = Promise.resolve();
  act = (callback) => {
    const run = queue.then(() => preactAct(callback));
    queue = run.catch(() => undefined);
    return run;
  };
  const { createWebBoardProofHost } = await import("../conformance/web-host.ts");
  const { createVscodeBoardProofHost } = await import("../conformance/vscode-host.ts");
  hosts = [
    { name: "browser host", make: () => createWebBoardProofHost(gam, FILES, act) },
    { name: "VS Code desktop", make: () => createVscodeBoardProofHost(true, gam, FILES, act) },
    { name: "VS Code for the Web", make: () => createVscodeBoardProofHost(false, gam, FILES, act) },
  ];
});

after(() => GlobalRegistrator.unregister());

function control<Element extends HTMLElement = HTMLInputElement>(tab: Tab, label: string): Element {
  const found = [...tab.element.querySelectorAll("label")].find((node) => node.textContent === label);
  const element = found === undefined ? null : tab.element.ownerDocument.getElementById(found.getAttribute("for") ?? "");
  if (element === null) throw new Error(`no field labelled "${label}": ${tab.element.textContent}`);
  return element as Element;
}

function button(tab: Tab, label: string): HTMLButtonElement {
  const found = [...tab.element.querySelectorAll("button")].find((node) => node.textContent?.trim() === label);
  if (found === undefined) throw new Error(`no "${label}" button`);
  return found;
}

async function type(tab: Tab, label: string, text: string): Promise<void> {
  const field = control(tab, label);
  await act(() => {
    field.value = text;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function choose(tab: Tab, label: string, value: string | boolean): Promise<void> {
  const field = control<HTMLInputElement | HTMLSelectElement>(tab, label);
  await act(() => {
    if (typeof value === "boolean") (field as HTMLInputElement).checked = value;
    else field.value = value;
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function press(tab: Tab, label: string): Promise<void> {
  const target = button(tab, label);
  ok(!target.disabled, `"${label}" is enabled`);
  await act(() => { target.click(); });
  await settle(act);
}

const state = (tab: Tab): string => tab.element.querySelector(".tkr-settings-state")?.textContent ?? "";

for (const entry of ["browser host", "VS Code desktop", "VS Code for the Web"]) {
  describe(`game settings proof: ${entry}`, () => {
    test("every T-10 to T-14 category is edited, applied, saved and reopened, unknown data survives, and the engine boots it", async () => {
      document.body.replaceChildren();
      const host = hosts.find((candidate) => candidate.name === entry)!.make();
      const first = await host.open(GAME);
      await settle(act);

      // Cancel leaves the document and the file as they were.
      await type(first, "Start program", "other.prg");
      await press(first, "Cancel changes");
      equal(control(first, "Start program").value, "start.prg");
      equal(first.workbenchDirty(), false, "Cancel makes no edit");

      // T-10 project, T-11 startup, T-12 fighting, T-13 graphics, T-14 plugins.
      await choose(first, "Legacy joystick input", false);
      await act(() => { control(first, "East").dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD", key: "d", bubbles: true })); });
      await type(first, "Default SoundFont", "media/gm.sf2");
      await type(first, "Initial board", "forest.brd");
      await choose(first, "Default path-finding", "3");
      await type(first, "Game speed (−4 to +4)", "2");
      await choose(first, "Encounter type", "1");
      await type(first, "Encounter N", "7");
      await choose(first, "Resolution", "1");
      await choose(first, "Frames per second in the window bar", true);
      await type(first, "Package to add", "stock_menu");
      await press(first, "Add package");
      equal(first.workbenchDirty(), false, "staged settings are not edits");
      await press(first, "Apply changes");
      equal(first.workbenchDirty(), true, "Apply stages one document edit the host knows is unsaved");
      deepEqual(await host.disk(GAME), gam, "nothing is written before Save");

      await press(first, "Save");
      for (let round = 0; round < 200 && state(first) !== "All changes saved"; round += 1) await settle(act, 1);
      equal(state(first), "All changes saved");
      equal(first.workbenchDirty(), false);
      const saved = await host.disk(GAME);
      ok(saved !== null);
      deepEqual(saved, expectedBytes(), "the file holds exactly the model's bytes for those changes");
      deepEqual(saved.subarray(saved.length - OPAQUE.length), OPAQUE, "bytes no reader knows are still last");

      await first.close();
      await settle(act);
      const second = await host.open(GAME);
      await settle(act);
      equal(control(second, "Legacy joystick input").checked, false);
      equal(control(second, "East").value, "KeyD");
      equal(control(second, "Default SoundFont").value, "media/gm.sf2");
      equal(control(second, "Initial board").value, "forest.brd");
      equal(control<HTMLSelectElement>(second, "Default path-finding").value, "3");
      equal(control(second, "Encounter N").value, "7");
      equal(control<HTMLSelectElement>(second, "Resolution").value, "1");
      equal(control(second, "Frames per second in the window bar").checked, true);
      equal([...second.element.querySelectorAll(".tkr-settings-packages li span")].map((node) => node.textContent).join(","), "stock_battle,stock_menu");
      equal(second.workbenchDirty(), false);
      await second.close();

      const boot = engineBoot({ ...FILES, [GAME]: saved }, GAME, 40, 10);
      equal(boot.board, "game/example/boards/forest.brd", `the engine enters the board the settings chose: ${boot.diagnostics.join("; ")}`);
      equal(boot.stage, "running");
    });
  });
}
