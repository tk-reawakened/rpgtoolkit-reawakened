// Importing a saved board as a native scene in the shipped browser editor (#1851): the Files panel reviews and cancels,
// imports one same-stem scene without touching the board, opens it in the native editor, and the first save of the
// authored scene separately authorizes replacing the board after retaining its bytes in history.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const validMain = Array.from(readFileSync(new URL("../../../docs/spec/examples/game/Main/example.gam", import.meta.url)));
/** A pre-vector board the legacy writable board view refuses; the shared board reader still converts it. */
const oldBoard = Array.from(readFileSync(new URL("../../../docs/spec/examples/versions/board/board_minor2.brd", import.meta.url)));
const vectorBoard = Array.from(readFileSync(new URL("../../../docs/spec/examples/versions/board/board_minor4.brd", import.meta.url)));

interface ProofWindow extends Window {
  __tkrTestFolder?: FileSystemDirectoryHandle;
}

type FolderFile = { readonly path: string; readonly bytes: readonly number[] };

async function installFolder(page: Page, files: readonly FolderFile[]): Promise<string> {
  const folder = `TkrBoardImport-${randomUUID()}`;
  await page.addInitScript(async ({ inputs, name }: { readonly inputs: readonly FolderFile[]; readonly name: string }) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
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
    (window as ProofWindow).__tkrTestFolder = root;
  }, { inputs: files, name: folder });
  return folder;
}

async function readFolderFile(page: Page, folder: string, path: string): Promise<number[]> {
  return page.evaluate(async ({ name, file }: { readonly name: string; readonly file: string }) => {
    let directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(name);
    const parts = file.split("/");
    for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
    const found = await (await directory.getFileHandle(parts.at(-1)!)).getFile();
    return Array.from(new Uint8Array(await found.arrayBuffer()));
  }, { name: folder, file: path });
}

async function listFolder(page: Page, folder: string, path: string): Promise<readonly string[]> {
  return page.evaluate(async ({ name, folder: path }: { readonly name: string; readonly folder: string }) => {
    let directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(name);
    for (const part of path.split("/").filter(Boolean)) directory = await directory.getDirectoryHandle(part);
    const names: string[] = [];
    for await (const handle of directory.values()) names.push(handle.name);
    return names.sort();
  }, { name: folder, folder: path });
}

async function readBoardHistory(page: Page, folder: string): Promise<readonly { readonly path: string; readonly reason: string; readonly bytes: number[] }[]> {
  return page.evaluate(async (name: string) => {
    const project = await (await navigator.storage.getDirectory()).getDirectoryHandle(name);
    const history = await project.getDirectoryHandle(".tkr-history");
    const entries = await history.getDirectoryHandle("entries");
    const blobs = await history.getDirectoryHandle("blobs");
    const stored: { path: string; reason: string; bytes: number[] }[] = [];
    for await (const handle of entries.values()) {
      if (handle.kind !== "file") continue;
      const entry = JSON.parse(await (await handle.getFile()).text()) as { path: string; reason: string; sha256: string };
      const blob = await (await blobs.getFileHandle(entry.sha256)).getFile();
      stored.push({ path: entry.path, reason: entry.reason, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) });
    }
    return stored;
  }, folder);
}

test.use({ actionTimeout: 10_000 });

test("Files imports an older board as one same-stem scene and the scene's first save separately authorizes replacing the board, retaining it in history", async ({ page }) => {
  test.setTimeout(90_000);
  const folder = await installFolder(page, [
    { path: "Main/example.gam", bytes: validMain },
    { path: "Boards/old.brd", bytes: oldBoard },
  ]);
  await page.goto("/tools/browser/editor-web/index.html");
  await page.getByRole("button", { name: "Open project folder", exact: true }).click();
  const boards = page.getByRole("treeitem", { name: /^Boards, folder/ });
  await expect(boards).toBeVisible();
  if (await boards.getAttribute("aria-expanded") !== "true") await boards.dblclick();
  await page.getByRole("treeitem", { name: /^old\.brd,/ }).click();
  const importButton = page.getByRole("button", { name: "Import board as scene…", exact: true });
  await expect(importButton).toBeEnabled();

  // Review names the source, the same-stem destination and the conversion findings; cancelling is not an error.
  await importButton.click();
  const review = page.getByRole("dialog").filter({ hasText: "Import Boards/old.brd as a scene?" });
  await expect(review).toContainText("Creates Boards/old.tkrscn only.");
  await expect(review).toContainText("The original board and game links stay unchanged.");
  await review.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(review).not.toBeVisible();
  expect(await listFolder(page, folder, "Boards")).toEqual(["old.brd"]);
  expect(await readFolderFile(page, folder, "Boards/old.brd")).toEqual(oldBoard);

  // Confirming writes one same-stem scene and opens it; the board keeps its exact bytes.
  await importButton.click();
  const confirm = page.getByRole("dialog").filter({ hasText: "Import Boards/old.brd as a scene?" });
  await confirm.getByRole("button", { name: "Import as Scene", exact: true }).click();
  await expect(confirm).not.toBeVisible();
  await expect(page.getByRole("tab", { name: "Boards/old.tkrscn", exact: true })).toHaveAttribute("aria-selected", "true");
  const editor = page.getByRole("region", { name: "Scene terrain editor" });
  await expect(editor).toBeVisible();
  expect(await listFolder(page, folder, "Boards")).toEqual(["old.brd", "old.tkrscn"]);
  expect(new TextDecoder().decode(Uint8Array.from(await readFolderFile(page, folder, "Boards/old.tkrscn")))).toContain("contract: scene");
  expect(await readFolderFile(page, folder, "Boards/old.brd")).toEqual(oldBoard);

  // Author the imported scene natively: one cell override. Saving it is the only route that can change the board.
  await editor.getByRole("radio", { name: "Manual empty" }).check();
  const firstCell = editor.getByRole("button", { name: /^Cell 0, 0:/ });
  await firstCell.click();
  await expect(firstCell).toHaveAccessibleName(/empty override/);
  const save = page.getByRole("button", { name: "Save active editor", exact: true });
  await save.click();
  const authorize = page.getByRole("dialog").filter({ hasText: "Generated outputs conflict with existing project files." });
  await expect(authorize).toContainText("Boards/old.brd");
  await authorize.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(authorize).not.toBeVisible();
  expect(await readFolderFile(page, folder, "Boards/old.brd")).toEqual(oldBoard);

  // The build's first replacement is a separate, explicit decision; it retains the board's bytes before writing.
  await save.click();
  const authorizeAgain = page.getByRole("dialog").filter({ hasText: "Generated outputs conflict with existing project files." });
  await authorizeAgain.getByRole("button", { name: "Authorize listed outputs", exact: true }).click();
  await expect(page.getByText("Scene saved and board built.", { exact: true })).toBeVisible();
  expect(await readFolderFile(page, folder, "Boards/old.brd")).not.toEqual(oldBoard);
  const history = (await readBoardHistory(page, folder)).filter((entry) => entry.path === "Boards/old.brd");
  expect(history).toHaveLength(1);
  expect(history[0]!.reason).toBe("before-conflict-resolution");
  expect(history[0]!.bytes).toEqual(oldBoard);
  expect(await listFolder(page, folder, "Boards")).toEqual(["old.brd", "old.tkrscn"]);
});

test("Opening a supported legacy board never imports it; the board toolbar can explicitly import and open the scene", async ({ page }) => {
  const folder = await installFolder(page, [
    { path: "Main/example.gam", bytes: validMain },
    { path: "Boards/vector.brd", bytes: vectorBoard },
  ]);
  await page.goto("/tools/browser/editor-web/index.html");
  await page.getByRole("button", { name: "Open project folder", exact: true }).click();
  const boards = page.getByRole("treeitem", { name: /^Boards, folder/ });
  await expect(boards).toBeVisible();
  if (await boards.getAttribute("aria-expanded") !== "true") await boards.dblclick();
  await page.getByRole("treeitem", { name: /^vector\.brd,/ }).dblclick();
  const board = page.getByRole("region", { name: "Board", exact: true });
  await expect(board).toBeVisible();
  expect(await listFolder(page, folder, "Boards")).toEqual(["vector.brd"]);
  await board.getByRole("button", { name: "Import as Scene…", exact: true }).click();
  const review = page.getByRole("dialog").filter({ hasText: "Import Boards/vector.brd as a scene?" });
  await review.getByRole("button", { name: "Import as Scene", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Boards/vector.tkrscn", exact: true })).toHaveAttribute("aria-selected", "true");
  expect(await listFolder(page, folder, "Boards")).toEqual(["vector.brd", "vector.tkrscn"]);
  expect(await readFolderFile(page, folder, "Boards/vector.brd")).toEqual(vectorBoard);
});
