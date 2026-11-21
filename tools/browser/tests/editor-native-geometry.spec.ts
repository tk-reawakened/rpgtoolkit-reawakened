import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { GEOMETRY_SCENE, geometryProofFiles, proveNativeGeometry } from "@tk-reawakened/editor-vscode-test/native-geometry-proof";

const main = readFileSync(new URL("../../../docs/spec/examples/game/Main/example.gam", import.meta.url));

test.use({ actionTimeout: 10_000 });

// Only the OS folder chooser is substituted. The scene, owner editors, builder and writes are all production paths.
test("native asset geometry is reusable and a linked pack moves, copies and deletes in the browser editor", async ({ page }) => {
  test.setTimeout(90_000);
  const fixture = [...geometryProofFiles(), { path: "Main/example.gam", bytes: main }];
  await page.addInitScript(async (files) => {
    const storage = await navigator.storage.getDirectory();
    const root = await storage.getDirectoryHandle("geometry-proof", { create: true });
    for (const { path, bytes } of files) {
      const parts = path.split("/");
      let folder = root;
      for (const part of parts.slice(0, -1)) folder = await folder.getDirectoryHandle(part, { create: true });
      const file = await folder.getFileHandle(parts.at(-1)!, { create: true });
      const stream = await file.createWritable();
      await stream.write(Uint8Array.from(bytes));
      await stream.close();
    }
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => root });
    Object.defineProperty(window, "__geometryProofPickerReady", { value: true });
  }, fixture.map(({ path, bytes }) => ({ path, bytes: [...bytes] })));
  await page.goto("/tools/browser/editor-web/index.html");
  await page.waitForFunction(() => Reflect.get(window, "__geometryProofPickerReady") === true);
  await page.getByRole("button", { name: "Open project folder", exact: true }).click();
  const boards = page.getByRole("treeitem", { name: /^Boards, folder/ });
  await expect(boards).toBeVisible();
  if (await boards.getAttribute("aria-expanded") !== "true") await boards.dblclick();
  await page.getByRole("treeitem", { name: /^garden-geometry\.tkrscn,/ }).dblclick();
  await proveNativeGeometry(expect, {
    read: async (path) => {
      const bytes = await page.evaluate(async (path) => {
        try {
          const parts = path.split("/");
          let folder = await (await navigator.storage.getDirectory()).getDirectoryHandle("geometry-proof");
          for (const part of parts.slice(0, -1)) folder = await folder.getDirectoryHandle(part);
          const file = await (await folder.getFileHandle(parts.at(-1)!)).getFile();
          return [...new Uint8Array(await file.arrayBuffer())];
        } catch (error) {
          if (error instanceof DOMException && error.name === "NotFoundError") return null;
          throw error;
        }
      }, path);
      if (bytes === null) throw Object.assign(new Error(`No file at ${path}`), { code: "ENOENT" });
      return Uint8Array.from(bytes);
    },
    openScene: async () => {
      await page.getByRole("tab", { name: GEOMETRY_SCENE, exact: true }).click();
      await expect(page.getByRole("region", { name: "Scene terrain editor" })).toBeVisible();
      return page;
    },
    openedOwner: async (path) => {
      await expect(page.getByRole("tab", { name: path, exact: true })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("region", { name: "Collision and walk-behind" })).toBeVisible();
      return page;
    },
    closeOwner: async (path) => {
      await page.getByRole("button", { name: `Close ${path}`, exact: true }).click();
      await expect(page.getByRole("tab", { name: path, exact: true })).toHaveCount(0);
    },
    verifyOwnerHistory: async () => {
      const shape = page.locator('[data-tkr-shape="solid:0"]');
      const command = async (name: "Undo" | "Redo") => {
        await page.getByRole("button", { name: "Application menu", exact: true }).click();
        await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
        await page.getByRole("menuitem", { name: new RegExp(`^${name}(?:\\b|$)`) }).click();
      };
      await command("Undo");
      await expect(shape).toHaveCount(0);
      await command("Redo");
      await expect(shape).toContainText("Fence rails");
      return page;
    },
    save: async () => {
      await page.getByRole("button", { name: "Save active editor", exact: true }).click();
    },
  });
});
