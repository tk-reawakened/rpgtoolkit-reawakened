import { createHash } from "node:crypto";
import type { expect as playwrightExpect, Frame, Page } from "@playwright/test";
import { CREATOR_TEST_ACTOR_RGB, CREATOR_TEST_BOARD_PATH, CREATOR_TEST_CASE_NAME, CREATOR_TEST_SPEC_PATH, createCreatorTestFiles } from "./creator-tests-fixture.mjs";
import { BinaryReader, rasterize, readBoard, writeBoard, type AssetKey, type DecodedTexture, type DrawList, type RasterAsset, type RasterSurfaces, type SurfaceId } from "@tk-reawakened/core";
import type { CreatorFrameObservation } from "@tk-reawakened/script-spec";
const HERO_VISIBLE_RGB: Record<string, true> = {
  [CREATOR_TEST_ACTOR_RGB.tunic]: true,
  [CREATOR_TEST_ACTOR_RGB.head]: true,
  [CREATOR_TEST_ACTOR_RGB.legs]: true,
  [CREATOR_TEST_ACTOR_RGB.eyes]: true,
};

type Expect = typeof playwrightExpect;
type File = { readonly path: string; readonly bytes: Uint8Array };
type Case = {
  readonly name: string;
  readonly ok: boolean;
  readonly stateHash: string;
  readonly outcomes: readonly { readonly kind: string; readonly expected: string; readonly actual: string; readonly sourcePath: string; readonly line: number; readonly column: number; readonly context?: { readonly tick: number; readonly lastAction: null | { readonly action: string; readonly ticks: number; readonly completedTick: number }; readonly board: string | null } }[];
  readonly run?: { readonly snapshot: unknown; readonly actionLog: readonly unknown[]; readonly checkpoints: readonly { readonly tick: number; readonly stateHash: string }[] };
};
type Report = { readonly files: readonly { readonly file: string; readonly cases: readonly Case[] }[]; readonly sources: readonly { readonly path: string; readonly revision: string | null }[] };
type CreatorRunner = (files: readonly File[], options: { readonly seed: number; readonly name: string; readonly onFrame: (frame: CreatorFrameObservation) => void }) => Report;
type ReferenceFrame = { readonly tick: number; readonly width: number; readonly height: number; readonly pixelHash: string };
type CreatorProofHost = {
  readonly readBacking: (path: string) => Promise<Uint8Array>;
  readonly writeBacking: (path: string, bytes: Uint8Array) => Promise<void>;
  readonly withBackingWriteRefused: (path: string, check: () => Promise<void>) => Promise<void>;
  readonly readHostEvents: () => readonly { readonly kind: string; readonly value: string }[];
  readonly pauseSave: () => void;
  readonly resumeSave: () => void;
};
export async function runVscodeCreatorTestsProof(
  page: Page,
  expect: Expect,
  workbenchUrl: string,
  runCreatorSpecs: CreatorRunner,
  host: CreatorProofHost,
): Promise<void> {
  const seed = 17;
  const passFiles = createCreatorTestFiles();
  const passHeadless = runHeadlessCase(runCreatorSpecs, passFiles, seed, true);
  const passExpected = passHeadless.result;
  await page.goto(workbenchUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".monaco-workbench")).toBeVisible();
  await runPaletteCommand(page, expect, "RPG Toolkit: Run saved tests");
  const tests = await creatorTestsFrame(page, expect);
  const policy = await tests.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  const directives = new Map((policy ?? "").split(";").map((directive) => {
    const [name, ...values] = directive.trim().split(/\s+/);
    return [name ?? "", values.join(" ")] as const;
  }));
  if (directives.get("default-src") !== "'none'"
    || !/^'nonce-[a-f0-9]{36}'$/.test(directives.get("script-src") ?? "")
    || /\b(?:unsafe-eval|wasm-unsafe-eval|unsafe-inline)\b/i.test(policy ?? "")) {
    throw new Error(`The saved-tests webview CSP is missing its nonce-only script policy or allows unsafe execution: ${policy}`);
  }
  await tests.getByRole("spinbutton", { name: "Seed" }).fill(String(seed));
  await tests.getByRole("textbox", { name: "Case name contains" }).fill(CREATOR_TEST_CASE_NAME);
  await tests.getByRole("button", { name: "Run saved tests" }).click();
  await expect(tests.getByRole("status")).toHaveText(/Passed: 1 passing cases, 0 failing cases/);
  const passVisible = await visibleCase(tests, "Pass");
  verifyCanonical(passVisible, passExpected, "passing");
  verifySnapshotHashes(passVisible, passFiles);
  await verifySourceRevisions(tests, passFiles);
  const frame = await visibleCanvas(tests);
  if (frame.tick !== passVisible.run!.checkpoints.at(-1)?.tick) throw new Error(`Displayed engine frame tick ${frame.tick} differs from the final real checkpoint.`);
  if (frame.actorPixels === 0 || frame.backgroundPixels === 0) throw new Error(`The actual engine frame omitted the authored actor or blue board background: ${JSON.stringify(frame)}`);
  if (frame.tick !== passHeadless.frame.tick || frame.width !== passHeadless.frame.width || frame.height !== passHeadless.frame.height
    || frame.pixelHash !== passHeadless.frame.pixelHash) {
    throw new Error(`The visible frame differs from Node's real Engine draw-list rasterization: visible=${JSON.stringify(frame)} Node=${JSON.stringify(passHeadless.frame)}`);
  }
  console.log(`Real creator-test frame RGBA SHA-256: ${frame.pixelHash}`);

  const failFiles = createCreatorTestFiles({ failWall: true });
  await host.writeBacking(CREATOR_TEST_SPEC_PATH, failFiles.find((file) => file.path === CREATOR_TEST_SPEC_PATH)!.bytes);
  const failHeadless = runHeadlessCase(runCreatorSpecs, failFiles, seed, false);
  const failExpected = failHeadless.result;
  await tests.getByRole("button", { name: "Run saved tests" }).click();
  await expect(tests.getByRole("status")).toHaveText(/Failed: 0 passing cases, 1 failing cases/);
  const failed = await visibleCase(tests, "Fail");
  verifyCanonical(failed, failExpected, "failing");
  verifySnapshotHashes(failed, failFiles);
  await verifySourceRevisions(tests, failFiles);
  const failedFrame = await visibleCanvas(tests);
  if (failedFrame.tick !== failHeadless.frame.tick || failedFrame.width !== failHeadless.frame.width || failedFrame.height !== failHeadless.frame.height
    || failedFrame.pixelHash !== failHeadless.frame.pixelHash || failedFrame.pixelHash !== frame.pixelHash) {
    throw new Error(`The failing visible frame differs from Node's authored draw-list pixels: visible=${JSON.stringify(failedFrame)} Node=${JSON.stringify(failHeadless.frame)} pass=${JSON.stringify(frame)}`);
  }
  const failureOutcome = failed.outcomes.find((outcome) => outcome.expected !== outcome.actual);
  if (failureOutcome === undefined || failureOutcome.expected !== "3" || failureOutcome.actual !== "2") {
    throw new Error(`The deliberate wall assertion did not report expected tile 3 against actual tile 2: ${JSON.stringify(failed.outcomes)}`);
  }
  if (failureOutcome.context?.lastAction?.action !== "right" || failureOutcome.context.lastAction.ticks !== 60
    || failureOutcome.context.lastAction.completedTick < 1 || failureOutcome.context.tick < failureOutcome.context.lastAction.completedTick) {
    throw new Error(`The actual failure omitted its completed right action and fixture tick: ${JSON.stringify(failureOutcome.context)}`);
  }
  const failSpec = failFiles.find((file) => file.path === CREATOR_TEST_SPEC_PATH);
  if (failSpec === undefined) throw new Error("The failing authored fixture omitted its owning spec source.");
  const wallLines = new TextDecoder().decode(failSpec.bytes).split("\n")
    .flatMap((line, index) => line.includes('expect(specValue("player.tileX"))') ? [index + 1] : []);
  if (wallLines.length !== 1 || failureOutcome.line !== wallLines[0] || failureOutcome.column < 1
    || failureOutcome.sourcePath !== CREATOR_TEST_SPEC_PATH) {
    throw new Error(`The failure source location did not point to the authored wall assertion at ${CREATOR_TEST_SPEC_PATH}:${wallLines.join(",")}: ${JSON.stringify(failureOutcome)}`);
  }
  const sourceLink = tests.getByRole("button", { name: `Line ${failureOutcome.line}, column ${failureOutcome.column}` });
  await sourceLink.scrollIntoViewIfNeeded();
  const sourceHitTest = await sourceLink.evaluate((button) => {
    const describe = (element: Element | null) => {
      if (element === null) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        tag: element.tagName,
        className: typeof element.className === "string" ? element.className : "",
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        display: style.display,
        position: style.position,
        zIndex: style.zIndex,
        pointerEvents: style.pointerEvents,
        whiteSpace: style.whiteSpace,
        overflow: style.overflow,
      };
    };
    const rect = button.getBoundingClientRect();
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    return {
      point: { x, y },
      button: describe(button),
      cell: describe(button.closest("td")),
      hit: describe(button.ownerDocument.elementFromPoint(x, y)),
      hits: button.ownerDocument.elementsFromPoint(x, y).slice(0, 5).map(describe),
      ancestors: Array.from((function* () {
        for (let ancestor = button.parentElement; ancestor !== null && ancestor !== button.ownerDocument.body; ancestor = ancestor.parentElement) {
          yield ancestor;
        }
      })()).slice(0, 6).map(describe),
    };
  });
  console.log(`creator source-link hit test: ${JSON.stringify(sourceHitTest)}`);
  if (sourceHitTest.hit?.tag !== "BUTTON") {
    throw new Error(`The source link's visible center is not hit-testable: ${JSON.stringify(sourceHitTest)}`);
  }
  await sourceLink.click();
  await expect(page.getByRole("tab", { name: /wall\.spec\.prg/ })).toBeVisible();
  const sourceEditor = page.locator(".monaco-editor").filter({ has: page.locator(".view-lines") });
  await expect(sourceEditor).toBeVisible();
  const sourcePosition = page.locator(".statusbar-item").filter({ hasText: new RegExp(`Ln ${failureOutcome.line},\\s*Col ${failureOutcome.column}`) });
  await expect(sourcePosition).toBeVisible();
  // Opening source changes the active editor group; return to the real saved-tests tab before the next action.
  const creatorTestsTab = page.getByRole("tab", { name: /RPG Toolkit: Run saved tests/ });
  await expect(creatorTestsTab).toBeVisible();
  await creatorTestsTab.click();
  await expect(tests.getByRole("button", { name: "Run saved tests" })).toBeVisible();

  // Independent control: with the authored wall vector removed, the same one-based assertion must go red through the real host.
  const passBoard = passFiles.find((file) => file.path === CREATOR_TEST_BOARD_PATH);
  if (passBoard === undefined) throw new Error("The authored fixture omitted its wall board.");
  const parsedBoard = readBoard(new BinaryReader(passBoard.bytes));
  if (!parsedBoard.ok) throw new Error(`The authored wall board did not read back: ${parsedBoard.error.message}`);
  const openBoard = writeBoard({ ...parsedBoard.value, vectors: [] });
  if (!openBoard.ok) throw new Error(`The open-board control did not write: ${openBoard.error.message}`);
  const openFiles = passFiles.map((file) => file.path === CREATOR_TEST_BOARD_PATH ? { path: file.path, bytes: openBoard.value } : file);
  const openHeadless = runHeadlessCase(runCreatorSpecs, openFiles, seed, false);
  const openAuthored = openHeadless.result.outcomes.find((outcome) => outcome.line === failureOutcome.line);
  if (openAuthored === undefined || openAuthored.expected !== "2" || openAuthored.actual !== "4") {
    throw new Error(`Removing the authored wall did not move the actor to tile 4 against the tile-2 assertion: ${JSON.stringify(openHeadless.result.outcomes)}`);
  }
  await host.writeBacking(CREATOR_TEST_BOARD_PATH, openBoard.value);
  await host.writeBacking(CREATOR_TEST_SPEC_PATH, passFiles.find((file) => file.path === CREATOR_TEST_SPEC_PATH)!.bytes);
  await tests.getByRole("button", { name: "Run saved tests" }).click();
  await expect(tests.getByRole("status")).toHaveText(/Failed: 0 passing cases, 1 failing cases/);
  const openVisible = await visibleCase(tests, "Fail");
  verifyCanonical(openVisible, openHeadless.result, "wall-removed");
  verifySnapshotHashes(openVisible, openFiles);
  const openOutcome = openVisible.outcomes.find((outcome) => outcome.expected !== outcome.actual);
  if (openOutcome === undefined || openOutcome.expected !== "2" || openOutcome.actual !== "4" || openOutcome.line !== failureOutcome.line) {
    throw new Error(`The visible wall-removed run did not report the authored tile assertion as expected tile 2 against actual tile 4: ${JSON.stringify(openVisible.outcomes)}`);
  }
  const openFrame = await visibleCanvas(tests);
  if (openFrame.tick !== openHeadless.frame.tick || openFrame.width !== openHeadless.frame.width || openFrame.height !== openHeadless.frame.height
    || openFrame.pixelHash !== openHeadless.frame.pixelHash) {
    throw new Error(`The wall-removed visible frame differs from Node's real draw-list pixels: visible=${JSON.stringify(openFrame)} Node=${JSON.stringify(openHeadless.frame)}`);
  }

  await verifySaveBarriers(page, expect, tests, host);
}

async function verifySaveBarriers(page: Page, expect: Expect, tests: Frame, host: CreatorProofHost): Promise<void> {
  const gamePath = "Main/example.gam";
  const original = await host.readBacking(gamePath);
  await host.writeBacking("CreatorRaceNote.txt", new TextEncoder().encode("race note\n"));
  await page.keyboard.press("Control+P");
  const quickOpen = page.locator(".quick-input-widget input");
  await quickOpen.fill(gamePath);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: /example\.gam/ })).toBeVisible();
  const editor = await waitForGameSettingsFrame(page);
  await editor.getByLabel("Game title").fill("Creator test save refusal");
  await editor.getByRole("button", { name: "Apply changes" }).click();
  await expect(editor.locator(".tkr-settings-state")).toHaveText("Unsaved changes");
  await host.withBackingWriteRefused(gamePath, async () => {
    await tests.getByRole("button", { name: "Run saved tests" }).click();
    await expect(tests.getByRole("status")).toHaveText("Saved tests could not complete.");
    await expect(tests.getByRole("alert").first()).toContainText(/save/i);
  });
  expect(await host.readBacking(gamePath)).toEqual(original);
  await expect(tests.getByRole("heading", { name: /Pass:|Fail:/ })).toHaveCount(0);

  const eventStart = host.readHostEvents().length;
  host.pauseSave();
  try {
    await tests.getByRole("button", { name: "Run saved tests" }).click();
    await expect.poll(() => host.readHostEvents().slice(eventStart), { timeout: 30_000 })
      .toContainEqual({ kind: "save-request", value: `/${gamePath}` });
    await page.keyboard.press("Control+P");
    await quickOpen.fill("CreatorRaceNote.txt");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("tab", { name: /CreatorRaceNote\.txt/ })).toBeVisible();
    const textEditor = page.locator(".monaco-editor").filter({ has: page.locator(".view-lines") }).last();
    await textEditor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" changed during save");
    await expect(textEditor.locator(".view-lines")).toContainText("changed during save");
  } finally {
    host.resumeSave();
  }
  await expect(tests.getByRole("status")).toHaveText("Saved tests could not complete.");
  await expect(tests.getByRole("alert").first()).toContainText(/changed while/i);
  await expect(tests.getByRole("heading", { name: /Pass:|Fail:/ })).toHaveCount(0);
}

async function waitForGameSettingsFrame(page: Page): Promise<Frame> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const webviews = page.locator("iframe.webview:visible");
    for (let index = 0, count = await webviews.count(); index < count; index += 1) {
      const outer = await webviews.nth(index).elementHandle({ timeout: 250 }).catch(() => null);
      const content = (await outer?.contentFrame().catch(() => null))?.childFrames().find((frame) => frame.name() === "pending-frame");
      if (content !== undefined && await content.getByLabel("Game title").count().catch(() => 0) > 0) return content;
    }
    await page.waitForTimeout(100);
  }
  throw new Error("The real game-settings webview did not open for the saved-test save-barrier proof.");
}

function caseFrom(report: Report, expectedOk: boolean): Case {
  const found = report.files.flatMap((file) => file.cases).find((item) => item.name === CREATOR_TEST_CASE_NAME);
  if (found === undefined || found.ok !== expectedOk) throw new Error(`Headless creator proof did not produce the expected ${expectedOk ? "passing" : "failing"} case.`);
  const passing = found.outcomes.filter((outcome) => outcome.kind === "pass").length;
  const failing = found.outcomes.filter((outcome) => outcome.kind === "fail").length;
  const expectedPassing = expectedOk ? 3 : 2;
  const expectedFailing = expectedOk ? 0 : 1;
  if (passing !== expectedPassing || failing !== expectedFailing) {
    throw new Error(`The authored creator case produced ${passing} passing and ${failing} failing assertions; expected ${expectedPassing} passing and ${expectedFailing} failing.`);
  }
  return found;
}
function runHeadlessCase(runCreatorSpecs: CreatorRunner, files: readonly File[], seed: number, expectedOk: boolean): { readonly result: Case; readonly frame: ReferenceFrame } {
  let observation: CreatorFrameObservation | undefined;
  const report = runCreatorSpecs(files, { seed, name: CREATOR_TEST_CASE_NAME, onFrame: (frame) => { observation = frame; } });
  if (observation === undefined) throw new Error("The headless creator proof produced no real Engine frame observation.");
  const rendered = rasterizeObservedFrame(observation);
  return {
    result: caseFrom(report, expectedOk),
    frame: { tick: rendered.tick, width: rendered.width, height: rendered.height, pixelHash: sha256(rendered.rgba) },
  };
}

/** Reuse the core rasterizer on the same read-only observation the native controller presents. */
function rasterizeObservedFrame(frame: CreatorFrameObservation): { readonly tick: number; readonly width: number; readonly height: number; readonly rgba: Uint8Array } {
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
  const revisions = new Map<SurfaceId, Map<number, DecodedTexture>>();
  surfaces.get = (id, revision?: number) => {
    if (revision === undefined) return undefined;
    const cached = revisions.get(id)?.get(revision);
    if (cached !== undefined) return cached;
    const loaded = frame.surfacePixels(id, revision);
    if (loaded === null) return undefined;
    let versions = revisions.get(id);
    if (versions === undefined) { versions = new Map(); revisions.set(id, versions); }
    versions.set(revision, loaded);
    return loaded;
  };
  const pixels = rasterize(frame.drawList as DrawList, assets, surfaces);
  if (pixels.error !== null) throw new Error(`The headless creator reference frame could not be drawn: ${pixels.error}`);
  return { tick: frame.tick, width: pixels.width, height: pixels.height, rgba: pixels.rgba };
}

async function visibleCase(tests: Frame, outcome: "Pass" | "Fail"): Promise<Case> {
  const heading = tests.getByRole("heading", { name: `${outcome}: ${CREATOR_TEST_CASE_NAME}` });
  await heading.waitFor({ state: "visible" });
  const caseItem = heading.locator("xpath=..");
  const actionDetails = caseItem.locator("details").filter({ hasText: "Consumed input, checkpoints and loaded files" });
  const actionJson = await actionDetails.locator("pre").textContent();
  const snapshotDetails = caseItem.locator("details").filter({ hasText: "Saved run snapshot and fixture" });
  const snapshotJson = await snapshotDetails.locator("pre").textContent();
  if (actionJson === null || snapshotJson === null) throw new Error("The visible saved-test report omitted its saved snapshot, action log or checkpoints.");
  const actionData = JSON.parse(actionJson) as { readonly actionLog: readonly unknown[]; readonly checkpoints: readonly { readonly tick: number; readonly stateHash: string }[] };
  const snapshot = JSON.parse(snapshotJson) as unknown;
  const rows = caseItem.locator("tr[data-outcome]");
  const outcomes = [];
  for (const row of await rows.all()) {
    const cells = row.locator("td");
    const kind = await cells.nth(0).innerText();
    const expected = await cells.nth(2).innerText();
    const actual = await cells.nth(3).innerText();
    const source = await cells.nth(4).getByRole("button").getAttribute("title");
    const position = source?.match(/^(.*):(\d+):(\d+)$/);
    const contextText = await cells.nth(5).innerText();
    const context = contextText.match(/Tick (\d+); board ([^;]+); after ([a-z.]+) for (\d+) ticks, completed at tick (\d+)/);
    outcomes.push({
      kind,
      expected,
      actual,
      sourcePath: position?.[1] ?? "",
      line: Number(position?.[2] ?? 0),
      column: Number(position?.[3] ?? 0),
      ...(context === null ? {} : { context: { tick: Number(context[1]), board: context[2] ?? null, lastAction: { action: context[3] ?? "", ticks: Number(context[4]), completedTick: Number(context[5]) } } }),
    });
  }
  const hash = await caseItem.locator("p").filter({ hasText: "Final state hash:" }).locator("code").textContent();
  if (hash === null) throw new Error("The visible case omitted its final engine state hash.");
  const title = await heading.textContent();
  return { name: CREATOR_TEST_CASE_NAME, ok: title?.startsWith("Pass:") ?? false, stateHash: hash, outcomes, run: { ...actionData, snapshot } };
}

function verifyCanonical(actual: Case, expected: Case, label: string): void {
  if (JSON.stringify(actual.run?.actionLog) !== JSON.stringify(expected.run?.actionLog)) throw new Error(`Visible and headless ${label} action logs differ.`);
  if (JSON.stringify(actual.run?.checkpoints) !== JSON.stringify(expected.run?.checkpoints)) throw new Error(`Visible and headless ${label} checkpoints differ.`);
  if (actual.stateHash !== expected.stateHash) throw new Error(`Visible and headless ${label} final state hashes differ.`);
  const actualRun = actual.run as NonNullable<Case["run"]>;
  const expectedRun = expected.run as NonNullable<Case["run"]>;
  const visibleSnapshot = actualRun.snapshot as Record<string, unknown>;
  const headlessSnapshot = expectedRun.snapshot as Record<string, unknown>;
  const { project: _visibleProject, ...visibleCanonical } = visibleSnapshot;
  const { project: _headlessProject, ...headlessCanonical } = headlessSnapshot;
  if (JSON.stringify(visibleCanonical) !== JSON.stringify(headlessCanonical)) throw new Error(`Visible and headless ${label} fixture snapshot hashes differ.`);
}

function verifySnapshotHashes(actual: Case, files: readonly File[]): void {
  const snapshot = actual.run?.snapshot as { readonly documents?: readonly { readonly role: string; readonly path: string; readonly sha256: string }[] } | undefined;
  if (snapshot?.documents === undefined) throw new Error("Saved case report omitted source and fixture-board snapshot hashes.");
  const hashes = new Map(files.map((file) => [file.path, sha256(file.bytes)]));
  for (const document of snapshot.documents) {
    const expected = hashes.get(document.path);
    if (expected === undefined || document.sha256 !== expected) throw new Error(`Saved snapshot hash mismatch for ${document.path}: ${document.sha256}`);
  }
  if (!snapshot.documents.some((document) => document.role === "spec") || !snapshot.documents.some((document) => document.role === "fixture-board")) {
    throw new Error("Saved snapshot does not identify both the owning spec and its fixture board.");
  }
}
async function verifySourceRevisions(tests: Frame, files: readonly File[]): Promise<void> {
  const sources = JSON.parse(await tests.locator("details").filter({ hasText: "Saved file revisions supplied to the framework" }).locator("pre").textContent() ?? "null") as { path: string; revision: string | null }[];
  for (const [path, revision] of new Map(files.map((file) => [file.path, sha256(file.bytes)]))) {
    const match = sources.find((item) => item.path === path);
    if (match === undefined || match.revision !== revision) throw new Error(`Saved byte revision mismatch for ${path}: ${JSON.stringify(match)}`);
  }
}

async function visibleCanvas(tests: Frame): Promise<{ readonly tick: number; readonly width: number; readonly height: number; readonly actorPixels: number; readonly backgroundPixels: number; readonly pixelHash: string }> {
  const canvas = tests.getByLabel("Last real fixture engine frame");
  await canvas.waitFor({ state: "visible" });
  const frameText = await tests.locator("figcaption").textContent();
  const tick = Number(frameText?.match(/tick (\d+)/)?.[1] ?? 0);
  const frame = await canvas.evaluate(async (element, actorColors: readonly string[]) => {
    const actorPalette = new Set(actorColors);
    const canvasElement = element as HTMLCanvasElement;
    const width = canvasElement.width;
    const height = canvasElement.height;
    const context = canvasElement.getContext("2d");
    if (context === null) return { width, height, actorPixels: 0, backgroundPixels: 0, pixelHash: "" };
    const pixels = context.getImageData(0, 0, width, height).data;
    let actorPixels = 0;
    let backgroundPixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (actorPalette.has(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`)) actorPixels += 1;
      if (pixels[index] === 22 && pixels[index + 1] === 58 && pixels[index + 2] === 84) backgroundPixels += 1;
    }
    const digest = await crypto.subtle.digest("SHA-256", pixels);
    const pixelHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return { width, height, actorPixels, backgroundPixels, pixelHash };
  }, Object.keys(HERO_VISIBLE_RGB));
  return { tick, ...frame };
}

async function creatorTestsFrame(page: Page, expect: Expect): Promise<Frame> {
  let found: Frame | undefined;
  await expect.poll(async () => {
    found = undefined;
    for (const frame of page.frames()) if (await frame.locator("section.tkr-creator-tests").count() > 0) { found = frame; break; }
    return found !== undefined;
  }, { timeout: 30_000 }).toBe(true);
  return found!;
}

async function runPaletteCommand(page: Page, expect: Expect, title: string): Promise<void> {
  await page.keyboard.press("ControlOrMeta+Shift+p");
  const input = page.locator(".quick-input-widget input:visible");
  await expect(input).toHaveCount(1);
  await input.fill(`>${title}`);
  const command = page.getByRole("option", { name: new RegExp(`^${title}(?:,|$)`) });
  await expect(command).toBeVisible({ timeout: 30_000 });
  await input.press("Enter");
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
