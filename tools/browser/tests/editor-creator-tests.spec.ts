import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { rasterize, type AssetKey, type DrawList, type RasterAsset, type RasterSurfaces } from "@tk-reawakened/core";
import { CREATOR_TEST_ACTOR_RGB, CREATOR_TEST_CASE_NAME, CREATOR_TEST_SPEC_PATH, createCreatorTestFiles } from "@tk-reawakened/editor-vscode-test";
import { isIgnoredProjectPath, runCreatorSpecs, type CreatorFrameObservation, type SpecProjectFile } from "@tk-reawakened/script-spec";

const PAGE = "/tools/browser/editor-web/index.html";
const MAIN = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/game/Main/example.gam", import.meta.url)));
const SEED = 17;

/** Real OPFS handles are structured-cloned into the production recent-project registry; no picker or host is replaced. */
async function rememberProject(page: Page, id: string, files: readonly SpecProjectFile[]): Promise<void> {
  await page.evaluate(async ({ id, files }) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(id, { create: true });
    for (const file of files) {
      const parts = file.path.split("/");
      const name = parts.pop();
      if (name === undefined) throw new Error("The authored fixture has no file name.");
      let folder = root;
      for (const part of parts) folder = await folder.getDirectoryHandle(part, { create: true });
      const writer = await (await folder.getFileHandle(name, { create: true })).createWritable();
      await writer.write(new Uint8Array(file.bytes));
      await writer.close();
    }
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("tkr-editor-projects", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("projects", { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction("projects", "readwrite");
        transaction.objectStore("projects").put({ id, name: "Creator proof", root, lastOpened: Date.now() });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }, { id, files: files.map((file) => ({ path: file.path, bytes: Array.from(file.bytes) })) });
  await page.reload();
  await page.locator("#recent-project").selectOption(id);
  await page.getByRole("button", { name: "Reopen project", exact: true }).click();
  await expect(page.locator("#settings").getByRole("button", { name: /^\W*Tests$/ })).toBeVisible();
}

/** Independently read the real saved project, including any bookkeeping the production host has persisted. */
async function savedInventory(page: Page, project: string): Promise<readonly SpecProjectFile[]> {
  const files = await page.evaluate(async (project) => {
    const files: { path: string; bytes: number[] }[] = [];
    const visit = async (directory: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
      for await (const [name, entry] of directory.entries()) {
        const path = prefix + name;
        if (entry.kind === "directory") await visit(entry as FileSystemDirectoryHandle, `${path}/`);
        else files.push({ path, bytes: Array.from(new Uint8Array(await (await (entry as FileSystemFileHandle).getFile()).arrayBuffer())) });
      }
    };
    await visit(await (await navigator.storage.getDirectory()).getDirectoryHandle(project), "");
    return files;
  }, project);
  return files.filter((file) => !isIgnoredProjectPath(file.path)).map((file) => ({ path: file.path, bytes: new Uint8Array(file.bytes) }));
}

function expectedRun(files: readonly SpecProjectFile[], project: string, ok: boolean) {
  let observed: CreatorFrameObservation | undefined;
  const report = runCreatorSpecs(files, { project, seed: SEED, strict: true, name: CREATOR_TEST_CASE_NAME, onFrame: (frame) => { observed = frame; } });
  const result = report.files.flatMap((file) => file.cases).find((item) => item.name === CREATOR_TEST_CASE_NAME);
  if (result === undefined || result.ok !== ok || result.run === undefined) {
    throw new Error(`The real Node fixture did not produce the expected case: ${JSON.stringify(report)}`);
  }
  const frame = observed as CreatorFrameObservation | undefined;
  if (frame === undefined) throw new Error("The real Node fixture emitted no engine frame.");
  const assets = new Map<AssetKey, RasterAsset>();
  const cachedAsset = assets.get.bind(assets);
  assets.get = (key) => {
    const cached = cachedAsset(key);
    if (cached !== undefined) return cached;
    const loaded = frame.picturePixels(key) ?? frame.assetBytes(key);
    if (loaded !== null) assets.set(key, loaded);
    return loaded ?? undefined;
  };
  const surfaces: RasterSurfaces = new Map();
  surfaces.get = (id, revision?: number) => revision === undefined ? undefined : frame.surfacePixels(id, revision) ?? undefined;
  const pixels = rasterize(frame.drawList as DrawList, assets, surfaces);
  if (pixels.error !== null) throw new Error(`The reference frame could not be rasterized: ${pixels.error}`);
  return { report, result, run: result.run, frame: { tick: frame.tick, width: pixels.width, height: pixels.height, sha256: createHash("sha256").update(pixels.rgba).digest("hex") } };
}


async function verifyVisible(tests: Locator, expected: ReturnType<typeof expectedRun>): Promise<Locator> {
  const heading = tests.getByRole("heading", { name: `${expected.result.ok ? "Pass" : "Fail"}: ${CREATOR_TEST_CASE_NAME}`, exact: true });
  await expect(heading).toBeVisible();
  const item = heading.locator("xpath=..");
  await expect(item.locator("p").filter({ hasText: "Final state hash:" }).locator("code")).toHaveText(expected.result.stateHash);
  const snapshot = JSON.parse(await item.locator("details").filter({ hasText: "Saved run snapshot and fixture" }).locator("pre").textContent() ?? "null") as unknown;
  expect(snapshot).toEqual(expected.run.snapshot);
  const consumed = JSON.parse(await item.locator("details").filter({ hasText: "Consumed input, checkpoints and loaded files" }).locator("pre").textContent() ?? "null") as unknown;
  expect(consumed).toEqual({ actionLog: expected.run.actionLog, checkpoints: expected.run.checkpoints, loaded: expected.run.loaded, ticks: expected.run.ticks });
  const sources = JSON.parse(await tests.locator("details").filter({ hasText: "Saved file revisions supplied to the framework" }).locator("pre").textContent() ?? "null") as unknown;
  expect(sources).toEqual(expected.report.sources);
  await expect(tests.getByRole("alert")).toHaveCount(0);
  await expect(async () => {
    const actualPixels = await tests.getByLabel("Last real fixture engine frame").evaluate(async (element, palette) => {
      const canvas = element as HTMLCanvasElement;
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("The actual saved-test canvas has no 2D context.");
      const bytes = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const keys = palette.map((colour) => colour.split(",").reduce((key, channel) => (key << 8) | Number(channel), 0));
      const counts = new Map(keys.map((key) => [key, 0]));
      for (let index = 0; index < bytes.length; index += 4) {
        const key = (bytes[index]! << 16) | (bytes[index + 1]! << 8) | bytes[index + 2]!;
        const count = counts.get(key);
        if (count !== undefined && bytes[index + 3] !== 0) counts.set(key, count + 1);
      }
      return {
        width: canvas.width, height: canvas.height,
        sha256: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
        colours: palette.map((colour, index) => ({ colour, pixels: counts.get(keys[index]!) ?? 0 })),
      };
    }, Object.values(CREATOR_TEST_ACTOR_RGB), { timeout: 1_000 });
    expect(actualPixels).toMatchObject({ width: expected.frame.width, height: expected.frame.height, sha256: expected.frame.sha256 });
    for (const colour of actualPixels.colours) expect(colour.pixels, `The normal engine actor's ${colour.colour} pixels must be visible, not just a matching flat background.`).toBeGreaterThan(0);
  }).toPass({ intervals: [100, 200, 400], timeout: 5_000 });
  await expect(tests.locator("figcaption")).toContainText(`at tick ${expected.frame.tick}.`);
  return item;
}

test("saved creator tests use the real engine, save Monaco edits, retain reports and jump to the owning failure under strict CSP", async ({ page }, testInfo) => {
  const project = `creator-${randomUUID()}`;
  const fixture = createCreatorTestFiles();
  const passFiles = [{ path: "Main/example.gam", bytes: MAIN }, ...fixture];
  const errors: string[] = [];
  const csp: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (/violates.*content security policy|refused to.*(?:script|worker)/i.test(message.text())) csp.push(message.text()); });
  await page.goto(PAGE);
  await rememberProject(page, project, passFiles);
  // The run setup form's launch tabs move with the keyboard (End, Home, and Left wrapping round).
  await page.getByRole("button", { name: "New run setup", exact: true }).click();
  const form = page.getByRole("dialog", { name: "New run setup" });
  const game = form.getByRole("tab", { name: "Run game", exact: true });
  const program = form.getByRole("tab", { name: "Test program", exact: true });
  await game.focus();
  await game.press("End");
  await expect(program).toBeFocused();
  await expect(program).toHaveAttribute("aria-selected", "true");
  await program.press("Home");
  await expect(game).toBeFocused();
  await game.press("ArrowLeft");
  await expect(program).toBeFocused();
  await form.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(form).toHaveCount(0);
  // Saved tests are their own section of the left sidebar, folded until opened (ADR 0022 D8.7, D9).
  const testsToggle = page.getByRole("button", { name: /^\W*Tests$/ });
  await expect(testsToggle).toHaveAttribute("aria-expanded", "false");
  await testsToggle.click();
  await expect(testsToggle).toHaveAttribute("aria-expanded", "true");
  const tests = page.getByRole("region", { name: "Saved RPGCode tests" });
  await tests.getByRole("spinbutton", { name: "Seed", exact: true }).fill(String(SEED));
  await tests.getByRole("textbox", { name: "Case name contains" }).fill(CREATOR_TEST_CASE_NAME);
  await tests.getByRole("button", { name: "Run saved tests", exact: true }).click();
  await expect(tests.getByRole("status")).toHaveText("Passed: 1 passing cases, 0 failing cases, 0 skipped cases.");
  const passExpected = expectedRun(await savedInventory(page, project), project, true);
  await verifyVisible(tests, passExpected);

  // Report ownership is the project, not the mounted Tests section: hiding the sidebar unmounts it.
  const shelfToggle = page.getByRole("button", { name: "Collapse left sidebar", exact: true });
  await expect(shelfToggle).toHaveAttribute("aria-pressed", "true");
  const expandedMarker = await shelfToggle.evaluate((element) => {
    const marker = getComputedStyle(element, "::after");
    const rgba = (value: string) => value.match(/[\d.]+/g)?.map(Number) ?? [];
    let parent = element.parentElement;
    while (parent !== null && (rgba(getComputedStyle(parent).backgroundColor)[3] ?? 1) === 0) parent = parent.parentElement;
    if (parent === null) throw new Error("Shelf marker has no measurable adjacent surface");
    const luminance = (value: string) => {
      const rgb = rgba(value);
      if (rgb.length < 3) throw new Error(`Unmeasurable shelf color: ${value}`);
      const linear = (channel: number) => {
        const normalized = channel / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      return linear(rgb[0]!) * 0.2126 + linear(rgb[1]!) * 0.7152 + linear(rgb[2]!) * 0.0722;
    };
    const ink = luminance(marker.backgroundColor);
    const background = luminance(getComputedStyle(parent).backgroundColor);
    return { content: marker.content, display: marker.display, color: marker.backgroundColor, height: marker.height, contrast: (Math.max(ink, background) + 0.05) / (Math.min(ink, background) + 0.05) };
  });
  expect(expandedMarker.content).not.toBe("none");
  expect(expandedMarker.display).not.toBe("none");
  expect(expandedMarker.color).not.toBe("rgba(0, 0, 0, 0)");
  expect(parseFloat(expandedMarker.height)).toBeGreaterThan(0);
  expect(expandedMarker.contrast).toBeGreaterThanOrEqual(3);
  await shelfToggle.click();
  await expect(tests).toHaveCount(0);
  const collapsedToggle = page.getByRole("button", { name: "Expand left sidebar", exact: true });
  await expect(collapsedToggle).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => collapsedToggle.evaluate((element) => getComputedStyle(element, "::after").content)).toBe("none");
  await collapsedToggle.click();
  await testsToggle.click();
  await verifyVisible(tests, passExpected);
  await tests.getByRole("spinbutton", { name: "Seed", exact: true }).fill(String(SEED));
  await tests.getByRole("textbox", { name: "Case name contains" }).fill(CREATOR_TEST_CASE_NAME);

  // Open the owning actual document, edit through Monaco, and let the run's ordinary save barrier persist it.
  await tests.getByRole("button", { name: CREATOR_TEST_SPEC_PATH, exact: true }).click();
  const input = page.getByRole("textbox", { name: /^Program text/ });
  await expect(page.locator("#settings .monaco-editor:visible .view-lines")).toBeVisible();
  // Pause one real OPFS read after Save All and type into the real Monaco surface before releasing it.
  await page.evaluate(() => {
    const state = window as Window & { creatorReadGate?: { reached: boolean; release: () => void } };
    const original = FileSystemFileHandle.prototype.getFile;
    let release = (): void => {};
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const gate = { reached: false, release: () => { FileSystemFileHandle.prototype.getFile = original; release(); } };
    state.creatorReadGate = gate;
    FileSystemFileHandle.prototype.getFile = async function () {
      const file = await original.call(this);
      if (this.name === "wall.spec.prg" && !gate.reached) {
        gate.reached = true;
        await blocked;
      }
      return file;
    };
  });
  await tests.getByRole("button", { name: "Run saved tests", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as Window & { creatorReadGate?: { reached: boolean } }).creatorReadGate?.reached)).toBe(true);
  await input.focus();
  await page.keyboard.insertText(" ");
  await page.evaluate(() => {
    if ("creatorReadGate" in window && typeof window.creatorReadGate === "object" && window.creatorReadGate !== null && "release" in window.creatorReadGate && typeof window.creatorReadGate.release === "function") window.creatorReadGate.release();
  });
  await expect(tests.getByRole("alert")).toContainText("changed while saved test files were being read");
  await expect(tests.getByRole("heading", { name: /^Pass:|^Fail:/ })).toHaveCount(0);

  const failedFixture = createCreatorTestFiles({ failWall: true });
  const failedSpec = failedFixture.find((file) => file.path === CREATOR_TEST_SPEC_PATH);
  if (failedSpec === undefined) throw new Error("The authored failure fixture omitted its source.");
  const failedSource = new TextDecoder().decode(failedSpec.bytes);
  await input.focus();
  await page.keyboard.press("Backspace");
  const wallAssertion = page.locator("#settings .monaco-editor:visible .view-line").filter({ hasText: 'expect(specValue("player.tileX"))' });
  await wallAssertion.click();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText("3");
  await tests.getByRole("button", { name: "Run saved tests", exact: true }).click();
  await expect(tests.getByRole("status")).toHaveText("Failed: 0 passing cases, 1 failing cases, 0 skipped cases.");
  const failedExpected = expectedRun(await savedInventory(page, project), project, false);
  const failed = await verifyVisible(tests, failedExpected);
  const stored = await page.evaluate(async ({ project, path }) => {
    let folder = await (await navigator.storage.getDirectory()).getDirectoryHandle(project);
    const parts = path.split("/");
    const name = parts.pop();
    if (name === undefined) throw new Error("The saved source has no name.");
    for (const part of parts) folder = await folder.getDirectoryHandle(part);
    return Array.from(new Uint8Array(await (await (await folder.getFileHandle(name)).getFile()).arrayBuffer()));
  }, { project, path: CREATOR_TEST_SPEC_PATH });
  expect(new Uint8Array(stored)).toEqual(failedSpec.bytes);
  const row = failed.locator('tr[data-outcome="fail"]');
  await expect(row.locator("td").nth(2)).toHaveText("3");
  await expect(row.locator("td").nth(3)).toHaveText("2");
  await expect(row.locator("td").nth(5)).toContainText("after right for 60 ticks");
  const source = row.getByRole("button");
  const location = await source.getAttribute("title");
  const line = failedSource.split("\n").findIndex((text) => text.includes('expect(specValue("player.tileX"))')) + 1;
  expect(location).toMatch(new RegExp(`:${line}:\\d+$`));
  await page.locator("#settings .monaco-editor:visible .view-line").first().click();
  await page.keyboard.press("Home");
  await source.click();
  const assertion = page.locator("#settings .monaco-editor:visible .view-line").filter({ hasText: 'expect(specValue("player.tileX"))' });
  await expect(assertion).toBeVisible();
  await expect.poll(async () => {
    const lineTop = await assertion.evaluate((element) => element.getBoundingClientRect().top);
    const caretTop = await page.locator("#settings .monaco-editor:visible .cursors-layer .cursor").first().evaluate((element) => element.getBoundingClientRect().top);
    return Math.abs(lineTop - caretTop);
  }, { intervals: [100, 200, 400], message: "The actual Monaco caret must land on the owning wall assertion, not merely echo a requested line." }).toBeLessThan(2);
  await testInfo.attach("saved-tests-real-engine-frame", { body: await tests.getByLabel("Last real fixture engine frame").screenshot(), contentType: "image/png" });

  // An included helper owns its assertion location; the source link must open
  // that real file, not the enclosing spec at the helper's line number.
  const helperPath = ".tkr-tests/Prg/Misc/helper.prg";
  const helperSource = ["function includedFailure() {", "  local(value)", "  expect(1).toBe(2)", "}"].join("\n");
  const includedSpec = [
    '#include "Misc/helper.prg"',
    'specFixture({ board: "Boards/wall.brd", party: { length: 1, "0": "Chrs/Hero.tem" }, x: 1, y: 2, facing: "E" })',
    'it("included program failure", () => {',
    "  includedFailure()",
    "})",
  ].join("\n");
  await page.evaluate(async ({ project, helperSource, includedSpec }) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(project);
    const testsDir = await root.getDirectoryHandle(".tkr-tests");
    const programs = await testsDir.getDirectoryHandle("Prg");
    const misc = await programs.getDirectoryHandle("Misc", { create: true });
    for (const [directory, name, contents] of [[misc, "helper.prg", helperSource], [programs, "included.spec.prg", includedSpec]] as const) {
      const writer = await (await directory.getFileHandle(name, { create: true })).createWritable();
      await writer.write(contents);
      await writer.close();
    }
  }, { project, helperSource, includedSpec });
  await tests.getByRole("textbox", { name: "Case name contains" }).fill("included program failure");
  await tests.getByRole("button", { name: "Run saved tests", exact: true }).click();
  await expect(tests.getByRole("status")).toHaveText("Failed: 0 passing cases, 1 failing cases, 0 skipped cases.");
  const included = tests.locator('tr[data-outcome="fail"]').getByRole("button");
  await expect(included).toHaveAttribute("title", new RegExp(`^${helperPath.replaceAll(".", "\\.")}:3:\\d+$`));
  await included.click();
  const helperLine = page.locator("#settings .monaco-editor:visible .view-line").filter({ hasText: "expect(1).toBe(2)" });
  await expect(helperLine).toBeVisible();
  await expect.poll(async () => {
    const lineTop = await helperLine.evaluate((element) => element.getBoundingClientRect().top);
    const caretTop = await page.locator("#settings .monaco-editor:visible .cursors-layer .cursor").first().evaluate((element) => element.getBoundingClientRect().top);
    return Math.abs(lineTop - caretTop);
  }, { intervals: [100, 200, 400], message: "The caret must navigate into the included helper at its assertion." }).toBeLessThan(2);
  expect(csp).toEqual([]);
  expect(errors).toEqual([]);
});
