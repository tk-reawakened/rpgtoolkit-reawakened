import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

// Story 13.16 (#1741) in a real browser: the reviewed script workflow on the standalone Monaco host. The author opens the
// application menu, picks **Format (reviewed)…**, chooses the whole project, sees what would change beside the original,
// then cancels — and the project's files are byte-identical. The same flow through the shared model is
// `tools/editor-vscode-test/test/script-workflow-hosts.test.ts`; the VS Code half of this proof is its multi-select list.
//
// The plan is made by the language server in its worker, so this also proves the page's server answers the request from
// the host's own project snapshot (an unassessed project would refuse every program instead of offering the review).

interface ProofWindow extends Window {
  __tkrTestFolder?: FileSystemDirectoryHandle;
}
interface PickerInput {
  readonly path: string;
  readonly bytes: readonly number[];
}

const PAGE = "/tools/browser/editor-web/index.html";
const MESSY = "Prg/messy.prg";
const OTHER = "Prg/other.prg";
const MESSY_TEXT = 'x! = 1\r\nIF (x == 1) {\r\nMWIN("Hello")\r\n}\r\n';
const OTHER_TEXT = 'mwin("second")\r\n';
const main = Array.from(readFileSync(new URL("../../../docs/spec/examples/game/Main/example.gam", import.meta.url)));

async function installProject(page: Page, files: readonly PickerInput[]): Promise<void> {
  const folderName = `TkrScript-${randomUUID()}`;
  await page.addInitScript(async ({ inputs, name }: { readonly inputs: readonly PickerInput[]; readonly name: string }) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
    for (const input of inputs) {
      const parts = input.path.split("/");
      let parent = root;
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
}

/** A project's program as the host stored it, as Latin-1 text (CRLF kept). */
const storedText = async (page: Page, path: string): Promise<string> => {
  const bytes = await page.evaluate(async (target) => {
    let handle: FileSystemDirectoryHandle = (window as ProofWindow).__tkrTestFolder!;
    const parts = target.split("/");
    for (const part of parts.slice(0, -1)) handle = await handle.getDirectoryHandle(part);
    const file = await (await handle.getFileHandle(parts.at(-1)!)).getFile();
    return Array.from(new Uint8Array(await file.arrayBuffer()));
  }, path);
  return Buffer.from(bytes).toString("latin1");
};

test.use({ trace: "retain-on-failure" });

test("the reviewed script workflow shows what would change in a real Monaco host and cancelling writes nothing (13.16)", async ({ page }) => {
  test.setTimeout(120_000);
  await installProject(page, [
    { path: "Main/example.gam", bytes: main },
    { path: MESSY, bytes: Array.from(Buffer.from(MESSY_TEXT, "latin1")) },
    { path: OTHER, bytes: Array.from(Buffer.from(OTHER_TEXT, "latin1")) },
  ]);
  await page.goto(PAGE);
  await page.waitForFunction(() => (window as ProofWindow).__tkrTestFolder !== undefined);
  await page.getByRole("button", { name: "Open project folder" }).click();
  await expect(page.getByLabel("Game title")).toBeVisible();

  // The application menu offers every workflow as an editor command (ADR 0038).
  await page.getByRole("button", { name: "Application menu" }).click();
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Format \(reviewed\)/ }).click();

  const dialog = page.locator(".tkr-script-workflow");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("You will see what would change in each program before anything is written");
  await dialog.getByLabel(/Every program in the project/).check();
  await dialog.getByRole("button", { name: "Check programs" }).click();

  // Only the program that would change is offered, with its comparison; the tidy one is reported as already fine.
  await expect(dialog.locator('.tkr-script-file[data-state="ready"] .tkr-script-file-name')).toHaveText(["messy.prg"]);
  await expect(dialog.locator('.tkr-script-file[data-state="unchanged"] .tkr-script-file-name')).toHaveText(["other.prg"]);
  await expect(dialog).toContainText("1 of 1 changed program is selected.");
  await expect(dialog).toContainText("1 already fine.");
  await dialog.locator(`button[title="${MESSY}"]`).click();
  const comparison = dialog.locator(".tkr-script-diff");
  await expect(comparison).toContainText("MWIN(\"Hello\")");
  await expect(comparison.locator('[data-change="added"]').filter({ hasText: 'mwin("Hello")' })).toHaveCount(1);
  await expect(comparison.locator('[data-change="removed"]').filter({ hasText: 'MWIN("Hello")' })).toHaveCount(1);
  await expect(dialog.getByRole("button", { name: "Apply to 1 program" })).toBeEnabled();

  // Cancel writes nothing: both programs are byte-identical, and no recovery group was recorded.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  expect(await storedText(page, MESSY)).toBe(MESSY_TEXT);
  expect(await storedText(page, OTHER)).toBe(OTHER_TEXT);
  const history = await page.evaluate(async () => {
    try {
      const historyFolder = await (window as ProofWindow).__tkrTestFolder!.getDirectoryHandle(".tkr-history");
      const groups = await historyFolder.getDirectoryHandle("groups");
      let count = 0;
      const names = groups.keys();
      for (let next = await names.next(); !next.done; next = await names.next()) count += 1;
      return count;
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") return 0;
      throw error;
    }
  });
  expect(history).toBe(0);
});
