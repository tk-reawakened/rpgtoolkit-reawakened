import type { expect as playwrightExpect, Page, Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import { openNativeQuickOpenFile } from "./native-quick-open.ts";
import { runCommandMatching } from "./web-proof.ts";

const ROOT = "Game 100%";
const MODERN = `${ROOT}/Main/review-modern.gam`;
const LEGACY = `${ROOT}/Main/review-legacy.gam`;
const FORMAT = `${ROOT}/Prg/format-review.prg`;
const OPT_OUT = `${ROOT}/Prg/case-review.prg`;
const CLEAN = `${ROOT}/Prg/cleanup-review.prg`;
const OLD = `${ROOT}/Prg/legacy-review.prg`;
const COPY = `${ROOT}/.tkr-migrated/3.1/Prg/legacy-review.prg`;
const MESSY = 'x = 1\r\nIF (x == 1) {\r\nMWIN("review original")\r\n}\r\n';
const FORMATTED = 'x = 1\r\nif (x == 1) {\r\n    mwin("review original")\r\n}\r\n';
const UPPER = '  MWIN("case only")\n';
const CLEANUP = 'x! = 1\n#MWIN("leave prefix")\nMWIN("cleanup")\n';
const OLD_TEXT = '#MWIN(legacy review)\n';
const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const FIXTURE_FS = /^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{64}$/;
function isFixtureRead(route: Route, path: string): boolean {
  const request = route.request();
  const call: { op?: string; path?: string } | null = request.method() === "POST" ? request.postDataJSON() : null;
  return call?.op === "readFile" && call.path === path;
}

export function scriptWorkflowProofFiles(): readonly { readonly path: string; readonly bytes: Uint8Array }[] {
  const main = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`../../docs/spec/examples/versions/main/${name}`, import.meta.url)));
  return [
    { path: MODERN, bytes: main("main_minor9.gam") }, { path: LEGACY, bytes: main("main_tk2_text.gam") },
    { path: ".vscode/settings.json", bytes: encode(`${JSON.stringify({ "files.autoSave": "off", "rpgcode.project": MODERN }, null, 2)}\n`) },
    { path: FORMAT, bytes: encode(MESSY) }, { path: OPT_OUT, bytes: encode(UPPER) }, { path: CLEAN, bytes: encode(CLEANUP) },
    { path: "Main/__tkr_remove_script_folder", bytes: new Uint8Array() },
  ];
}

/** The shipped native commands, project picker, diff editor, review, working copy and persistent workspace provider. */
export async function runVscodeScriptWorkflowProof(
  page: Page, expect: typeof playwrightExpect, url: string,
  read: (path: string) => Promise<Uint8Array>, write: (path: string, bytes: Uint8Array) => Promise<void>,
  groups: (root?: string) => Promise<readonly string[]>,
): Promise<void> {
  const quick = page.locator(".quick-input-widget");
  const row = (path: string) => quick.locator(".monaco-list-row").filter({ hasText: path });
  const dispatch = async (title: string): Promise<void> => await runCommandMatching(page, expect, title, title, false, false);
  const project = async (main: string): Promise<void> => {
    await dispatch("RPGCode: Select Running Project");
    await row(main).click();
    await expect(quick).toBeHidden();
  };
  const start = async (title: string, scope = "Every program in the project"): Promise<void> => {
    await dispatch(`TK Reawakened: ${title} (reviewed)…`);
    await row(scope).click();
  };
  const review = async (path: string): Promise<void> => {
    await expect(quick.getByRole("button", { name: "OK", exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(row(path)).toBeVisible();
  };
  const apply = async (): Promise<void> => {
    await quick.getByRole("button", { name: "OK", exact: true }).click();
    await expect(quick).toBeHidden();
  };
  const bytes = async (path: string): Promise<string> => new TextDecoder().decode(await read(path));
  const initialGroups = await groups();
  const proveOpenProgram = async (): Promise<void> => {
    await openNativeQuickOpenFile(page, expect, OPT_OUT);
    const active = page.locator(".monaco-editor:visible").last().locator(".view-lines");
    await expect(active).toContainText(/MWIN/);
    await start("Normalise capitalisation", OPT_OUT);
    await review(OPT_OUT);
    await apply();
    await expect(active).toContainText(/mwin/);
    expect(await bytes(OPT_OUT)).toBe(UPPER);
    await active.click();
    await page.keyboard.press("ControlOrMeta+S");
    await expect.poll(() => bytes(OPT_OUT)).toBe('  mwin("case only")\n');
  };
  const reviewLegacyCopy = async (): Promise<void> => {
    await write(OLD, encode(OLD_TEXT));
    await project("review-legacy.gam");
    await openNativeQuickOpenFile(page, expect, OLD);
    await start("Update older syntax", OLD);
    await review(OLD);
    await expect(row(OLD)).toContainText(COPY);
  };

  // Hold the provider's real workspace settings read until after opening the scope picker in a fresh window.
  // No other RPGCode action opens the extension; accepting the scope must use the main that arrives meanwhile.
  const waiting: Route[] = [];
  let holdSettings = true;
  const interceptSettings = async (route: Route): Promise<void> => {
    if (holdSettings && isFixtureRead(route, "/.vscode/settings.json")) {
      waiting.push(route);
      return;
    }
    await route.fallback();
  };
  await page.context().route(FIXTURE_FS, interceptSettings);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".monaco-workbench")).toBeVisible();
    await expect.poll(() => waiting.length).toBeGreaterThan(0);
    await dispatch("TK Reawakened: Format (reviewed)…");
    const scope = row("Every program in the project");
    await expect(scope).toBeVisible();
    await expect(page.getByRole("button", { name: /RPGCode: no running project/ })).toBeVisible();
    holdSettings = false;
    await Promise.all(waiting.splice(0).map((route) => route.continue()));
    await expect(page.getByRole("button", { name: /Running project: .*review-modern\.gam/ })).toBeVisible();
    await scope.click();
  } finally {
    for (const route of waiting) await route.abort();
    await page.context().unroute(FIXTURE_FS, interceptSettings);
  }
  await review(FORMAT);
  await row(FORMAT).hover();
  await row(FORMAT).getByLabel("Show changes").click();
  await expect(page.locator(".monaco-diff-editor")).toBeVisible();
  await expect(page.locator(".monaco-diff-editor .editor.original .view-lines")).toContainText(/MWIN/);
  await expect(page.locator(".monaco-diff-editor .editor.modified .view-lines")).toContainText(/mwin/);
  await quick.locator("input:visible").press("Escape");
  await expect(quick).toBeHidden();
  expect(await bytes(FORMAT)).toBe(MESSY);
  expect(await bytes(OPT_OUT)).toBe(UPPER);
  expect(await groups()).toEqual(initialGroups);

  await start("Format");
  await review(FORMAT);
  for (const path of [OPT_OUT, CLEAN]) await row(path).locator(".monaco-custom-toggle").click();
  await apply();
  const diskConsent = page.getByRole("button", { name: "Continue", exact: true });
  await expect(page.getByText(/another program can change the files or swap a path for a link after the final check/i)).toBeVisible();
  await expect(page.getByText(/VS Code refuses links it detects/i)).toBeVisible();
  await diskConsent.click();
  await expect.poll(() => bytes(FORMAT)).toBe(FORMATTED);
  expect(await bytes(OPT_OUT)).toBe(UPPER);
  expect(await bytes(CLEAN)).toBe(CLEANUP);

  await proveOpenProgram();

  await start("Clean up");
  await review(CLEAN);
  await expect(row(CLEAN)).toContainText("Left as written at line 2");
  await row(OPT_OUT).locator(".monaco-custom-toggle").click();
  await apply();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect.poll(() => bytes(CLEAN)).toBe('x = 1\n#MWIN("leave prefix")\nmwin("cleanup")\n');

  // A fresh project selection signal is insufficient: replacing the selected .gam in place changes the dialect.
  const modernBytes = await read(MODERN);
  await write(CLEAN, encode(CLEANUP));
  await start("Clean up");
  await review(CLEAN);
  await apply();
  const consent = page.getByRole("button", { name: "Continue", exact: true });
  await expect(consent).toBeVisible();
  await write(MODERN, await read(LEGACY));
  await consent.click();
  await expect(page.locator(".notification-toast").filter({ hasText: /selected project changed/i }).first()).toBeVisible();
  expect(await bytes(CLEAN)).toBe(CLEANUP);
  await write(MODERN, modernBytes);

  await reviewLegacyCopy();
  await apply();
  await diskConsent.click();
  await expect.poll(async () => {
    try { return await bytes(COPY); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }).toBe('MWIN("legacy review")\n');
  expect(await bytes(OLD)).toBe(OLD_TEXT);

  // Reopen as two sibling workspace folders. The workspace setting is an absolute URI to the main in the second
  // folder, so removing that folder leaves the first and the configured URI unchanged.
  await write(FORMAT, encode(MESSY));
  const nestedGroups = await groups(ROOT);
  await dispatch("Test: Open Script Proof Multi-root Workspace");
  await expect(page.getByText("Proof reviewed folder", { exact: true })).toBeVisible({ timeout: 30_000 });
  const configuredMain = async (): Promise<string | undefined> => {
    const configuration = JSON.parse(await bytes("script-review.code-workspace")) as { settings: Record<string, string | undefined> };
    return configuration.settings["rpgcode.project"];
  };
  await project("review-modern.gam");
  await expect.poll(configuredMain).toMatch(/^tkr-testfs:.*review-modern\.gam$/);
  const selectedMain = await configuredMain();
  await expect(page.getByRole("button", { name: /Running project: .*review-modern\.gam/ })).toBeVisible();
  let gate: Route | undefined;
  const intercept = async (route: Route): Promise<void> => {
    if (isFixtureRead(route, "/Main/__tkr_remove_script_folder")) {
      gate = route;
      return;
    }
    await route.fallback();
  };
  await page.context().route(FIXTURE_FS, intercept);
  try {
    await dispatch("Test: Arm Script Proof Folder Removal");
    await expect(quick).toBeHidden();
    await expect.poll(() => gate !== undefined).toBe(true);
    await start("Format");
    await review("Prg/format-review.prg");
    for (const path of ["Prg/case-review.prg", "Prg/cleanup-review.prg"]) await row(path).locator(".monaco-custom-toggle").click();
    await apply();
    await expect(diskConsent).toBeVisible();
    await gate!.continue();
    await expect(page.getByRole("treeitem", { name: "Proof reviewed folder" })).toHaveCount(0);
    expect(await configuredMain()).toBe(selectedMain);
    await diskConsent.click();
    await expect(page.locator(".notification-toast").filter({ hasText: /selected project changed/i }).first()).toBeVisible();
    expect(await bytes(FORMAT)).toBe(MESSY);
    expect(await groups(ROOT)).toEqual(nestedGroups);
  } finally {
    await page.context().unroute(FIXTURE_FS, intercept);
  }
}
