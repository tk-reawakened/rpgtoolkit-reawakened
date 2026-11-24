import type { expect as playwrightExpect, Page } from "@playwright/test";
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

export function scriptWorkflowProofFiles(): readonly { readonly path: string; readonly bytes: Uint8Array }[] {
  const main = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`../../docs/spec/examples/versions/main/${name}`, import.meta.url)));
  return [
    { path: MODERN, bytes: main("main_minor9.gam") }, { path: LEGACY, bytes: main("main_tk2_text.gam") },
    { path: ".vscode/settings.json", bytes: encode(`${JSON.stringify({ "files.autoSave": "off", "rpgcode.project": MODERN }, null, 2)}\n`) },
    { path: FORMAT, bytes: encode(MESSY) }, { path: OPT_OUT, bytes: encode(UPPER) }, { path: CLEAN, bytes: encode(CLEANUP) },
  ];
}

/** The shipped native commands, project picker, diff editor, review, working copy and persistent workspace provider. */
export async function runVscodeScriptWorkflowProof(
  page: Page, expect: typeof playwrightExpect, url: string,
  read: (path: string) => Promise<Uint8Array>, write: (path: string, bytes: Uint8Array) => Promise<void>,
  groups: () => Promise<readonly string[]>,
): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".monaco-workbench")).toBeVisible();
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

  // The modern main was configured on disk; no RPGCode command or editor has activated its extension yet.
  await start("Format");
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
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect.poll(() => bytes(FORMAT)).toBe(FORMATTED);
  expect(await bytes(OPT_OUT)).toBe(UPPER);
  expect(await bytes(CLEAN)).toBe(CLEANUP);

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

  await start("Clean up");
  await review(CLEAN);
  await expect(row(CLEAN)).toContainText("Left as written at line 2");
  await row(OPT_OUT).locator(".monaco-custom-toggle").click();
  await apply();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect.poll(() => bytes(CLEAN)).toBe('x = 1\n#MWIN("leave prefix")\nmwin("cleanup")\n');

  await write(OLD, encode(OLD_TEXT));
  await project("review-legacy.gam");
  await openNativeQuickOpenFile(page, expect, OLD);
  await start("Update older syntax", OLD);
  await review(OLD);
  await expect(row(OLD)).toContainText(COPY);
  await apply();
  await expect.poll(() => bytes(COPY)).toBe('MWIN("legacy review")\n');
  expect(await bytes(OLD)).toBe(OLD_TEXT);
}
