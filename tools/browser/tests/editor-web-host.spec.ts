import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

interface ProofWindow extends Window { __tkrCspViolations?: string[] }
type PickerInput = { readonly path: string; readonly bytes: readonly number[] };

const validMain = Array.from(readFileSync(new URL("../../../docs/spec/examples/game/Main/example.gam", import.meta.url)));

test("browser host mounts the shared settings view and keeps CSP quiet while editing a session copy", async ({ page }) => {
  await page.addInitScript(() => {
    window.addEventListener("securitypolicyviolation", (event) => {
      const target = window as ProofWindow;
      (target.__tkrCspViolations ??= []).push(event.effectiveDirective);
    });
  });
  await page.goto("/tools/browser/editor-web/index.html");
  await expect(page.getByRole("heading", { name: "RPG Toolkit game settings" })).toBeVisible();
  await page.locator("#open-session").setInputFiles("docs/spec/examples/game/Main/example.gam");
  const title = page.getByLabel("Game title");
  await expect(title).toBeVisible();
  await expect(page.getByText(/session copy; changes stay in memory/)).toBeVisible();
  const nextTitle = `Browser host proof ${Date.now()}`;
  await title.fill(nextTitle);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(title).toHaveValue(nextTitle);
  await expect(page.getByRole("status").filter({ hasText: "All changes saved" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as ProofWindow).__tkrCspViolations ?? [])).toEqual([]);
});

test("browser folder open discovers a nested game", async ({ page }) => {
  await installFolderPicker(page, [{ path: "Games/Only.gam", bytes: validMain }]);
  await page.goto("/tools/browser/editor-web/index.html");
  await page.getByRole("button", { name: "Open project folder" }).click();
  await expect(page.getByLabel("Game title")).toBeVisible();
  await expect(page.locator("#host-status")).toContainText("Games/Only.gam");
});

test("browser folder open requires explicit selection when multiple nested games are found", async ({ page }) => {
  await installFolderPicker(page, [
    { path: "Games/First.gam", bytes: validMain },
    { path: "Nested/Second.gam", bytes: validMain },
  ]);
  await page.goto("/tools/browser/editor-web/index.html");
  await page.getByRole("button", { name: "Open project folder" }).click();
  const selector = page.getByLabel("Game in project");
  await expect(selector).toBeVisible();
  await expect(selector.locator("option")).toHaveCount(2);
  await selector.selectOption("Nested/Second.gam");
  await page.getByRole("button", { name: "Open selected game" }).click();
  await expect(page.getByLabel("Game title")).toBeVisible();
  await expect(page.locator("#host-status")).toContainText("Nested/Second.gam");
});

test("opening another session replaces only the old view and a failed open preserves the current view", async ({ page }) => {
  await page.goto("/tools/browser/editor-web/index.html");
  const fileInput = page.locator("#open-session");
  await fileInput.setInputFiles("docs/spec/examples/game/Main/example.gam");
  const title = page.getByLabel("Game title");
  await expect(title).toBeVisible();
  await title.fill("Unsaved title from prior view");

  await fileInput.setInputFiles("docs/spec/examples/versions/main/main_minor4.gam");
  await expect(title).toBeVisible();
  await expect(title).not.toHaveValue("Unsaved title from prior view");
  await expect(page.locator("#host-status")).toContainText("main_minor4.gam");
  const currentTitle = await title.inputValue();

  await fileInput.setInputFiles({ name: "broken.gam", mimeType: "application/octet-stream", buffer: Buffer.from([1, 2, 3]) });
  await expect(page.locator("#host-status")).toContainText("broken.gam");
  await expect(title).toBeVisible();
  await expect(title).toHaveValue(currentTitle);
});

async function installFolderPicker(page: import("@playwright/test").Page, files: readonly PickerInput[]): Promise<void> {
  await page.addInitScript((inputs: readonly PickerInput[]) => {
    class Directory {
      readonly kind = "directory";
      readonly children = new Map<string, Directory | { readonly kind: "file"; bytes: Uint8Array }>();
      constructor(readonly name: string) {}
      async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle> {
        let child = this.children.get(name);
        if (!child && options?.create) { child = new Directory(name); this.children.set(name, child); }
        if (!child) throw new DOMException("Not found", "NotFoundError");
        if (child.kind !== "directory") throw new DOMException("Not a directory", "TypeMismatchError");
        return child as unknown as FileSystemDirectoryHandle;
      }
      async getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle> {
        let file = this.children.get(name);
        if (!file && options?.create) { file = { kind: "file", bytes: new Uint8Array() }; this.children.set(name, file); }
        if (!file) throw new DOMException("Not found", "NotFoundError");
        if (file.kind === "directory") throw new DOMException("Is a directory", "TypeMismatchError");
        return {
          getFile: async () => new File([file.bytes.slice().buffer as ArrayBuffer], name),
          createWritable: async () => ({ write: async (buffer: ArrayBuffer) => { file.bytes = new Uint8Array(buffer); }, close: async () => undefined }) as FileSystemWritableFileStream,
        } as FileSystemFileHandle;
      }
      async *entries(): AsyncGenerator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]> {
        for (const [name, child] of this.children) yield [name, (child.kind === "directory" ? child : await this.getFileHandle(name)) as FileSystemFileHandle | FileSystemDirectoryHandle];
      }
    }
    const root = new Directory("Test project");
    for (const input of inputs) {
      const parts = input.path.split("/");
      let current = root;
      for (const part of parts.slice(0, -1)) {
        let child = current.children.get(part);
        if (!(child instanceof Directory)) { child = new Directory(part); current.children.set(part, child); }
        current = child;
      }
      current.children.set(parts.at(-1)!, { kind: "file", bytes: new Uint8Array(input.bytes) });
    }
    (window as Window & { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = async () => root as unknown as FileSystemDirectoryHandle;
  }, files);
}
