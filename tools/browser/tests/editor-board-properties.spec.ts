import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { boardPropertiesProofFiles, PROPERTIES_BOARD, runBoardPropertiesProof } from "@tk-reawakened/editor-vscode-test/board-properties-proof";

test.use({ screenshot: "only-on-failure" });

interface ProofWindow extends Window { __propertiesFolder?: FileSystemDirectoryHandle }

async function read(page: Page, path: string): Promise<Uint8Array> {
  const bytes = await page.evaluate(async (path) => {
    let directory = (window as ProofWindow).__propertiesFolder;
    if (directory === undefined) throw new Error("The authored proof folder is not open");
    const parts = path.split("/");
    for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
    return [...new Uint8Array(await (await (await directory.getFileHandle(parts.at(-1)!)).getFile()).arrayBuffer())];
  }, path);
  return new Uint8Array(bytes);
}

async function openFile(page: Page, path: string): Promise<void> {
  const existing = page.getByRole("tab", { name: new RegExp(`^${path.replaceAll(".", "\\.")}(?:, unsaved changes)?$`) });
  if (await existing.count()) {
    await existing.click();
  } else {
    for (const name of path.split("/").slice(0, -1)) {
      const folder = page.getByRole("treeitem", { name: new RegExp(`^${name}, folder`) });
      if (await folder.getAttribute("aria-expanded") !== "true") await folder.dblclick();
    }
    const name = path.split("/").at(-1)!;
    await page.getByRole("treeitem", { name: new RegExp(`^${name.replaceAll(".", "\\.")},`) }).dblclick();
  }
  await expect(existing).toHaveAttribute("aria-selected", "true");
}

test("board properties, linked-program return and separately owned startup edits survive real browser save and reopen", async ({ page }, testInfo) => {
  // A paced integration proof: native OPFS, Monaco, document recreation and linked visits cannot
  // be proved by a sub-second unit case. Protocol operations are bounded and allowed to settle.
  test.setTimeout(120_000);
  page.setDefaultTimeout(10_000);
  const main = "Main/example.gam";
  const files = [
    { path: main, bytes: [...readFileSync(new URL("../../../docs/spec/examples/game/Main/example.gam", import.meta.url))] },
    ...boardPropertiesProofFiles().map((file) => ({ path: file.path, bytes: [...file.bytes] })),
  ];
  await page.addInitScript(async ({ files, name }) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
    for (const input of files) {
      let parent = root;
      const parts = input.path.split("/");
      for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part, { create: true });
      const handle = await parent.getFileHandle(parts.at(-1)!, { create: true });
      const stream = await handle.createWritable();
      await stream.write(new Uint8Array(input.bytes));
      await stream.close();
    }
    (window as ProofWindow).__propertiesFolder = root;
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => root });
  }, { files, name: `TkrProperties-${randomUUID()}` });
  await page.goto("/tools/browser/editor-web/index.html");
  await page.getByRole("button", { name: "Open project folder", exact: true }).click();
  await expect(page.getByLabel("Game title")).toBeVisible();
  const board = () => page.locator(".tkr-editor-pane:not([hidden]) .tkr-board");
  await runBoardPropertiesProof({
    main,
    read: (path) => read(page, path),
    openBoard: async (path) => { await openFile(page, path); await expect(board()).toBeVisible(); return board(); },
    reopenBoard: async (path) => {
      await page.getByRole("button", { name: `Close ${path}`, exact: true }).click();
      await expect(page.getByRole("tab", { name: path, exact: true })).toHaveCount(0);
      await openFile(page, path);
      await expect(board()).toBeVisible();
      return board();
    },
    closeBoard: async (path) => {
      await page.getByRole("button", { name: `Close ${path}`, exact: true }).click();
      await expect(page.getByRole("tab", { name: path, exact: true })).toHaveCount(0);
    },
    save: async () => { await page.getByRole("button", { name: "Save active editor", exact: true }).click(); },
    expectBoard: async (path) => {
      await expect(page.getByRole("tab", { name: path, exact: true })).toHaveAttribute("aria-selected", "true");
      await expect(board()).toBeVisible();
    },
    expectProgram: async (path, text) => {
      await expect(page.getByRole("tab", { name: path, exact: true })).toHaveAttribute("aria-selected", "true");
      await expect(page.locator(".tkr-editor-pane:not([hidden]) .monaco-editor")).toContainText(text);
    },
    returnToBoard: async () => {
      await page.getByRole("button", { name: "Return to board", exact: true }).click();
      await expect(board()).toBeVisible();
      return board();
    },
    setInitial: async (editor, accept) => {
      await editor.getByRole("button", { name: "Set as initial board", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText("properties-origin.brd");
      await dialog.getByRole("button", { name: accept ? "Set initial board" : "Cancel", exact: true }).click();
      await page.waitForTimeout(80);
    },
    saveMain: async () => {
      await openFile(page, main);
      await page.getByRole("button", { name: "Save active editor", exact: true }).click();
      await openFile(page, PROPERTIES_BOARD);
    },
    settle: () => page.waitForTimeout(80),
  }, expect);
  await page.screenshot({ path: testInfo.outputPath("board-properties.png"), fullPage: true });
});
