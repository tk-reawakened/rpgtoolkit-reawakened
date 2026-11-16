import { createHash } from "node:crypto";
import type { expect as playwrightExpect, Frame, Page } from "@playwright/test";
import { CREATOR_TEST_CASE_NAME, CREATOR_TEST_SPEC_PATH, createCreatorTestFiles } from "./creator-tests-fixture.mjs";

type Expect = typeof playwrightExpect;
type File = { readonly path: string; readonly bytes: Uint8Array };
type Case = {
  readonly name: string;
  readonly ok: boolean;
  readonly stateHash: string;
  readonly outcomes: readonly { readonly expected: string; readonly actual: string; readonly line: number; readonly column: number; readonly context?: { readonly tick: number; readonly lastAction: null | { readonly action: string; readonly ticks: number; readonly completedTick: number }; readonly board: string | null } }[];
  readonly run?: { readonly snapshot: unknown; readonly actionLog: readonly unknown[]; readonly checkpoints: readonly { readonly tick: number; readonly stateHash: string }[] };
};
type Report = { readonly files: readonly { readonly file: string; readonly cases: readonly Case[] }[]; readonly sources: readonly { readonly path: string; readonly revision: string | null }[] };
type CreatorRunner = (files: readonly File[], options: { readonly seed: number; readonly name: string }) => Report;
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
  const passExpected = caseFrom(runCreatorSpecs(passFiles, { seed, name: CREATOR_TEST_CASE_NAME }), true);
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
  const sources = JSON.parse(await tests.locator("details").filter({ hasText: "Saved file revisions supplied to the framework" }).locator("pre").textContent() ?? "null") as { path: string; revision: string | null }[];
  const expectedHashes = new Map(passFiles.map((file) => [file.path, sha256(file.bytes)]));
  for (const [path, revision] of expectedHashes) {
    const match = sources.find((item) => item.path === path);
    if (match === undefined || match.revision !== revision) throw new Error(`Saved byte revision mismatch for ${path}: ${JSON.stringify(match)}`);
  }
  const frame = await visibleCanvas(tests);
  if (frame.tick !== passVisible.run!.checkpoints.at(-1)?.tick) throw new Error(`Displayed engine frame tick ${frame.tick} differs from the final real checkpoint.`);
  if (frame.nonBlackPixels === 0) throw new Error("The real engine frame contains no visible non-black authored pixels.");

  const failFiles = createCreatorTestFiles({ failWall: true });
  await host.writeBacking(CREATOR_TEST_SPEC_PATH, failFiles.find((file) => file.path === CREATOR_TEST_SPEC_PATH)!.bytes);
  const failExpected = caseFrom(runCreatorSpecs(failFiles, { seed, name: CREATOR_TEST_CASE_NAME }), false);
  await tests.getByRole("button", { name: "Run saved tests" }).click();
  await expect(tests.getByRole("status")).toHaveText(/Failed: 1 passing cases, 1 failing cases/);
  const failed = await visibleCase(tests, "Fail");
  verifyCanonical(failed, failExpected, "failing");
  verifySnapshotHashes(failed, failFiles);
  const failureOutcome = failed.outcomes.find((outcome) => outcome.expected !== outcome.actual);
  if (failureOutcome === undefined || failureOutcome.expected !== "3" || failureOutcome.actual !== "2") {
    throw new Error(`The deliberate wall assertion did not report expected tile 3 against actual tile 2: ${JSON.stringify(failed.outcomes)}`);
  }
  if (failureOutcome.context?.lastAction?.action !== "right" || failureOutcome.context.lastAction.ticks !== 30
    || failureOutcome.context.lastAction.completedTick < 1 || failureOutcome.context.tick < failureOutcome.context.lastAction.completedTick) {
    throw new Error(`The actual failure omitted its completed right action and fixture tick: ${JSON.stringify(failureOutcome.context)}`);
  }
  const failSpec = failFiles.find((file) => file.path === CREATOR_TEST_SPEC_PATH);
  if (failSpec === undefined) throw new Error("The failing authored fixture omitted its owning spec source.");
  const wallLines = new TextDecoder().decode(failSpec.bytes).split("\n")
    .flatMap((line, index) => line.includes('expect(specValue("player.tileX"))') ? [index + 1] : []);
  if (wallLines.length !== 1 || failureOutcome.line !== wallLines[0] || failureOutcome.column < 1) {
    throw new Error(`The failure source location did not point to the authored wall assertion at line ${wallLines.join(",")}: ${JSON.stringify(failureOutcome)}`);
  }
  const sourceLink = tests.getByRole("button", { name: `Line ${failureOutcome.line}, column ${failureOutcome.column}` });
  await sourceLink.click();
  await expect(page.getByRole("tab", { name: /wall\.spec\.prg/ })).toBeVisible();
  const sourceEditor = page.locator(".monaco-editor").filter({ has: page.locator(".view-lines") });
  await expect(sourceEditor).toBeVisible();
  const sourcePosition = page.locator(".statusbar-item").filter({ hasText: new RegExp(`Ln ${failureOutcome.line},\\s*Col ${failureOutcome.column}`) });
  await expect(sourcePosition).toBeVisible();
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
  return found;
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
    const expected = await cells.nth(2).innerText();
    const actual = await cells.nth(3).innerText();
    const source = await cells.nth(4).getByRole("button").getAttribute("title");
    const position = source?.match(/:(\d+):(\d+)$/);
    const contextText = await cells.nth(5).innerText();
    const context = contextText.match(/Tick (\d+); board ([^;]+); after ([a-z.]+) for (\d+) ticks, completed at tick (\d+)/);
    outcomes.push({
      expected,
      actual,
      line: Number(position?.[1] ?? 0),
      column: Number(position?.[2] ?? 0),
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
  const hashes = new Map(files.map((file) => [file.path.replace(/^\.tkr-tests\//, ""), sha256(file.bytes)]));
  for (const document of snapshot.documents) {
    const expected = hashes.get(document.path);
    if (expected === undefined || document.sha256 !== expected) throw new Error(`Saved snapshot hash mismatch for ${document.path}: ${document.sha256}`);
  }
  if (!snapshot.documents.some((document) => document.role === "spec") || !snapshot.documents.some((document) => document.role === "fixture-board")) {
    throw new Error("Saved snapshot does not identify both the owning spec and its fixture board.");
  }
}

async function visibleCanvas(tests: Frame): Promise<{ readonly tick: number; readonly nonBlackPixels: number }> {
  const canvas = tests.getByLabel("Last real fixture engine frame");
  await canvas.waitFor({ state: "visible" });
  const frameText = await tests.locator("figcaption").textContent();
  const tick = Number(frameText?.match(/tick (\d+)/)?.[1] ?? 0);
  const nonBlackPixels = await canvas.evaluate((element) => {
    const canvasElement = element as HTMLCanvasElement;
    const context = canvasElement.getContext("2d");
    if (context === null) return 0;
    const pixels = context.getImageData(0, 0, canvasElement.width, canvasElement.height).data;
    let count = 0;
    for (let index = 0; index < pixels.length; index += 4) if (pixels[index] !== 0 || pixels[index + 1] !== 0 || pixels[index + 2] !== 0) count += 1;
    return count;
  });
  return { tick, nonBlackPixels };
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
  await page.keyboard.press("Control+Shift+P");
  const input = page.locator(".quick-input-widget input");
  await input.fill(title);
  const command = page.getByRole("option", { name: title, exact: true });
  await expect(command).toBeVisible({ timeout: 30_000 });
  await command.click();
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
