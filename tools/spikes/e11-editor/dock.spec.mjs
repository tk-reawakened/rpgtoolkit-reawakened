// Spike A: each docking candidate hosting the same Preact panels under the repository's two editor policies (the web
// host's meta CSP, verbatim; the VS Code webview template, verbatim with a nonce). It records, it does not judge:
// the results go to $TKR_SPIKE_OUT/results/dock/*.json and docs/findings/dock-library/ reads them.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { here, vscodeWebviewPolicy, webHostPolicy } from "./env.mjs";
import { describeFocus, runKeyboardSteps } from "./checks.mjs";
import { NONCE, open, record, violations } from "./probe.mjs";

const libs = {
  "dock-dockview": { tab: '[role="tab"]', sash: ".dv-sash" },
  "dock-dockspawn": { tab: ".dockspan-tab-handle, .panel-titlebar", sash: ".splitbar-vertical, .splitbar-horizontal" },
  "dock-lumino": { tab: ".lm-TabBar-tab", sash: ".lm-DockPanel-handle:not(.lm-mod-hidden)" },
  "dock-golden": { tab: ".lm_tab", sash: ".lm_splitter" },
};
const policies = (origin) => ({
  "web-host": { csp: webHostPolicy() },
  "vscode-webview": { csp: vscodeWebviewPolicy(origin, NONCE), nonce: NONCE },
});


for (const [bundle, selectors] of Object.entries(libs)) {
  for (const policyName of ["web-host", "vscode-webview"]) {
    test(`${bundle} under ${policyName}`, async ({ page, baseURL }) => {
      const policy = policies(baseURL)[policyName];
      const log = await open(page, { bundle, csp: policy.csp, nonce: policy.nonce });
      await page.waitForFunction(() => window.spikeReady === true, null, { timeout: 15_000 });
      await page.waitForTimeout(300);
      const result = { bundle, lib: await page.evaluate(() => window.spike.lib), policy: policy.csp, features: await page.evaluate(() => window.spike.features) };
      result.afterLoad = await violations(page);
      result.panelsRendered = await page.locator(".spike-board").count();

      // ARIA census of the dock chrome, out of the box.
      await page.evaluate(() => window.spike.addTab());
      await page.waitForTimeout(200);
      result.aria = await page.evaluate(({ tab, sash }) => {
        const roles = {};
        for (const el of document.querySelectorAll("#dock [role]")) {
          if (el.closest(".spike-board, nav, section")) continue;
          const role = el.getAttribute("role");
          roles[role] = (roles[role] ?? 0) + 1;
        }
        const tabs = [...document.querySelectorAll(tab)];
        const sashes = [...document.querySelectorAll(sash)].filter((el) => el.getBoundingClientRect().width > 0 || el.getBoundingClientRect().height > 0);
        return {
          roles,
          tabs: tabs.length,
          tabsWithRoleTab: tabs.filter((el) => el.getAttribute("role") === "tab").length,
          tabsWithAriaSelected: tabs.filter((el) => el.hasAttribute("aria-selected")).length,
          tabsFocusable: tabs.filter((el) => el.tabIndex >= 0).length,
          tabsProgrammaticallyFocusable: tabs.filter((el) => el.tabIndex >= -1 && el.hasAttribute("tabindex")).length,
          tabsWithAriaControls: tabs.filter((el) => el.hasAttribute("aria-controls")).length,
          sashes: sashes.length,
          sashesWithRoleSeparator: sashes.filter((el) => el.getAttribute("role") === "separator").length,
          sashesFocusable: sashes.filter((el) => el.tabIndex >= 0).length,
        };
      }, selectors);

      // Keyboard, out of the box. (1) Is any dock tab reachable with Tab from the start of the page?
      await page.evaluate(() => document.activeElement?.blur());
      const sequence = [];
      for (let i = 0; i < 20; i++) {
        await page.keyboard.press("Tab");
        sequence.push(await page.evaluate(describeFocus));
      }
      result.keyboard = {
        tabSequence: sequence,
        tabReachable: await page.evaluate((tab) => [...document.querySelectorAll(tab)].some((el) => el.tabIndex >= 0), selectors.tab),
      };
      // (2) In the Properties/Outline group: arrows between tabs, Enter to activate, Delete to close.
      const focusedTab = await page.evaluate((tab) => {
        const target = [...document.querySelectorAll(tab)].find((el) => /Properties/.test(el.textContent || el.getAttribute("aria-label") || ""));
        target?.focus();
        return document.activeElement === target;
      }, selectors.tab);
      result.keyboard.tabTakesFocus = focusedTab;
      if (focusedTab) {
        const before = await page.evaluate(describeFocus);
        await page.keyboard.press("ArrowRight");
        const afterRight = await page.evaluate(describeFocus);
        result.keyboard.arrowMovesBetweenTabs = before !== afterRight && /Outline/.test(afterRight);
        const panelsBefore = (await page.evaluate(() => window.spike.panels())).length;
        await page.keyboard.press("Delete");
        await page.waitForTimeout(150);
        const panelsAfter = (await page.evaluate(() => window.spike.panels())).length;
        result.keyboard.deleteClosesTab = panelsAfter === panelsBefore - 1;
        result.keyboard.focusAfterClose = await page.evaluate(describeFocus);
      }
      // (3) A splitter by keyboard: focus the first sash and press an arrow.
      result.keyboard.sashKeyboardResize = await page.evaluate(async (sash) => {
        const el = [...document.querySelectorAll(sash)][0];
        if (!el) return "no sash";
        el.focus();
        if (document.activeElement !== el) return "not focusable";
        const box = el.getBoundingClientRect();
        el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
        await new Promise((resolve) => requestAnimationFrame(resolve));
        return el.getBoundingClientRect().left !== box.left ? "moved" : "focusable, did not move";
      }, selectors.sash);

      // Two views over one dirty document; close and recreate a view; save and restore the layout.
      const lifecycle = {};
      await page.evaluate(() => window.spike.split());
      await page.waitForTimeout(200);
      lifecycle.boardViewsAfterSplit = await page.locator(".spike-board").count();
      lifecycle.docViewsAfterSplit = await page.evaluate(() => window.spike.docViews());
      await page.locator('[data-view="view-1"] button', { hasText: "Paint" }).click();
      lifecycle.bothViewsShowEdit = await page.evaluate(() =>
        [...document.querySelectorAll(".spike-board .spike-state")].map((el) => el.textContent),
      );
      await page.evaluate(() => window.spike.close("view-1"));
      await page.waitForTimeout(200);
      lifecycle.afterCloseView1 = { doc: await page.evaluate(() => window.spike.doc()), docViews: await page.evaluate(() => window.spike.docViews()), undoDepth: await page.evaluate(() => window.spike.undoDepth()) };
      await page.evaluate(() => window.spike.reopen("view-1"));
      await page.waitForTimeout(200);
      lifecycle.afterReopen = await page.evaluate(() => [...document.querySelectorAll('[data-view="view-1"] .spike-state')].map((el) => el.textContent));
      await page.locator('[data-view="view-2"] button', { hasText: "Undo" }).click();
      lifecycle.undoFromOtherView = await page.evaluate(() => window.spike.doc().painted);
      await page.locator('[data-view="view-2"] button', { hasText: "Paint" }).click();
      if (await page.evaluate(() => typeof window.spike.move === "function")) {
        lifecycle.move = await page.evaluate(() => window.spike.move("view-2", "files"));
      }
      if (await page.evaluate(() => typeof window.spike.float === "function")) {
        lifecycle.float = await page.evaluate(() => {
          try {
            return window.spike.float("view-2");
          } catch (error) {
            return `threw: ${error}`;
          }
        });
        await page.waitForTimeout(200);
        lifecycle.floatedViewShowsDoc = await page.evaluate(() => [...document.querySelectorAll('[data-view="view-2"] .spike-state')].map((el) => el.textContent));
      }
      const saved = await page.evaluate(() => window.spike.save());
      lifecycle.savedBytes = saved.length;
      lifecycle.restoredPanels = await page.evaluate((json) => window.spike.restore(json), saved);
      await page.waitForTimeout(300);
      lifecycle.afterRestore = {
        panels: await page.evaluate(() => window.spike.panels()),
        doc: await page.evaluate(() => window.spike.doc()),
        views: await page.evaluate(() => [...document.querySelectorAll(".spike-board .spike-state")].map((el) => el.textContent)),
      };
      lifecycle.unknownKind = await page.evaluate((json) => window.spike.unknownKind(json), saved);
      await page.waitForTimeout(300);
      lifecycle.unknownKind.placeholderAfterRender = await page.evaluate(() => document.querySelector(".spike-missing")?.textContent ?? null);
      lifecycle.unknownKind.panelsAfterRender = await page.evaluate(() => window.spike.panels());
      lifecycle.viewLog = await page.evaluate(() => ({
        mounts: window.spike.viewLog.filter((entry) => entry.event === "mount").length,
        disposes: window.spike.viewLog.filter((entry) => entry.event === "dispose").length,
      }));
      result.lifecycle = lifecycle;
      result.afterOperations = await violations(page);
      result.console = log.console.filter((entry) => entry.type === "error" || entry.type === "warning").slice(0, 10);
      result.pageErrors = log.pageErrors;
      record("dock", `${bundle}--${policyName}`, result);
      expect(result.panelsRendered).toBeGreaterThan(0);
    });
  }
}

test("dockview + our keyboard layer: keyboard-only navigation, move, resize and close with focus restoration", async ({ page }) => {
  const log = await open(page, { bundle: "dock-dockview-kbd", csp: webHostPolicy() });
  await page.waitForFunction(() => window.spikeReady === true);
  const steps = await runKeyboardSteps(page);
  const source = readFileSync(join(here, "proto/dock-keyboard.mjs"), "utf8");
  const lines = source.split("\n").filter((line) => line.trim() && !line.trim().startsWith("//")).length;
  const result = { steps, keyboardLayerLines: lines, violations: await violations(page), pageErrors: log.pageErrors, liveRegion: await page.locator("#spike-status").getAttribute("aria-live") };
  record("dock", "dockview-keyboard-layer", result);
  expect(steps.filter((s) => !s.pass).map((s) => s.label)).toEqual([]);
});
