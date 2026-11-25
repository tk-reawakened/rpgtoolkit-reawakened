import { deepEqual, equal, match, ok } from "node:assert/strict";
import { after, before, test } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { platformError, platformOk, type SettingsService, type SettingValue } from "@tk-reawakened/platform-services";
import type { FirstBoardHelpSurface, FirstBoardTutorialProps, ViewHandle } from "../src/index.ts";
import type { act as TestAct } from "preact/test-utils";
import type * as EditorUi from "../src/index.ts";

let ui: typeof EditorUi;
let act: typeof TestAct;

before(async () => {
  GlobalRegistrator.register();
  ({ act } = await import("preact/test-utils"));
  ui = await import("@tk-reawakened/editor-ui");
});

after(() => GlobalRegistrator.unregister());

function fixture(options: Partial<Pick<FirstBoardTutorialProps, "host" | "canWrite" | "canRun" | "autofocus">> = {}) {
  const entry = document.createElement("button");
  const el = document.createElement("div");
  document.body.replaceChildren(entry, el);
  entry.focus();
  const values = new Map<string, SettingValue | null>();
  const writes: [string, SettingValue | null][] = [];
  let closeCount = 0;
  let refused = false;
  let readRefused = false;
  let view: ViewHandle;
  const settings: Pick<SettingsService, "get" | "set"> = {
    async get(layer, id) {
      equal(layer, "user");
      return readRefused ? platformError("unavailable", "settings locked") : platformOk(values.get(id) ?? null);
    },
    async set(layer, id, value) {
      equal(layer, "user");
      if (refused) return platformError("unavailable", "settings locked");
      writes.push([id, value]);
      values.set(id, value);
      return platformOk(undefined);
    },
  };
  return {
    entry, el, values, writes, settings,
    refuseWrites() { refused = true; },
    refuseReads() { readRefused = true; },
    closed: () => closeCount,
    async open(surface: FirstBoardHelpSurface = "guide") {
      await act(async () => {
        view = ui.mountFirstBoardTutorial(el, {
          host: "browser", canWrite: true, canRun: true, ...options, surface, settings,
          onClose: () => { view.dispose(); closeCount++; entry.focus(); },
        });
      });
    },
    close() { return act(() => view.dispose()); },
  };
}

type Fixture = ReturnType<typeof fixture>;
function button(f: Fixture, label: string): HTMLButtonElement {
  const found = [...f.el.querySelectorAll("button")].find((item) => item.textContent === label);
  ok(found, `button: ${label}`);
  return found;
}
const heading = (f: Fixture) => f.el.querySelector("h2");
const press = (f: Fixture, label: string) => act(async () => { button(f, label).click(); });

const STEP = "onboarding.firstBoard.step";
const TIPS = "editor.showTips";

test("the two host entry commands open different surfaces", () => {
  const opened: FirstBoardHelpSurface[] = [];
  const commands = ui.firstBoardHelpCommands((surface) => opened.push(surface));
  deepEqual(commands.map(({ id, category, label }) => ({ id, category, label })), [
    { id: "help.firstBoard", category: "Help", label: "First board tutorial" },
    { id: "help.dailyTip", category: "Help", label: "Tip of the day" },
  ]);
  for (const command of commands) command.run();
  deepEqual(opened, ["guide", "tip"]);
});

test("keyboard escape closes, returns focus, and the guide resumes until reset", async () => {
  const f = fixture();
  await f.open();
  match(heading(f)?.textContent ?? "", /Step 1 of 9: Create a project/);
  equal(document.activeElement, heading(f));
  equal(button(f, "Previous step").disabled, true);
  await press(f, "Next step");
  match(heading(f)?.textContent ?? "", /Step 2 of 9: Find Game and Files/);
  equal(document.activeElement, heading(f));
  await act(() => { heading(f)?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  equal(f.closed(), 1);
  equal(document.activeElement, f.entry);
  deepEqual(f.writes, [[STEP, 2]]);
  await f.open();
  match(heading(f)?.textContent ?? "", /Step 2 of 9/);
  await press(f, "Restart tutorial");
  match(heading(f)?.textContent ?? "", /Step 1 of 9/);
  deepEqual(f.writes, [[STEP, 2], [STEP, 1]]);
  await f.close();
});

test("daily tip uses the existing preference without changing progress or moving startup focus", async () => {
  const f = fixture({ autofocus: false });
  f.values.set(STEP, 6);
  equal(await ui.readFirstBoardTipsEnabled(f.settings), true);
  await f.open("tip");
  equal(document.activeElement, f.entry);
  const toggle = f.el.querySelector<HTMLInputElement>("input[type=checkbox]");
  ok(toggle?.checked);
  await act(async () => { toggle.click(); });
  equal(toggle.checked, false);
  equal(await ui.readFirstBoardTipsEnabled(f.settings), false);
  equal(f.values.get(STEP), 6);
  deepEqual(f.writes, [[TIPS, false]]);
  await f.close();
  await f.open("tip");
  equal(f.el.querySelector<HTMLInputElement>("input[type=checkbox]")?.checked, false, "manual help is available with startup tips off");
  await f.close();
});

test("a preference write refusal keeps the old saved step and tip value", async () => {
  const f = fixture();
  f.values.set(STEP, 3);
  f.refuseWrites();
  await f.open();
  await press(f, "Next step");
  match(f.el.querySelector('[role="alert"]')?.textContent ?? "", /Could not save your preference: settings locked/);
  match(heading(f)?.textContent ?? "", /Step 3 of 9/);
  await f.close();
  await f.open("tip");
  const checkbox = f.el.querySelector<HTMLInputElement>("input[type=checkbox]");
  ok(checkbox);
  await act(async () => { checkbox.click(); });
  equal(checkbox.checked, true);
  match(f.el.querySelector('[role="alert"]')?.textContent ?? "", /settings locked/);
  deepEqual(f.writes, []);
  await f.close();
});

test("unsupported launch and write providers are reported without claiming success", async () => {
  const f = fixture({ host: "vscode", canWrite: false, canRun: false });
  f.values.set(STEP, 1);
  await f.open();
  match(f.el.textContent ?? "", /RPG Toolkit: New project/);
  match(f.el.querySelector('[role="status"]')?.textContent ?? "", /needs a writable project folder/);
  await f.close();
  f.values.set(STEP, 9);
  await f.open();
  match(f.el.textContent ?? "", /Run and Debug/);
  match(f.el.querySelector('[role="status"]')?.textContent ?? "", /No player is available/);
  equal(button(f, "Next step").disabled, true);
  deepEqual(f.writes, []);
  await f.close();
});

test("a preference read refusal leaves navigation inert but never traps focus", async () => {
  const f = fixture();
  f.refuseReads();
  await f.open();
  match(f.el.querySelector('[role="alert"]')?.textContent ?? "", /Could not read your tutorial preferences/);
  equal(button(f, "Next step").disabled, true);
  await press(f, "Close help");
  equal(document.activeElement, f.entry);
});
