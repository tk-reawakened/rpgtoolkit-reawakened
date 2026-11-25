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
async function openWorkbench(page: Page, extra: readonly { readonly path: string; readonly bytes: number[] }[] = []): Promise<void> {
  const files = [
    { path: "Main/example.gam", bytes: bytes("game/Main/example.gam") },
    { path: "SpcMove/fireball.spc", bytes: FIREBALL },
    { path: "StatusE/burn.ste", bytes: BURN },
    ...extra,
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

async function toggleSecondView(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Application menu" }).click();
  await page.getByRole("menuitem", { name: "View", exact: true }).click();
  await page.getByRole("menuitem", { name: "Toggle Split Second View", exact: true }).click();
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

test("saving a linked status effect refreshes both move views without dropping the second view's refused text", async ({ page }) => {
  await openWorkbench(page);
  await openFile(page, "SpcMove", "fireball.spc");
  const move = page.locator('[data-tkr-editor="Special move"]').first();
  await expect(move.getByText("Burn: 3 rounds; removes 2 HP each round.")).toBeVisible();
  await toggleSecondView(page);
  const mirror = page.locator("#mirror");
  await expect(mirror.getByText("Burn: 3 rounds; removes 2 HP each round.")).toBeVisible();
  const draft = mirror.getByLabel("Damage (FP)", { exact: true });
  await draft.fill("9999999999");
  await draft.blur();
  await expect(mirror.getByRole("alert")).toContainText("whole number");
  await move.getByRole("button", { name: "Open status effect" }).click();
  const status = page.locator('[data-tkr-editor="Status effect"]').first();
  await expect(status).toBeVisible();
  await expect(status.getByLabel("Name", { exact: true })).toHaveValue("Burn");
  await expect(status.getByLabel("HP per round", { exact: true })).toHaveValue("2");

  const hp = status.getByLabel("HP per round", { exact: true });
  await hp.fill("-5");
  await hp.blur();
  await expect(status.getByText("Heals 5 HP each round")).toBeVisible();
  expect(await readProjectFile(page, "StatusE/burn.ste")).toEqual(BURN);
  await page.getByRole("button", { name: "Save active editor", exact: true }).click();
  await expect.poll(() => readProjectFile(page, "StatusE/burn.ste")).toEqual(STATUS_EDITED);
  expect(await readProjectFile(page, "SpcMove/fireball.spc"), "editing the link never touched the move's own file").toEqual(FIREBALL);

  await page.getByRole("button", { name: "Return to board" }).click();
  await expect(move).toBeVisible();
  await expect(move.getByText("Burn: 3 rounds; restores 5 HP each round.")).toBeVisible();
  await expect(mirror.getByText("Burn: 3 rounds; restores 5 HP each round.")).toBeVisible();
  await expect(draft).toHaveValue("9999999999");
  await expect(mirror.getByRole("alert")).toContainText("whole number");
});

test("native description Undo after blur and save restores the original binary line separators", async ({ page }) => {
  const bytesWith = (description: string): number[] => [...FIREBALL.slice(0, 0x43), ...Buffer.from(description, "latin1"), 0];
  const path = "SpcMove/mixed.spc";
  const original = bytesWith("A\r\nB\nC");
  await openWorkbench(page, [{ path, bytes: original }]);
  await openFile(page, "SpcMove", "mixed.spc");
  const field = page.getByLabel("Description", { exact: true });
  await expect(field).toHaveValue("A\nB\nC");
  await field.focus();
  await field.evaluate((textarea: HTMLTextAreaElement) => textarea.setSelectionRange(2, 2));
  await field.press("Backspace");
  await expect(field).toHaveValue("AB\nC");
  await field.blur();
  const save = page.getByRole("button", { name: "Save active editor", exact: true });
  await save.click();
  await expect.poll(() => readProjectFile(page, path)).toEqual(bytesWith("AB\nC"));

  await field.press("ControlOrMeta+z");
  await expect(field).toHaveValue("A\nB\nC");
  await field.blur();
  await save.click();
  await expect.poll(() => readProjectFile(page, path)).toEqual(original);
});

test("two files that differ only in case are reported as a collision in a real case-sensitive project folder", async ({ page }) => {
  // OPFS is case-sensitive, so both spellings live side by side and the reference names neither.
  await openWorkbench(page, [{ path: "StatusE/Burn.STE", bytes: BURN }]);
  await openFile(page, "SpcMove", "fireball.spc");
  const editor = page.locator('[data-tkr-editor="Special move"]');
  await expect(editor.getByText("differ only in case")).toBeVisible();
  await expect(editor.getByRole("button", { name: "Open status effect" })).toBeDisabled();
  await expect(editor.getByText("Burn: 3 rounds")).toHaveCount(0);
  // The reference is untouched: the file still holds burn.ste and the form still holds it.
  expect(await readProjectFile(page, "SpcMove/fireball.spc")).toEqual(FIREBALL);
});

test("a value the field cannot hold is refused with its reason, is never saved, and is discarded on request", async ({ page }) => {
  await openWorkbench(page);
  await openFile(page, "SpcMove", "fireball.spc");
  const editor = page.locator('[data-tkr-editor="Special move"]');
  await retype(page, "Damage (FP)", "9999999999");
  await expect(editor.getByRole("alert")).toContainText("whole number from -2147483648 to 2147483647");
  // The refused text keeps its place and its reason; nothing is written behind the author's back.
  await page.getByRole("button", { name: "Save active editor", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("Nothing was saved");
  expect(await readProjectFile(page, "SpcMove/fireball.spc")).toEqual(FIREBALL);
  // Discarding it returns the field to the file's value and the file saves normally.
  await editor.getByRole("button", { name: "Discard the unapplied text" }).click();
  await expect(editor.getByLabel("Damage (FP)", { exact: true })).toHaveValue("12");
  await page.getByRole("button", { name: "Save active editor", exact: true }).click();
  await expect.poll(() => readProjectFile(page, "SpcMove/fireball.spc")).toEqual(FIREBALL);
});

test("leaving the page asks while a clean document holds text a field refused, and stops asking once it is discarded (#3385)", async ({ page }) => {
  await openWorkbench(page);
  await openFile(page, "SpcMove", "fireball.spc");
  const editor = page.locator('[data-tkr-editor="Special move"]');
  const asks = (): Promise<boolean> => page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(await asks(), "an untouched document lets the page go").toBe(false);
  await retype(page, "Damage (FP)", "9999999999");
  await expect(editor.getByRole("alert")).toContainText("whole number from -2147483648 to 2147483647");
  expect(await asks(), "the document is clean, but the refused text would be lost").toBe(true);
  await editor.getByRole("button", { name: "Discard the unapplied text" }).click();
  expect(await asks()).toBe(false);
});

test("hiding the second view retains its refused draft and keeps Save from writing around it", async ({ page }) => {
  await openWorkbench(page);
  await openFile(page, "SpcMove", "fireball.spc");
  await toggleSecondView(page);
  const mirror = page.locator("#mirror");
  const field = mirror.getByLabel("Damage (FP)", { exact: true });
  await field.fill("9999999999");
  await field.blur();
  await expect(mirror.getByRole("alert")).toContainText("whole number");
  await toggleSecondView(page);
  await expect(mirror).toBeHidden();
  const primary = page.locator('[data-tkr-editor="Special move"]');
  const damage = primary.getByLabel("Damage (FP)", { exact: true });
  await damage.fill("-30");
  await damage.blur();
  await page.getByRole("button", { name: "Save active editor", exact: true }).click();
  await expect(primary.getByRole("alert")).toContainText("Nothing was saved");
  expect(await readProjectFile(page, "SpcMove/fireball.spc")).toEqual(FIREBALL);
  await toggleSecondView(page);
  await expect(field).toHaveValue("9999999999");
  await expect(mirror.getByRole("alert")).toContainText("whole number");
});
