import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ANIMATION_PROOF_PATH, runAnimationAuthoringProof } from "@tk-reawakened/editor-vscode-test/animation-proof";

interface ProofWindow extends Window {
  __animationFolder?: FileSystemDirectoryHandle;
  __animationLock?: FileSystemWritableFileStream;
}
const fixture = (path: string) => [...readFileSync(new URL(`../../../${path}`, import.meta.url))];
async function boot(page: Page): Promise<void> {
  const files = [
    { path: "Main/example.gam", bytes: fixture("docs/spec/examples/game/Main/example.gam") },
    { path: "Bitmap/a.gif", bytes: fixture("packages/core/test/fixtures/authored/gif-anim89a.gif") },
    { path: "Bitmap/z.gif", bytes: fixture("packages/core/test/fixtures/authored/gif-anim89a.gif") },
    { path: "Tiles/village.tst", bytes: fixture("docs/spec/examples/versions/tileset/tileset_detail1.tst") },
  ];
  await page.addInitScript(async ({ files, name }) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
    for (const input of files) {
      let parent = root;
      const parts = input.path.split("/");
      for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part, { create: true });
      const handle = await parent.getFileHandle(parts.at(-1)!, { create: true });
      if ((await handle.getFile()).size > 0) continue;
      const writer = await handle.createWritable(); await writer.write(new Uint8Array(input.bytes)); await writer.close();
    }
    (window as ProofWindow).__animationFolder = root;
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => root });
  }, { files, name: `TkrAnimation-${randomUUID()}` });
  await page.goto("/tools/browser/editor-web/index.html");
  await page.waitForFunction(() => (window as ProofWindow).__animationFolder !== undefined);
  await page.getByRole("button", { name: "Open project folder", exact: true }).click();
  await expect(page.getByLabel("Game title")).toBeVisible();
}
async function read(page: Page, path: string): Promise<Uint8Array | null> {
  const bytes = await page.evaluate(async (path) => {
    try {
      let parent = (window as ProofWindow).__animationFolder!;
      const parts = path.split("/");
      for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part);
      return [...new Uint8Array(await (await (await parent.getFileHandle(parts.at(-1)!)).getFile()).arrayBuffer())];
    } catch (error) { if (error instanceof DOMException && error.name === "NotFoundError") return null; throw error; }
  }, path);
  return bytes === null ? null : new Uint8Array(bytes);
}
async function openAnimation(page: Page): Promise<void> {
  const folder = page.getByRole("treeitem", { name: /^Misc, folder/ });
  if (await folder.getAttribute("aria-expanded") !== "true") await folder.dblclick();
  await page.getByRole("treeitem", { name: /^host-proof\.anm,/ }).dblclick();
  await expect(page.getByRole("main", { name: "Animation editor" })).toBeVisible();
}

test("animation creation and multi-frame recovery survive both native storage refusal and browser restart", async ({ page }) => {
  // Integration proof: real browser storage, native lock refusal and page recreation need multiple
  // host round trips. A sub-second unit test cannot prove these contracts; bounded at 120 seconds.
  test.setTimeout(120_000);
  page.setDefaultTimeout(10_000);
  await boot(page);
  const editor = () => page.getByRole("main", { name: "Animation editor" });
  await runAnimationAuthoringProof({
    save: async () => { await page.getByRole("button", { name: "Save active editor", exact: true }).click(); },
    create: async () => {
      await page.getByRole("button", { name: "New animation…", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("textbox").fill(ANIMATION_PROOF_PATH);
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      expect(await read(page, ANIMATION_PROOF_PATH)).toBeNull();
      await page.getByRole("button", { name: "New animation…", exact: true }).click();
      await page.getByRole("dialog").getByRole("textbox").fill(ANIMATION_PROOF_PATH);
      await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
      await expect(editor()).toBeVisible(); return editor();
    },
    reopen: async () => {
      const close = page.getByRole("button", { name: `Close ${ANIMATION_PROOF_PATH}`, exact: true });
      if (await close.count()) await close.click();
      await openAnimation(page); return editor();
    },
    restart: async () => {
      await page.getByRole("button", { name: `Close ${ANIMATION_PROOF_PATH}`, exact: true }).click();
      await page.reload();
      await page.waitForFunction(() => (window as ProofWindow).__animationFolder !== undefined);
      await page.getByRole("button", { name: "Open project folder", exact: true }).click();
      await expect(page.getByLabel("Game title")).toBeVisible();
    },
    restore: async (reason) => {
      await page.getByRole("button", { name: "Project recovery…", exact: true }).click();
      const dialog = page.getByRole("dialog");
      const group = dialog.getByRole("article").filter({ hasText: "Bitmap/proof-first.tbm" }).filter({ has: page.getByRole("heading", { name: new RegExp(`^${reason} —`) }) }).last();
      await group.getByRole("button", { name: "Restore group", exact: true }).click();
      await expect(dialog.getByRole("status")).toHaveText("Operation finished; review each file below.");
      await dialog.getByRole("button", { name: "Close recovery", exact: true }).click();
    },
    consent: async () => { await page.getByRole("dialog").getByRole("button", { name: "Replace", exact: true }).click(); },
    read: (path) => read(page, path),
    refuseAnimationWrite: async (check) => {
      await page.evaluate(async () => {
        const folder = await (window as ProofWindow).__animationFolder!.getDirectoryHandle("Misc");
        const file = await folder.getFileHandle("host-proof.anm");
        (window as ProofWindow).__animationLock = await file.createWritable({ mode: "exclusive" } as FileSystemCreateWritableOptions);
      });
      try { await check(); } finally { await page.evaluate(async () => { await (window as ProofWindow).__animationLock!.abort(); delete (window as ProofWindow).__animationLock; }); }
    },
    settle: () => page.waitForTimeout(40),
  }, expect);
});
