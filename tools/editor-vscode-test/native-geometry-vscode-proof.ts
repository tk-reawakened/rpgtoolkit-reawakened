import type { expect as playwrightExpect, Frame, Page } from "@playwright/test";
import { GEOMETRY_SCENE } from "./native-geometry-fixture.ts";
import { proveNativeGeometry } from "./native-geometry-proof.ts";
import { openNativeQuickOpenFile } from "./native-quick-open.ts";

type Expect = typeof playwrightExpect;

export async function runVscodeNativeGeometryProof(page: Page, expect: Expect, read: (path: string) => Promise<Uint8Array>): Promise<void> {
  const widget = page.locator(".quick-input-widget");
  const palette = widget.locator("input:visible");
  const showCommands = async (query: string) => {
    await page.keyboard.press("ControlOrMeta+Shift+P");
    await expect(palette).toHaveCount(1);
    await palette.fill(`>${query}`);
  };
  const command = async (title: string) => {
    await showCommands(title);
    await widget.getByRole("option", { name: new RegExp(`^${title}(?:,|$)`) }).click();
    await expect(widget).toBeHidden();
  };
  const reopenAs = async (name: RegExp) => {
    await showCommands("reopen editor with");
    await widget.getByRole("option", { name: /Reopen Editor With(?:\.\.\.|…)/i }).first().click();
    await widget.getByRole("option", { name }).click();
    await expect(widget).toBeHidden();
  };
  // Other journeys leave tabs open. Only this journey's visible scene/owner frames should receive clicks.
  await command("View: Close All Editors");
  await expect(page.getByRole("tab", { name: /^village\.tkrscn/ })).toHaveCount(0);

  const tab = (path: string) => page.getByRole("tab").filter({ hasText: path.slice(path.lastIndexOf("/") + 1) });
  const frameWith = async (name: string): Promise<Frame> => {
    let active: Frame | undefined;
    await expect.poll(async () => {
      for (const frame of page.frames()) if (await frame.getByRole("region", { name, exact: true }).isVisible().catch(() => false)) {
        active = frame;
        return true;
      }
      return false;
    }, { timeout: 20_000 }).toBe(true);
    if (active === undefined) throw new Error(`VS Code did not open ${name}`);
    return active;
  };
  await openNativeQuickOpenFile(page, expect, GEOMETRY_SCENE);
  await proveNativeGeometry(expect, {
    read,
    openScene: async () => {
      await tab(GEOMETRY_SCENE).click();
      return frameWith("Scene terrain editor");
    },
    openedOwner: async (path) => {
      await expect(tab(path)).toHaveAttribute("aria-selected", "true");
      return frameWith("Collision and walk-behind");
    },
    closeOwner: async (path) => {
      await command("View: Close Editor");
      await expect(tab(path)).toHaveCount(0);
    },
    verifyOwnerHistory: async () => {
      // Use the native text surface for VS Code Undo and Redo, as both editors share its TextDocument.
      await reopenAs(/^Text Editor(?:,|$)/);
      const source = page.locator(".monaco-workbench .monaco-editor:visible").last().locator(".view-lines");
      await expect(source).toContainText("Fence rails");
      await command("Undo");
      await expect(source).not.toContainText("Fence rails");
      await command("Redo");
      await expect(source).toContainText("Fence rails");
      await reopenAs(/^RPG Toolkit Native Collision and Walk-behind(?:,|$)/);
      const surface = await frameWith("Collision and walk-behind");
      await expect(surface.locator('[data-tkr-shape="solid:0"]')).toContainText("Fence rails");
      return surface;
    },
    save: async (surface, pane) => {
      await surface.getByRole("region", { name: pane === "scene" ? "Scene terrain editor" : "Collision and walk-behind", exact: true })
        .getByRole("button", { name: "Save", exact: true }).click();
    },
  });
}
