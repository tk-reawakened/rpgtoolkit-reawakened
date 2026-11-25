import type { expect as playwrightExpect, Frame, Page } from "@playwright/test";
import { pollNoFrameMatching, pollPageFrames } from "./frame-poll.ts";
import { runCommandMatching } from "./web-proof.ts";

type Expect = typeof playwrightExpect;
const help = ".tkr-first-board-help";

async function openHelp(page: Page, expect: Expect, title: string): Promise<Frame> {
  await runCommandMatching(page, expect, title, title);
  const result = await pollPageFrames<Frame, true>({
    label: title,
    frames: () => page.frames(),
    describe: (frame) => frame.name(),
    probe: async (frame) => await frame.locator(help).isVisible() ? true : null,
    accept: (reports) => reports.length > 0,
  });
  return result.reports[0]!.frame;
}

async function closeHelp(page: Page, frame: Frame): Promise<void> {
  await frame.getByRole("button", { name: "Close help" }).press("Escape");
  await pollNoFrameMatching<Frame>({
    label: "Closed tutorial webview",
    frames: () => page.frames(),
    present: (candidate) => candidate.locator(help).isVisible(),
  });
}

/** Exercise the two native commands through the real VS Code palette and the shipped CSP webview. */
export async function runVscodeFirstBoardTutorialProof(page: Page, expect: Expect, workbenchUrl: string): Promise<void> {
  await page.goto(workbenchUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".monaco-workbench")).toBeVisible();
  const guide = "RPG Toolkit: First board tutorial";
  const tip = "RPG Toolkit: Tip of the day";

  let frame = await openHelp(page, expect, guide);
  await expect(frame.getByRole("heading", { name: /^Step 1 of 9:/ })).toBeVisible();
  await expect(frame.getByRole("heading", { name: /^Step 1 of 9:/ })).toBeFocused();
  await frame.getByRole("button", { name: "Next step" }).press("Enter");
  await expect(frame.getByRole("heading", { name: /^Step 2 of 9: Find Game and Files/ })).toBeVisible();
  await closeHelp(page, frame);

  frame = await openHelp(page, expect, guide);
  await expect(frame.getByRole("heading", { name: /^Step 2 of 9:/ })).toBeVisible();
  await frame.getByRole("button", { name: "Restart tutorial" }).press("Enter");
  await expect(frame.getByRole("heading", { name: /^Step 1 of 9:/ })).toBeVisible();
  await closeHelp(page, frame);

  frame = await openHelp(page, expect, tip);
  const label = "Show a tip when the editor opens";
  let tips = frame.getByRole("checkbox", { name: label });
  await expect(tips).toBeChecked();
  await tips.press("Space");
  await expect(tips).not.toBeChecked();
  await closeHelp(page, frame);

  frame = await openHelp(page, expect, tip);
  await expect(frame.getByRole("heading", { name: "A tip for today" })).toBeVisible();
  tips = frame.getByRole("checkbox", { name: label });
  await expect(tips).not.toBeChecked();
  await closeHelp(page, frame);
}
