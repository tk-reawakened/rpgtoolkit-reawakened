import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { runSkinAuthoringProof, SKIN_PROOF_PATH, skinProofFiles } from "@tk-reawakened/editor-vscode-test/skin-proof";

// Story 14.2 (T-64, ADR 0045 option 3A) in the real browser host: the shipped editor page over an origin-private project
// folder. The scenario itself is shared with the VS Code workbench proof (tools/editor-vscode-test/skin-proof.ts).

interface ProofWindow extends Window {
  __tkrTestFolder?: FileSystemDirectoryHandle;
  __tkrDenyFileWrite?: (name: string) => void;
  __tkrAllowFileWrite?: (name: string) => void;
}

test.use({ actionTimeout: 10_000 });

async function readProjectFile(page: Page, path: string): Promise<Uint8Array> {
  return new Uint8Array(await page.evaluate(async (file) => {
    let handle = (window as ProofWindow).__tkrTestFolder!;
    const parts = file.split("/");
    for (const part of parts.slice(0, -1)) handle = await handle.getDirectoryHandle(part);
    return Array.from(new Uint8Array(await (await (await handle.getFileHandle(parts.at(-1)!)).getFile()).arrayBuffer()));
  }, path));
}

async function menuCommand(page: Page, name: "Undo" | "Redo"): Promise<void> {
  await page.getByRole("button", { name: "Application menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await page.getByRole("menuitem", { name: new RegExp(`^${name}(?:\\b|$)`) }).click();
}

test("the native skin editor chooses, previews, undoes, keeps a refused save's draft, saves and reopens window and button graphics", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const files = [
    { path: "Main/example.gam", bytes: [...readFileSync(new URL("../../../docs/spec/examples/game/Main/example.gam", import.meta.url))] },
    ...skinProofFiles().map((file) => ({ path: file.path, bytes: [...file.bytes] })),
  ];
  await page.addInitScript(async ({ inputs, name }) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
    for (const input of inputs) {
      let parent = root;
      const parts = input.path.split("/");
      for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part, { create: true });
      const writable = await (await parent.getFileHandle(parts.at(-1)!, { create: true })).createWritable();
      await writable.write(new Uint8Array(input.bytes));
      await writable.close();
    }
    // The project's own storage refusing a write: the browser's answer to a full disk or a revoked permission.
    const original = FileSystemFileHandle.prototype.createWritable;
    const denied = new Set<string>();
    Object.defineProperty(FileSystemFileHandle.prototype, "createWritable", {
      configurable: true,
      value: async function (this: FileSystemFileHandle, ...args: Parameters<typeof original>) {
        if (denied.has(this.name)) throw new DOMException("Permission denied", "NotAllowedError");
        return original.apply(this, args);
      },
    });
    (window as ProofWindow).__tkrDenyFileWrite = (target) => { denied.add(target); };
    (window as ProofWindow).__tkrAllowFileWrite = (target) => { denied.delete(target); };
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => root });
    (window as ProofWindow).__tkrTestFolder = root;
  }, { inputs: files, name: `TkrSkin-${randomUUID()}` });
  await page.goto("/tools/browser/editor-web/index.html");
  await page.waitForFunction(() => (window as ProofWindow).__tkrTestFolder !== undefined);
  await page.getByRole("button", { name: "Open project folder" }).click();
  await expect(page.getByLabel("Game title")).toBeVisible();

  const skinName = SKIN_PROOF_PATH.split("/").at(-1)!;
  const tab = page.getByRole("tab", { name: new RegExp(skinName.replace(".", "\\.")) });
  const editor = page.getByRole("main", { name: "Native skin authoring" });
  await runSkinAuthoringProof({
    expect,
    open: async () => {
      for (const part of SKIN_PROOF_PATH.split("/").slice(0, -1)) {
        const folder = page.getByRole("treeitem", { name: new RegExp(`^${part}, folder`) });
        await expect(folder).toBeVisible();
        if ((await folder.getAttribute("aria-expanded")) !== "true") await folder.dblclick();
      }
      await page.getByRole("treeitem", { name: new RegExp(`^${skinName.replace(".", "\\.")},`) }).dblclick();
      await expect(editor).toBeVisible();
      return editor;
    },
    close: async () => {
      await page.getByRole("button", { name: `Close ${SKIN_PROOF_PATH}`, exact: true }).click();
      await expect(tab).toHaveCount(0);
    },
    choose: async (view, role, file, decline = false) => {
      await view.getByRole("button", { name: `Choose ${role} graphic image…`, exact: true }).click();
      const picker = page.getByRole("dialog").last();
      await expect(picker).toBeVisible();
      await picker.getByRole("option", { name: file, exact: true }).click();
      await picker.getByRole("button", { name: `Use ${file}…`, exact: true }).click();
      const confirm = page.getByRole("dialog", { name: new RegExp(`^Use ${file.replace(".", "\\.")} for the skin's ${role} graphic\\?$`) });
      if (decline) {
        await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
        await picker.getByRole("button", { name: "Cancel", exact: true }).click();
      } else {
        await confirm.getByRole("button", { name: "Use it", exact: true }).click();
      }
      await expect(page.getByRole("dialog")).toHaveCount(0);
    },
    undo: () => menuCommand(page, "Undo"),
    redo: () => menuCommand(page, "Redo"),
    save: async () => { await page.getByRole("button", { name: "Save active editor", exact: true }).click(); },
    expectRefusalShown: async () => { await expect(page.getByText(/Could not save .*Permission denied/).first()).toBeVisible(); },
    expectDirty: async (dirty) => {
      if (dirty) await expect(tab).toHaveAccessibleName(/unsaved changes/);
      else await expect(tab).not.toHaveAccessibleName(/unsaved changes/);
    },
    read: (path) => readProjectFile(page, path),
    refuseSkinWrites: async (check) => {
      await page.evaluate((name) => (window as ProofWindow).__tkrDenyFileWrite!(name), skinName);
      try { await check(); } finally { await page.evaluate((name) => (window as ProofWindow).__tkrAllowFileWrite!(name), skinName); }
    },
    screenshot: async (name) => { await page.screenshot({ path: testInfo.outputPath(`${name}.png`) }); },
  });
});
