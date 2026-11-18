import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  CONNECTED_BOARD,
  CONNECTED_ITEM,
  connectedAuthoringProofFiles,
  runConnectedAuthoringProof,
} from "@tk-reawakened/editor-vscode-test/connected-authoring-proof";

interface ProofWindow extends Window {
  __tkrPickerReady?: true;
  __tkrTestFolder?: FileSystemDirectoryHandle;
}

type PickerInput = { readonly path: string; readonly bytes: readonly number[] };

async function installFolderPicker(page: Page, files: readonly PickerInput[]): Promise<void> {
  const folderName = `TkrConnected-${randomUUID()}`;
  await page.addInitScript(async ({ files: inputs, folderName: name }: { readonly files: readonly PickerInput[]; readonly folderName: string }) => {
    const root = await navigator.storage.getDirectory().then((storage) => storage.getDirectoryHandle(name, { create: true }));
    for (const input of inputs) {
      const parts = input.path.split("/");
      let parent = root;
      for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part, { create: true });
      const file = await parent.getFileHandle(parts.at(-1)!, { create: true });
      const writable = await file.createWritable();
      await writable.write(new Uint8Array(input.bytes));
      await writable.close();
    }
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => root });
    Reflect.set(window, "__tkrPickerReady", true);
    (window as ProofWindow).__tkrTestFolder = root;
  }, { files, folderName });
}

test.use({ actionTimeout: 10_000 });

test("browser connected authoring follows shared graphics and local programs into saved board and game runs", async ({ page }) => {
  test.setTimeout(120_000);
  const root = fileURLToPath(new URL("../../../docs/spec/examples/game", import.meta.url));
  const files: PickerInput[] = [];
  const collect = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) collect(path);
      else files.push({ path: relative(root, path).replaceAll("\\", "/"), bytes: Array.from(readFileSync(path)) });
    }
  };
  collect(root);
  for (const file of connectedAuthoringProofFiles()) files.push({ path: file.path, bytes: [...file.bytes] });
  await installFolderPicker(page, files);
  await page.goto("/tools/browser/editor-web/index.html");
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "__tkrPickerReady"))).toBe(true);
  await page.getByRole("button", { name: "Open project folder", exact: true }).click();
  await expect(page.getByLabel("Game title")).toBeVisible();

  const pane = () => page.locator(".tkr-editor-pane:not([hidden])");
  const openFile = async (path: string): Promise<void> => {
    const tab = page.getByRole("tab", { name: new RegExp(`^${path.replaceAll(".", "\\.")}(?:, unsaved changes)?$`) });
    if (await tab.count()) {
      await tab.first().click();
    } else {
      for (const folder of path.split("/").slice(0, -1)) {
        const row = page.getByRole("treeitem", { name: new RegExp(`^${folder}, folder`) });
        if ((await row.getAttribute("aria-expanded")) !== "true") await row.dblclick();
      }
      await page.getByRole("treeitem", { name: new RegExp(`^${path.split("/").at(-1)!.replaceAll(".", "\\.")},`) }).dblclick();
    }
    await expect(tab).toHaveAttribute("aria-selected", "true");
  };
  const player = async () => {
    let found;
    await expect.poll(async () => {
      for (const frame of page.frames()) {
        if (await frame.locator("#screen").count().catch(() => 0) > 0
          && await frame.evaluate(() => Reflect.get(window, "__session") !== undefined).catch(() => false)) {
          found = frame;
          return true;
        }
      }
      return false;
    }, { timeout: 30_000 }).toBe(true);
    if (found === undefined) throw new Error("Connected-authoring player frame was not found");
    return found;
  };
  let boardSetupSaved = false;
  await runConnectedAuthoringProof({
    page,
    launchSetupPath: ".tkr/launch.json",
    read: async (path) => new Uint8Array(await page.evaluate(async (path) => {
      let folder = (window as ProofWindow).__tkrTestFolder!;
      for (const name of path.split("/").slice(0, -1)) folder = await folder.getDirectoryHandle(name);
      return [...new Uint8Array(await (await (await folder.getFileHandle(path.split("/").at(-1)!)).getFile()).arrayBuffer())];
    }, path)),
    openBoard: async (path) => {
      await openFile(path);
      const board = pane().locator(".tkr-board");
      await expect(board).toBeVisible();
      return board;
    },
    save: async () => {
      await page.getByRole("button", { name: "Save active editor", exact: true }).click();
      await expect(page.getByRole("tab", { selected: true })).not.toHaveAccessibleName(/unsaved changes/);
    },
    cancelAssetPicker: async () => {
      const picker = page.getByRole("dialog").last();
      await expect(picker).toBeVisible();
      await picker.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(picker).toBeHidden();
    },
    chooseAsset: async (reference) => {
      const picker = page.getByRole("dialog").last();
      await expect(picker).toBeVisible();
      await picker.getByRole("option", { name: reference, exact: true }).click();
      await picker.getByRole("button", { name: `Use ${reference}…`, exact: true }).click();
      await page.getByRole("button", { name: "Use it", exact: true }).click();
      await expect(picker).toBeHidden();
    },
    spriteEditor: async () => {
      const sprite = pane().getByRole("region", { name: "item sprite graphics", exact: true });
      await expect(sprite).toBeVisible();
      return sprite;
    },
    animationEditor: async () => {
      const animation = pane().locator(".tkr-animation-editor");
      await expect(animation).toBeVisible();
      return animation;
    },
    bitmapEditor: async () => {
      const bitmap = pane().locator(".tkr-bitmap");
      await expect(bitmap).toBeVisible();
      return bitmap;
    },
    expectSingleSharedItemDocument: async () => {
      await expect(page.getByRole("tab", { name: CONNECTED_ITEM, exact: true })).toHaveCount(1);
    },
    openDocument: openFile,
    revealRun: async () => {
      await page.getByRole("tab", { name: "Running game", exact: true }).click();
      await expect(page.locator('iframe[title="Running game"]')).toBeVisible();
    },
    returnToAnimation: async () => {
      await page.getByRole("button", { name: "Return to board", exact: true }).click();
      const animation = pane().locator(".tkr-animation-editor");
      await expect(animation).toBeVisible();
      return animation;
    },
    returnToBoard: async () => {
      const board = pane().locator(".tkr-board");
      // Board → item → ANM → TBM is three ordinary one-hop source visits.
      for (let hop = 0; hop < 3; hop += 1) {
        await page.getByRole("button", { name: "Return to board", exact: true }).click();
        await page.waitForTimeout(80);
        if (await board.isVisible()) return board;
      }
      throw new Error("The three-source visit chain did not return to its original board");
    },
    expectProgram: async (path, text) => {
      await expect(page.getByRole("tab", { name: path, exact: true })).toHaveAttribute("aria-selected", "true");
      await expect(pane().locator(".monaco-editor")).toContainText(text);
    },
    writeProgram: async (path, text, before) => {
      await openFile(path);
      const editor = pane().locator(".monaco-editor");
      await expect(editor.locator(".view-lines")).toBeVisible();
      await editor.locator(".view-line").first().click();
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.insertText(text);
      await page.keyboard.press("ControlOrMeta+Z");
      await expect(editor).toContainText(before.split("\n")[0]!);
      await page.keyboard.press("ControlOrMeta+Shift+Z");
      await expect(editor).toContainText(text.split("\n")[0]!);
      await page.getByRole("button", { name: "Save active editor", exact: true }).click();
      await expect(page.getByRole("tab", { name: path, exact: true })).toHaveAttribute("aria-selected", "true");
    },
    runSavedBoardSetup: async () => {
      const run = page.getByRole("group", { name: "Run", exact: true });
      if (!boardSetupSaved) {
        await run.getByRole("button", { name: "New run setup", exact: true }).click();
        const form = page.getByRole("dialog", { name: "New run setup", exact: true });
        await form.getByRole("tab", { name: "Test board", exact: true }).click();
        await form.getByRole("combobox", { name: "Board", exact: true }).selectOption(CONNECTED_BOARD);
        await form.getByRole("listbox", { name: "Party", exact: true }).selectOption("Game/Example/Chrs/ada.tem");
        await form.getByRole("spinbutton", { name: "Column", exact: true }).fill("1");
        await form.getByRole("spinbutton", { name: "Row", exact: true }).fill("1");
        await form.getByRole("textbox", { name: "Setup name", exact: true }).fill("Connected board test");
        await form.getByRole("button", { name: "Save and run", exact: true }).click();
        await expect(form).toHaveCount(0);
        await expect(run.getByRole("combobox", { name: "Run setup", exact: true })).toHaveValue("Connected board test");
        boardSetupSaved = true;
      } else {
        await run.getByRole("combobox", { name: "Run setup", exact: true }).selectOption({ label: "Connected board test" });
        await run.getByRole("button", { name: "Run", exact: true }).click();
      }
      return player();
    },
    runGame: async () => {
      const run = page.getByRole("group", { name: "Run", exact: true });
      await run.getByRole("combobox", { name: "Run setup", exact: true }).selectOption({ label: "Game start-up" });
      await run.getByRole("button", { name: "Run", exact: true }).click();
      return player();
    },
    readRunSnapshot: async () => page.locator(".tkr-run-current .tkr-run-snapshot").evaluate((element) => {
      const field = (label: string): Element => {
        const value = [...element.querySelectorAll("dt")].find((entry) => entry.textContent === label)?.nextElementSibling;
        if (value?.tagName !== "DD") throw new Error(`The displayed run snapshot has no ${label} field`);
        return value;
      };
      const launch = field("Launch").textContent;
      const board = /^Board test at (.+) \(/.exec(launch ?? "")?.[1];
      const kind = launch === "Game from its start-up" ? "game" : board === undefined ? null : "board";
      const manifest = field("Other files").getAttribute("title");
      if (kind === null || manifest === null) throw new Error("The displayed run snapshot has invalid launch or manifest details");
      return { kind, manifest, start: board === undefined ? null : { board } };
    }),
    stopRun: async () => {
      await page.getByRole("group", { name: "Run", exact: true }).getByRole("button", { name: "Stop", exact: true }).click();
      await expect(page.locator('iframe[title="Running game"]')).toHaveCount(0);
    },
    settle: () => page.waitForTimeout(80),
  }, expect);
  await openFile(CONNECTED_BOARD);
  await page.screenshot({ path: test.info().outputPath("connected-authoring.png") });
});
