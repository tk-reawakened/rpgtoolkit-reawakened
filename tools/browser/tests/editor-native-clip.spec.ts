import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

interface ProofWindow extends Window { __clipFolder?: FileSystemDirectoryHandle }
test.use({ actionTimeout: 10_000 });

test("native clip editing preserves comments and changes only the selected property line", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const original = readFileSync(new URL("../../../docs/spec/examples/native/animation-clip/valid/sword-swing.tkranm", import.meta.url), "utf8");
  const main = [...readFileSync(new URL("../../../docs/spec/examples/game/Main/example.gam", import.meta.url))];
  await page.addInitScript(async ({ name, mainBytes, clip }) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
    for (const [folder, file, bytes] of [["Main", "example.gam", new Uint8Array(mainBytes)], ["Misc", "sword-swing.tkranm", new TextEncoder().encode(clip)]] as const) {
      const parent = await root.getDirectoryHandle(folder, { create: true });
      const writer = await (await parent.getFileHandle(file, { create: true })).createWritable();
      await writer.write(bytes); await writer.close();
    }
    (window as ProofWindow).__clipFolder = root;
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => root });
  }, { name: `TkrNativeClip-${randomUUID()}`, mainBytes: main, clip: original });
  await page.goto("/tools/browser/editor-web/index.html");
  await page.waitForFunction(() => (window as ProofWindow).__clipFolder !== undefined);
  await page.getByRole("button", { name: "Open project folder", exact: true }).click();
  await expect(page.getByLabel("Game title")).toBeVisible();
  const openClip = async () => {
    const folder = page.getByRole("treeitem", { name: /^Misc, folder/ });
    if (await folder.getAttribute("aria-expanded") !== "true") await folder.dblclick();
    await page.getByRole("treeitem", { name: /^sword-swing\.tkranm,/ }).dblclick();
    const editor = page.getByRole("main", { name: "Native animation clip" });
    await expect(editor).toBeVisible();
    return editor;
  };
  const editor = await openClip();
  await editor.getByLabel("Delay (seconds)").fill("0.1");
  await expect(editor.getByRole("status")).toContainText("not saved until you apply them");
  await expect(page.getByRole("button", { name: "Save active editor", exact: true })).toBeDisabled();
  await editor.getByRole("button", { name: "Discard unapplied changes" }).click();
  await expect(editor.getByLabel("Delay (seconds)")).toHaveValue("0.08");
  await editor.getByLabel("Delay (seconds)").fill("0.25");
  await editor.getByRole("button", { name: "Apply delay", exact: true }).click();
  await page.getByRole("button", { name: "Save active editor", exact: true }).click();
  const readSaved = () => page.evaluate(async () => {
    const root = (window as ProofWindow).__clipFolder!;
    const file = await (await (await root.getDirectoryHandle("Misc")).getFileHandle("sword-swing.tkranm")).getFile();
    return [...new Uint8Array(await file.arrayBuffer())];
  });
  await expect.poll(readSaved).toEqual([...new TextEncoder().encode(original.replace("delay: 0.08", "delay: 0.25"))]);
  await page.getByRole("button", { name: "Close Misc/sword-swing.tkranm", exact: true }).click();
  const reopened = await openClip();
  await expect(reopened.getByLabel("Delay (seconds)")).toHaveValue("0.25");
  await reopened.getByLabel("Delay (seconds)").fill("0.35");
  await reopened.getByRole("button", { name: "Apply delay", exact: true }).click();
  await page.evaluate(async (text) => {
    const root = (window as ProofWindow).__clipFolder!;
    const handle = await (await root.getDirectoryHandle("Misc")).getFileHandle("sword-swing.tkranm");
    const writer = await handle.createWritable();
    await writer.write(text);
    await writer.close();
  }, original.replace("delay: 0.08", "delay: 0.45"));
  await page.getByRole("button", { name: "Save active editor", exact: true }).click();
  await expect(reopened.getByRole("alert")).toBeVisible();
  await reopened.getByRole("button", { name: "Use the version on disk" }).click();
  await expect(reopened.getByLabel("Delay (seconds)")).toHaveValue("0.45");
  await page.screenshot({ path: testInfo.outputPath("native-clip.png") });
});
