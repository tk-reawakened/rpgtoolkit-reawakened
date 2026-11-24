import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

// Story 13.10 (T-57, T-58) in the real browser host, through the shipped editor page: the workbench opens a special move
// and its linked status effect in their own tabs, each form edits and saves through the host's own Save, and the bytes
// left in the origin-private project folder are exactly the hand-patched bytes of the committed annotated listings
// (docs/spec/examples/listings/fireball.spc.txt, burn.ste.txt). No expected byte comes from the writer under test.

const bytes = (path: string): number[] => Array.from(readFileSync(new URL(`../../../docs/spec/examples/${path}`, import.meta.url)));
const FIREBALL = bytes("game/Game/Example/SpcMove/fireball.spc");
const BURN = bytes("game/Game/Example/StatusE/burn.ste");
// fireball.spc: fp 0x1e (i32), battle 0x37, menu 0x38. burn.ste: hpAmount 0x24 (i16).
const MOVE_EDITED = (() => {
  const bytes = [...FIREBALL];
  bytes.splice(0x1e, 4, 0xe2, 0xff, 0xff, 0xff);
  bytes[0x37] = 0;
  return bytes;
})();
const STATUS_EDITED = (() => {
  const bytes = [...BURN];
  bytes.splice(0x24, 2, 0xfb, 0xff);
  return bytes;
})();

interface ProofWindow extends Window { __tkrTestFolder?: FileSystemDirectoryHandle }

/** The shipped editor page over a seeded origin-private project folder, opened the way a person does it. */
async function openWorkbench(page: Page): Promise<void> {
  const files = [
    { path: "Main/example.gam", bytes: bytes("game/Main/example.gam") },
    { path: "SpcMove/fireball.spc", bytes: FIREBALL },
    { path: "StatusE/burn.ste", bytes: BURN },
  ];
  const folderName = `TkrBattleData-${randomUUID()}`;
  await page.addInitScript(async ({ inputs, name }) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
    for (const input of inputs) {
      let parent = root;
      const parts = input.path.split("/");
      for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part, { create: true });
      const file = await parent.getFileHandle(parts.at(-1)!, { create: true });
      if ((await file.getFile()).size > 0) continue;
      const writable = await file.createWritable();
      await writable.write(new Uint8Array(input.bytes));
      await writable.close();
    }
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => root });
    (window as ProofWindow).__tkrTestFolder = root;
  }, { inputs: files, name: folderName });
  await page.goto("/tools/browser/editor-web/index.html");
  await page.waitForFunction(() => (window as ProofWindow).__tkrTestFolder !== undefined);
  await page.getByRole("button", { name: "Open project folder" }).click();
  await expect(page.getByLabel("Game title")).toBeVisible();
}

async function openFile(page: Page, folderName: string, fileName: string): Promise<void> {
  const folder = page.getByRole("treeitem", { name: new RegExp(`^${folderName}, folder`) });
  await expect(folder).toBeVisible();
  if ((await folder.getAttribute("aria-expanded")) !== "true") await folder.dblclick();
  await page.getByRole("treeitem", { name: new RegExp(`^${fileName.replace(".", "\\.")},`) }).dblclick();
}

async function readProjectFile(page: Page, path: string): Promise<number[]> {
  return await page.evaluate(async (file) => {
    let handle = (window as ProofWindow).__tkrTestFolder!;
    const parts = file.split("/");
    for (const part of parts.slice(0, -1)) handle = await handle.getDirectoryHandle(part);
    return Array.from(new Uint8Array(await (await (await handle.getFileHandle(parts.at(-1)!)).getFile()).arrayBuffer()));
  }, path);
}

/** Type into a field and leave it: the form submits when the field is left. */
async function retype(page: Page, label: string, value: string): Promise<void> {
  const field = page.getByLabel(label, { exact: true });
  await field.fill(value);
  await field.blur();
}

test("a special move opens, edits its signed damage and inverted usable flag, and Save writes exactly those bytes", async ({ page }) => {
  await openWorkbench(page);
  await openFile(page, "SpcMove", "fireball.spc");
  const editor = page.locator('[data-tkr-editor="Special move"]');
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Fireball");
  await expect(editor.getByLabel("Damage (FP)", { exact: true })).toHaveValue("12");
  // The committed move stores battle = 1 (not usable) and menu = 0 (usable).
  await expect(editor.getByLabel("Usable in battle", { exact: true })).not.toBeChecked();
  await expect(editor.getByLabel("Usable from the menu", { exact: true })).toBeChecked();
  await expect(editor.getByText("Stored value 1: 0 means usable")).toBeVisible();

  await retype(page, "Damage (FP)", "-30");
  await expect(editor.getByText("Heals the target by 30")).toBeVisible();
  await editor.getByLabel("Usable in battle", { exact: true }).check();
  expect(await readProjectFile(page, "SpcMove/fireball.spc")).toEqual(FIREBALL);
  await page.getByRole("button", { name: "Save active editor", exact: true }).click();
  await expect.poll(() => readProjectFile(page, "SpcMove/fireball.spc")).toEqual(MOVE_EDITED);
  await expect(editor.getByLabel("Usable in battle", { exact: true })).toBeChecked();
});

test("the linked status effect opens in its own tab, saves there, and the move's link reads the new numbers back", async ({ page }) => {
  await openWorkbench(page);
  await openFile(page, "SpcMove", "fireball.spc");
  const move = page.locator('[data-tkr-editor="Special move"]');
  await expect(move.getByText("Burn: 3 rounds; removes 2 HP each round.")).toBeVisible();
  await move.getByRole("button", { name: "Open status effect" }).click();
  const status = page.locator('[data-tkr-editor="Status effect"]');
  await expect(status).toBeVisible();
  await expect(status.getByLabel("Name", { exact: true })).toHaveValue("Burn");
  await expect(status.getByLabel("HP per round", { exact: true })).toHaveValue("2");

  await retype(page, "HP per round", "-5");
  await expect(status.getByText("Heals 5 HP each round")).toBeVisible();
  expect(await readProjectFile(page, "StatusE/burn.ste")).toEqual(BURN);
  await page.getByRole("button", { name: "Save active editor", exact: true }).click();
  await expect.poll(() => readProjectFile(page, "StatusE/burn.ste")).toEqual(STATUS_EDITED);
  expect(await readProjectFile(page, "SpcMove/fireball.spc"), "editing the link never touched the move's own file").toEqual(FIREBALL);

  await page.getByRole("button", { name: "Return to board" }).click();
  await expect(move).toBeVisible();
  await expect(move.getByText("Burn: 3 rounds; restores 5 HP each round.")).toBeVisible();
});

test("a value the field cannot hold is refused with the reason, the file keeps its bytes, and the rest still saves", async ({ page }) => {
  await openWorkbench(page);
  await openFile(page, "SpcMove", "fireball.spc");
  const editor = page.locator('[data-tkr-editor="Special move"]');
  await retype(page, "Damage (FP)", "9999999999");
  await expect(editor.getByRole("alert")).toContainText("whole number from -2147483648 to 2147483647");
  // A refused draft keeps its text and its reason, and never holds the host's save open.
  await expect(editor.getByLabel("Damage (FP)", { exact: true })).toHaveValue("9999999999");
  await page.getByRole("button", { name: "Save active editor", exact: true }).click();
  expect(await readProjectFile(page, "SpcMove/fireball.spc")).toEqual(FIREBALL);
  await expect(editor.getByRole("alert")).toContainText("whole number from -2147483648 to 2147483647");
});
