import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { BinaryReader, createEmptyCharacter, createEmptyMainFile, readBoard, writeCharacter, writeMainFile } from "@tk-reawakened/core";
import { encodeScenePng } from "@tk-reawakened/editor-model";
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

test("paint, touch up, reshape, save, reopen and play a native terrain scene", async ({ page }) => {
  const unwrap = <T,>(r: {ok: true; value: T} | {ok: false}): T => { expect(r.ok).toBe(true); if (!r.ok) throw new Error("Fixture could not be encoded"); return r.value; };
  const input = (path: string, value: string | Uint8Array) => ({ path, bytes: [...(typeof value === "string" ? new TextEncoder().encode(value) : value)] });
  const scenePath = "Boards/pond.tkrscn";
  const tile = (name: string, visual: string) => `contract: tile\nversion: 1.0.0-pre.1\nname: ${name}\nprojection: 2d\nrole: floor\nvisual:\n  transparent: {mode: alpha}\n${visual}\n`;
  const rgba = new Uint8Array(96 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 96; x++) rgba.set(x < 32 ? [20,80,160,255] : x < 64 ? [20,120,220,255] : [140,90,30,255], (96*y+x)*4);
  await installFolderPicker(page, [
    input("Main/test.gam", unwrap(writeMainFile({ ...createEmptyMainFile(), major: 2, minor: 9, initBoard: "configured-start.brd", initChar: "hero.tem", startupPrg: "" }))),
    input("Chrs/hero.tem", unwrap(writeCharacter({ ...createEmptyCharacter(), minor: 5, name: "Hero", movementAnimations: Array(8).fill(""), battleStances: Array(6).fill("") }))),
    input(scenePath, "contract: scene\nversion: 1.0.0-pre.1\n# Keep this comment\nprojection: 2d\nsize: {width: 4, height: 3}\nfloors:\n  - id: ground\nstart: {x: 16, y: 31, floor: ground}\n"),
    input("Tiles/water.tkrtle", tile("Water", "  cels:\n    - {id: a, sample: {file: Tiles/sheet.png, rect: [0,0,32,32]}}\n    - {id: b, sample: {file: Tiles/sheet.png, rect: [32,0,32,32]}}\n  timeline:\n    frames: [{cel: a, ms: 200}, {cel: b, ms: 200}]")),
    input("Tiles/bank.tkrtle", tile("Bank", "  sample: {file: Tiles/sheet.png, rect: [64,0,32,32]}")),
    input("Tiles/sheet.png", encodeScenePng({ w: 96, h: 32, rgba })),
    input("Tiles/pond.tkrtst", "contract: tileset\nversion: 1.0.0-pre.1\nname: Pond\nexpects: {projection: 2d, cellSize: [32,32]}\ntiles: [{tile: Tiles/water.tkrtle}, {tile: Tiles/bank.tkrtle}]\nterrains:\n  - id: water\n    name: Water\n    resolver: {provider: builtin, id: neighbour-match, version: 1.0.0}\n    neighbours: cardinal-4\n    coverage: complete\n    sync: lockstep\n    rules: [{id: water, when: {}, use: {tile: Tiles/water.tkrtle}}]\noutputBinding:\n  target: Tiles/pond.tst\n  detail: 1\n  slots: [{slot: 1, tile: Tiles/water.tkrtle, cel: a}, {slot: 2, tile: Tiles/water.tkrtle, cel: b}, {slot: 3, tile: Tiles/bank.tkrtle}]\n"),
  ]);
  await page.goto("/tools/browser/editor-web/index.html");
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "__tkrPickerReady"))).toBe(true);
  await page.getByRole("button", { name: "Open project folder", exact: true }).click();
  await expect(page.getByLabel("Game title")).toBeVisible();
  const openScene = async () => {
    const row = page.getByRole("treeitem", { name: /^Boards, folder/ });
    if (await row.getAttribute("aria-expanded") !== "true") await row.dblclick();
    await page.getByRole("treeitem", { name: /^pond\.tkrscn,/ }).dblclick();
  };
  await openScene();
  const editor = page.getByRole("region", { name: "Scene terrain editor" });
  await editor.getByRole("combobox", { name: "Tileset", exact: true }).selectOption("Tiles/pond.tkrtst");
  const cell = (x: number, y: number) => editor.getByRole("button", { name: new RegExp(`^Cell ${x}, ${y}:`) });
  await editor.getByRole("radio", { name: "Paint rectangle" }).check();
  await cell(0, 0).click();
  await cell(2, 1).click();
  await editor.getByRole("combobox", { name: "Manual tile", exact: true }).selectOption({ label: "Tiles/bank.tkrtle" });
  await editor.getByRole("radio", { name: "Manual tile" }).check();
  await cell(0, 0).click();
  await editor.getByRole("radio", { name: "Reshape region" }).check();
  await cell(1, 0).click();
  await cell(2, 1).click();
  await expect(cell(0, 0)).toHaveAccessibleName(/bank\.tkrtle/);
  await expect(cell(0, 1)).toHaveAccessibleName(/base/);
  const saveActive = page.getByRole("button", { name: "Save active editor", exact: true });
  await saveActive.click();
  await expect(page.getByText("Scene saved and board built.", { exact: true })).toBeVisible();
  const bytes = async (path: string) => new Uint8Array(await page.evaluate(async (path) => {
    let dir = (window as ProofWindow).__tkrTestFolder!;
    const parts = path.split("/");
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
    return [...new Uint8Array(await (await (await dir.getFileHandle(parts.at(-1)!)).getFile()).arrayBuffer())];
  }, path));
  expect(new TextDecoder().decode(await bytes(scenePath))).toContain("# Keep this comment");
  const board = unwrap(readBoard(new BinaryReader(await bytes("Boards/pond.brd"))));
  expect(board.tileMatrix.slice(0, 8).map((i) => board.lut[i])).toEqual(["pond.tst3", expect.stringMatching(/\.tan$/), expect.stringMatching(/\.tan$/), "", "", expect.stringMatching(/\.tan$/), expect.stringMatching(/\.tan$/), ""]);
  const savedTile = async (x: number, y: number) => {
    const next = unwrap(readBoard(new BinaryReader(await bytes("Boards/pond.brd"))));
    return next.lut[next.tileMatrix[y * 4 + x]!];
  };
  await editor.getByRole("radio", { name: "Manual tile" }).check();
  await cell(3, 2).click();
  await saveActive.click();
  await expect.poll(() => savedTile(3, 2)).toBe("pond.tst3");
  await cell(3, 1).click();
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => savedTile(3, 1)).toBe("pond.tst3");
  await cell(3, 0).click();
  await page.getByRole("button", { name: "Application menu" }).click();
  await page.getByRole("menuitem", { name: "Save All Open Documents" }).click();
  await expect.poll(() => savedTile(3, 0)).toBe("pond.tst3");
  await page.getByRole("button", { name: `Close ${scenePath}`, exact: true }).click();
  await expect(editor).not.toBeVisible();
  await openScene();
  await expect(cell(0, 0)).toHaveAccessibleName(/bank\.tkrtle/);
  await expect(cell(1, 0)).toHaveAccessibleName(/terrain water/);
  await editor.getByRole("radio", { name: "Manual empty" }).check();
  await cell(3, 2).click();
  expect(await savedTile(3, 2)).toBe("pond.tst3");
  await editor.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator(".tkr-run-current .tkr-run-snapshot")).toContainText("Board test at Boards/pond.brd");
  await expect.poll(() => savedTile(3, 2)).toBe("");
  const player = page.frameLocator('iframe[title="Running game"]');
  await expect(player.locator("#screen")).toBeVisible();
  await expect.poll(async () => player.locator("#screen").evaluate(() => {
    const session = Reflect.get(window, "__session") as { engine?: { drawList(): { commands: readonly { kind: string; source?: { asset?: string; tile?: number } }[] } } } | undefined;
    return session?.engine?.drawList().commands.flatMap(({ kind, source }) => kind === "blit" && source?.asset?.endsWith("/pond.tst") && typeof source.tile === "number" ? [source.tile] : []) ?? [];
  }), { timeout: 10_000 }).toContain(3);
  for (const frame of [1, 2]) {
    await expect.poll(async () => player.locator("#screen").evaluate(() => {
      const session = Reflect.get(window, "__session") as { engine?: { drawList(): { commands: readonly { kind: string; source?: { asset?: string; tile?: number } }[] } } } | undefined;
      return session?.engine?.drawList().commands.flatMap(({ kind, source }) => kind === "blit" && source?.asset?.endsWith("/pond.tst") && typeof source.tile === "number" ? [source.tile] : []) ?? [];
    }), { timeout: 10_000 }).toContain(frame);
  }
});
