import { FIRST_BOARD_ACTIONS, firstBoardTipOfTheDay, type FirstBoardActionId } from "@tk-reawakened/editor-ui";
import type { expect as playwrightExpect, Frame, Page } from "@playwright/test";
import { pollNoFrameMatching, pollPageFrames } from "./frame-poll.ts";
import { openNativeQuickOpenFile } from "./native-quick-open.ts";
import { runCommandMatching } from "./web-proof.ts";

type Expect = typeof playwrightExpect;
const help = ".tkr-first-board-help";
const commandTitle = (label: string): string => `RPG Toolkit: ${label}`;

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

async function closeHelp(page: Page, expect: Expect, title: string): Promise<void> {
  await runCommandMatching(page, expect, title, title);
  await pollNoFrameMatching<Frame>({
    label: "Closed tutorial webview",
    frames: () => page.frames(),
    present: (candidate) => candidate.locator(help).isVisible(),
  });
}

async function expectNativeCommandUnavailable(page: Page, expect: Expect, id: FirstBoardActionId): Promise<void> {
  await page.keyboard.press("ControlOrMeta+Shift+P");
  const input = page.locator(".quick-input-widget input:visible");
  await expect(input).toBeVisible();
  // A human-readable query can yield fuzzy matches for other commands. VS Code
  // provides exact command-ID matching, which means this inactive ID has no pick.
  const query = `>tkr.${id}`;
  await input.fill(query);
  await expect(input).toHaveValue(query);
  await expect(page.locator(".quick-input-widget").getByText("No matching commands", { exact: true })).toBeVisible();
  await input.press("Escape");
}

/** Exercise startup presentation and all five native tutorial actions through the VS Code palette. */
export async function runVscodeFirstBoardTutorialProof(page: Page, expect: Expect, workbenchUrl: string): Promise<void> {
  await page.goto(workbenchUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".monaco-workbench")).toBeVisible();
  await openNativeQuickOpenFile(page, expect, "Main/example.gam");
  const settingsOutcome = await pollPageFrames<Frame, true>({
    label: "The selected Main/example.gam settings editor",
    frames: () => page.frames(),
    describe: (frame) => frame.name(),
    probe: async (frame) => await frame.locator(".tkr-settings").count() > 0 ? true : null,
    accept: (reports) => reports.length === 1,
  });
  const settingsFrame = settingsOutcome.reports[0]!.frame;
  const titleField = settingsFrame.getByRole("textbox", { name: "Game title", exact: true });
  await expect(titleField).toBeVisible();
  await expect(page.locator(".monaco-workbench .tabs-container .tab.active")).toContainText("example.gam");
  await titleField.focus();
  await expect(titleField).toBeFocused();
  await expect(page.locator(".notification-toast").filter({ hasText: firstBoardTipOfTheDay() })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Tip of the day/ })).toHaveCount(0);
  await expect(page.locator("iframe.webview:visible")).toHaveCount(1);
  await pollNoFrameMatching<Frame>({
    label: "No automatic first-board tutorial webview beside the selected game settings editor",
    frames: () => page.frames(),
    present: (frame) => frame.locator(help).isVisible(),
  });
  await expect(titleField).toBeFocused();
  const guide = commandTitle("First board tutorial");
  const tip = commandTitle("Tip of the day");
  const action = (id: (typeof FIRST_BOARD_ACTIONS)[number]["id"]): string =>
    commandTitle(FIRST_BOARD_ACTIONS.find((entry) => entry.id === id)!.label);
  const next = action("help.firstBoard.next");
  const back = action("help.firstBoard.back");
  const restart = action("help.firstBoard.restart");
  const close = action("help.firstBoard.close");
  const toggle = action("help.dailyTip.toggle");

  let frame = await openHelp(page, expect, guide);
  await expect(frame.getByRole("heading", { name: /^Step 1 of 9:/ })).toBeVisible();
  await expect(frame.getByRole("heading", { name: /^Step 1 of 9:/ })).toBeFocused();
  await expectNativeCommandUnavailable(page, expect, "help.firstBoard.back");
  await expectNativeCommandUnavailable(page, expect, "help.firstBoard.restart");
  await expectNativeCommandUnavailable(page, expect, "help.dailyTip.toggle");

  await runCommandMatching(page, expect, next, next);
  await expect(frame.getByRole("heading", { name: /^Step 2 of 9: Find Game and Files/ })).toBeVisible();
  await runCommandMatching(page, expect, back, back);
  await expect(frame.getByRole("heading", { name: /^Step 1 of 9:/ })).toBeVisible();
  await runCommandMatching(page, expect, next, next);
  await expect(frame.getByRole("heading", { name: /^Step 2 of 9:/ })).toBeVisible();
  await closeHelp(page, expect, close);
  await expectNativeCommandUnavailable(page, expect, "help.firstBoard.next");

  frame = await openHelp(page, expect, guide);
  await expect(frame.getByRole("heading", { name: /^Step 2 of 9:/ })).toBeVisible();
  await runCommandMatching(page, expect, restart, restart);
  await expect(frame.getByRole("heading", { name: /^Step 1 of 9:/ })).toBeVisible();
  await closeHelp(page, expect, close);

  const label = "Show a tip when the editor opens";
  frame = await openHelp(page, expect, tip);
  let tips = frame.getByRole("checkbox", { name: label });
  await expect(tips).toBeChecked();
  await runCommandMatching(page, expect, toggle, toggle);
  await expect(tips).not.toBeChecked();
  await closeHelp(page, expect, close);

  frame = await openHelp(page, expect, tip);
  await expect(frame.getByRole("heading", { name: "A tip for today" })).toBeVisible();
  tips = frame.getByRole("checkbox", { name: label });
  await expect(tips).not.toBeChecked();
  await runCommandMatching(page, expect, toggle, toggle);
  await expect(tips).toBeChecked();
  await closeHelp(page, expect, close);

  frame = await openHelp(page, expect, tip);
  await expect(frame.getByRole("checkbox", { name: label })).toBeChecked();
  await closeHelp(page, expect, close);
}
