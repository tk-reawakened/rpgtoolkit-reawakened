/** Real editor state evidence. Gates pause native File System Access calls; they never substitute a provider or model result. */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect } from "@playwright/test";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function snapshot(page, output, state, details) {
  await mkdir(output, { recursive: true });
  const record = { state, file: `state-${state}.png`, viewport: page.viewportSize(), status: await page.getByRole("status").allTextContents(), ...details };
  await page.screenshot({ path: join(output, record.file) });
  await delay(100);
  await writeFile(join(output, `state-${state}.json`), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}
async function backingBytes(page) {
  return Buffer.from(await page.evaluate(async () => {
    const root = Reflect.get(window, "__tkrDesignFolder");
    if (root === undefined) throw new Error("Owned OPFS project is missing");
    const main = await root.getDirectoryHandle("Main");
    const file = await main.getFileHandle("example.gam");
    return Array.from(new Uint8Array(await (await file.getFile()).arrayBuffer()));
  }));
}
async function editTitle(page, text) {
  const editor = page.locator(".tkr-editor-pane:visible");
  const title = editor.getByLabel("Game title", { exact: true });
  await title.click();
  await title.press("ControlOrMeta+a");
  await page.keyboard.type(text);
  await editor.getByRole("button", { name: "Apply changes", exact: true }).click();
  await expect(editor.locator(".tkr-settings-state")).toHaveText("Unsaved changes");
  await editor.locator(".tkr-settings-state").scrollIntoViewIfNeeded();
}

export async function captureOpeningStates(page, output) {
  const records = [await snapshot(page, output, "empty-project", { owner: "No project or document is open", presentation: "current shipping dark styles" })];
  await page.evaluate(() => {
    const original = FileSystemFileHandle.prototype.getFile;
    let release;
    let armed = true;
    const gate = new Promise((resolve) => { release = resolve; });
    Reflect.set(window, "__designReleaseLoading", () => { armed = false; FileSystemFileHandle.prototype.getFile = original; release(); });
    FileSystemFileHandle.prototype.getFile = async function () {
      if (armed && this.name === "example.gam") {
        armed = false;
        Reflect.set(window, "__designLoadingEntered", true);
        await gate;
      }
      return original.call(this);
    };
  });
  try {
    await page.getByRole("button", { name: "Open project folder", exact: true }).click();
    await page.getByLabel("Game in project").selectOption("Main/example.gam");
    await page.getByRole("button", { name: "Open selected game", exact: true }).click();
    await page.waitForFunction(() => Reflect.get(window, "__designLoadingEntered") === true, undefined, { timeout: 5_000, polling: 100 });
    records.push(await snapshot(page, output, "loading-project", { owner: "Project opening; native Main/example.gam read is paused", hostStatus: await page.locator("#host-status").innerText(), presentation: "current shipping dark styles; real native read resumes afterward" }));
  } finally {
    await page.evaluate(() => Reflect.get(window, "__designReleaseLoading")()).catch((error) => console.error("Could not release owned loading gate:", error));
  }
  return records;
}

export async function captureDocumentStates(page, output, externalMainBytes) {
  await page.getByRole("tab", { name: "Main/example.gam", exact: true }).click();
  const editor = page.locator(".tkr-editor-pane:visible");
  const title = editor.getByLabel("Game title", { exact: true });
  await expect(title).toBeVisible();
  const originalTitle = await title.inputValue();
  const originalHash = sha256(await backingBytes(page));
  const records = [];
  await editTitle(page, "Design validation saved title");
  expect(sha256(await backingBytes(page))).toBe(originalHash);
  records.push(await snapshot(page, output, "dirty", { owner: "Main/example.gam active document", backingSha256: originalHash, presentation: "candidate dark common roles; actual unsaved edit" }));

  await page.evaluate(() => {
    const original = FileSystemFileHandle.prototype.createWritable;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    Reflect.set(window, "__designReleaseSaving", () => { FileSystemFileHandle.prototype.createWritable = original; release(); });
    FileSystemFileHandle.prototype.createWritable = async function (options) {
      if (this.name === "example.gam") {
        FileSystemFileHandle.prototype.createWritable = original;
        Reflect.set(window, "__designSavingEntered", true);
        await gate;
      }
      return original.call(this, options);
    };
  });
  try {
    await page.getByRole("button", { name: "Save active editor", exact: true }).click();
    await page.waitForFunction(() => Reflect.get(window, "__designSavingEntered") === true, undefined, { timeout: 5_000, polling: 100 });
    await expect(editor.locator(".tkr-settings-state")).toHaveText("Saving…");
    expect(sha256(await backingBytes(page))).toBe(originalHash);
    records.push(await snapshot(page, output, "saving", { owner: "Main/example.gam active document; actual native write is paused", backingSha256: originalHash, presentation: "candidate dark common roles; no fabricated save result" }));
  } finally {
    await page.evaluate(() => Reflect.get(window, "__designReleaseSaving")()).catch((error) => console.error("Could not release owned save gate:", error));
  }
  await expect(editor.locator(".tkr-settings-state")).toHaveText("All changes saved");
  const savedHash = sha256(await backingBytes(page));
  expect(savedHash).not.toBe(originalHash);
  records.push(await snapshot(page, output, "saved", { owner: "Main/example.gam active document", backingSha256: savedHash, presentation: "candidate dark common roles; actual native write completed" }));

  // Revert a new draft so the saved value is read back from storage, not merely echoed by the edited model.
  await editTitle(page, "Discard this readback-control draft");
  await page.getByRole("button", { name: "Application menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: /Revert Active Document/i }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Revert", exact: true }).click();
  await expect(title).toHaveValue("Design validation saved title");
  expect(sha256(await backingBytes(page))).toBe(savedHash);

  await editTitle(page, "Retained failed-write draft");
  await page.evaluate(async () => {
    const root = Reflect.get(window, "__tkrDesignFolder");
    const file = await (await root.getDirectoryHandle("Main")).getFileHandle("example.gam");
    const original = FileSystemFileHandle.prototype.createWritable;
    const lock = await file.createWritable({ keepExistingData: true, mode: "exclusive" });
    Reflect.set(window, "__designReleaseWriteLock", async () => {
      FileSystemFileHandle.prototype.createWritable = original;
      await lock.abort();
    });
    FileSystemFileHandle.prototype.createWritable = async function (options) {
      try {
        return await original.call(this, options);
      } catch (error) {
        if (this.name === "example.gam") Reflect.set(window, "__designNativeWriteError", { name: error.name, message: error.message });
        throw error;
      }
    };
  });
  try {
    await page.getByRole("button", { name: "Save active editor", exact: true }).click();
    await page.waitForFunction(() => Reflect.get(window, "__designNativeWriteError")?.name === "NoModificationAllowedError", undefined, { timeout: 5_000, polling: 100 });
    const failure = editor.locator(".tkr-settings-error");
    await expect(failure).toBeVisible();
    await expect(editor.locator(".tkr-settings-state")).toHaveText("Unsaved changes");
    await expect(title).toHaveValue("Retained failed-write draft");
    expect(sha256(await backingBytes(page))).toBe(savedHash);
    await failure.scrollIntoViewIfNeeded();
    records.push(await snapshot(page, output, "write-failed", { owner: "Main/example.gam retained draft; another actual native writer owns an exclusive lock", nativeError: await page.evaluate(() => Reflect.get(window, "__designNativeWriteError")), message: await failure.innerText(), backingSha256: savedHash, presentation: "candidate dark common roles; real native lock rejection, not an injected provider error" }));
  } finally {
    await page.evaluate(() => Reflect.get(window, "__designReleaseWriteLock")());
  }
  await page.getByRole("button", { name: "Save active editor", exact: true }).click();
  await expect(editor.locator(".tkr-settings-state")).toHaveText("All changes saved");
  expect(sha256(await backingBytes(page))).not.toBe(savedHash);
  const recoveredHash = sha256(await backingBytes(page));
  await editTitle(page, "Discard post-failure readback control");
  await page.getByRole("button", { name: "Application menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: /Revert Active Document/i }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Revert", exact: true }).click();
  await expect(title).toHaveValue("Retained failed-write draft");
  expect(sha256(await backingBytes(page))).toBe(recoveredHash);

  await editTitle(page, "Retained unsaved draft");
  await page.evaluate(async (bytes) => {
    const root = Reflect.get(window, "__tkrDesignFolder");
    const main = await root.getDirectoryHandle("Main");
    const file = await main.getFileHandle("example.gam");
    const writer = await file.createWritable();
    await writer.write(new Uint8Array(bytes));
    await writer.close();
  }, Array.from(externalMainBytes));
  const outsideHash = sha256(externalMainBytes);
  expect(sha256(await backingBytes(page))).toBe(outsideHash);
  await page.getByRole("button", { name: "Save active editor", exact: true }).click();
  const conflict = page.getByRole("group", { name: "Changed on disk", exact: true });
  await expect(conflict).toBeVisible();
  await conflict.scrollIntoViewIfNeeded();
  await expect(title).toHaveValue("Retained unsaved draft");
  expect(sha256(await backingBytes(page))).toBe(outsideHash);
  records.push(await snapshot(page, output, "save-refused", { owner: "Main/example.gam draft versus actual external disk version", backingSha256: outsideHash, presentation: "candidate dark common roles; real changed-on-disk refusal preserves both versions" }));
  await conflict.getByRole("button", { name: "Use the version on disk", exact: true }).click();
  await expect(editor.locator(".tkr-settings-state")).toHaveText("All changes saved");

  const history = page.getByRole("region", { name: "Document history", exact: true });
  const show = page.getByRole("button", { name: "Show History panel", exact: true });
  if (await show.isVisible()) await show.click();
  await expect(history).toBeVisible();
  const checkpoint = history.locator("ol[aria-label='History entries'] button").filter({ hasText: "checkpoint" });
  await expect(checkpoint).toHaveCount(1);
  await checkpoint.click();
  const previewTitle = history.locator(".tkr-history-preview-editor").getByLabel("Game title", { exact: true });
  await expect(previewTitle).toHaveValue(originalTitle);
  await expect(previewTitle).toBeDisabled();
  await previewTitle.scrollIntoViewIfNeeded();
  await expect(previewTitle).toBeInViewport();
  expect(sha256(await backingBytes(page))).toBe(outsideHash);
  records.push(await snapshot(page, output, "read-only-preview", { owner: "History checkpoint preview, separate from active Main/example.gam", previewTitle: await previewTitle.inputValue(), backingSha256: outsideHash, presentation: "candidate dark common roles; real read-only saved-version document; preview writes nothing" }));

  await page.getByRole("button", { name: "New board…", exact: true }).click();
  const proposal = page.getByRole("dialog", { name: "New board", exact: true });
  await proposal.getByLabel("Name", { exact: true }).fill("design-validation-unused");
  await proposal.getByLabel("Width in tiles").fill("2");
  await proposal.getByLabel("Height in tiles").fill("2");
  await proposal.getByLabel("Layers", { exact: true }).fill("1");
  const create = proposal.getByRole("button", { name: "Create board", exact: true });
  await expect(create).toBeEnabled();
  const width = proposal.getByLabel("Width in tiles");
  await width.fill("0");
  await expect(width).toHaveAttribute("aria-invalid", "true");
  const validity = await width.evaluate((input) => ({ value: input.value, valid: input.validity.valid, message: input.validationMessage }));
  expect(validity.valid).toBe(false);
  await create.click();
  await expect(proposal).toBeVisible();
  await expect(proposal.getByRole("alert")).toHaveText("The width must be a whole number from 1 to 1000.");
  records.push(await snapshot(page, output, "validation", { owner: "New board proposal; no document has been created", width: validity, alerts: await proposal.getByRole("alert").allTextContents(), presentation: "candidate dark common roles; native constraint validation and associated inline feedback reject a zero-width proposal" }));
  await proposal.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(sha256(await backingBytes(page))).toBe(outsideHash);
  return records;
}
