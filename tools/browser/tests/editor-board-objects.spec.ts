import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { boardObjectsProofFiles, runBoardObjectsProof } from "@tk-reawakened/editor-vscode-test/board-objects-proof";

test.use({ screenshot: "only-on-failure" });
interface ProofWindow extends Window { __objectsFolder?: FileSystemDirectoryHandle }
async function read(page: Page, path: string): Promise<Uint8Array> {
  return new Uint8Array(await page.evaluate(async (path) => {
    let directory = (window as ProofWindow).__objectsFolder;
    if (directory === undefined) throw new Error("The authored object folder is not open");
    const parts = path.split("/");
    for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
    return [...new Uint8Array(await (await (await directory.getFileHandle(parts.at(-1)!)).getFile()).arrayBuffer())];
  }, path));
}
async function openFile(page: Page, path: string): Promise<void> {
  const tab = page.getByRole("tab", { name: new RegExp(`^${path.replaceAll(".", "\\.")}(?:, unsaved changes)?$`) });
  if (await tab.count()) await tab.click();
  else {
    for (const name of path.split("/").slice(0, -1)) {
      const folder = page.getByRole("treeitem", { name: new RegExp(`^${name}, folder`) });
      if (await folder.getAttribute("aria-expanded") !== "true") await folder.dblclick();
    }
    const name = path.split("/").at(-1)!;
    await page.getByRole("treeitem", { name: new RegExp(`^${name.replaceAll(".", "\\.")},`) }).dblclick();
  }
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

test("board objects render, edit, visit definitions and survive browser save and document recreation", async ({ page }, testInfo) => {
  // Paced OPFS, real canvas, Monaco and document recreation prove host behavior that a sub-second unit cannot.
  test.setTimeout(120_000); page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const files = [
    { path: "Main/example.gam", bytes: [...readFileSync(new URL("../../../docs/spec/examples/game/Main/example.gam", import.meta.url))] },
    ...boardObjectsProofFiles().map((file) => ({ path: file.path, bytes: [...file.bytes] })),
  ];
  await page.addInitScript(async ({ files, name }) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
    for (const file of files) {
      let directory = root;
      const parts = file.path.split("/");
      for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part, { create: true });
      const handle = await directory.getFileHandle(parts.at(-1)!, { create: true });
      const stream = await handle.createWritable(); await stream.write(new Uint8Array(file.bytes)); await stream.close();
    }
    (window as ProofWindow).__objectsFolder = root;
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => root });
  }, { files, name: `TkrObjects-${randomUUID()}` });
  await page.goto("/tools/browser/editor-web/index.html");
  await page.getByRole("button", { name: "Open project folder", exact: true }).click();
  await expect(page.getByLabel("Game title")).toBeVisible();
  const pane = () => page.locator(".tkr-editor-pane:not([hidden])");
  const board = () => pane().locator(".tkr-board");
  await runBoardObjectsProof({
    page,
    read: (path) => read(page, path),
    openBoard: async (path) => { await openFile(page, path); await expect(board()).toBeVisible(); return board(); },
    reopenBoard: async (path) => {
      await page.getByRole("button", { name: `Close ${path}`, exact: true }).click();
      await expect(page.getByRole("tab", { name: path, exact: true })).toHaveCount(0);
      await openFile(page, path); await expect(board()).toBeVisible(); return board();
    },
    save: async (editor) => {
      await page.getByRole("button", { name: "Save active editor", exact: true }).click();
      await expect(editor.locator(".tkr-board-state")).toHaveText("All changes saved");
      await page.waitForTimeout(80);
    },
    undo: (editor) => editor.locator(".tkr-board-undo").click(),
    redo: (editor) => editor.locator(".tkr-board-redo").click(),
    expectProgram: async (path, text) => {
      await expect(page.getByRole("tab", { name: path, exact: true })).toHaveAttribute("aria-selected", "true");
      await expect(pane().locator(".monaco-editor")).toContainText(text);
    },
    expectItem: async (path, name) => {
      await expect(page.getByRole("tab", { name: path, exact: true })).toHaveAttribute("aria-selected", "true");
      await expect(pane().getByRole("region", { name: "item sprite graphics", exact: true })).toContainText(name);
    },
    returnToBoard: async () => {
      await page.getByRole("button", { name: "Return to board", exact: true }).click();
      await expect(board()).toBeVisible(); return board();
    },
    settle: () => page.waitForTimeout(80),
  }, expect);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("board-objects.png"), fullPage: true });
});
