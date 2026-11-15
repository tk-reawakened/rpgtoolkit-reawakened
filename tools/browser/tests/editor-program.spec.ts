import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

// Story 11.7 (#1705), the browser host: a real `.prg` edited in Monaco under the accepted CSP of ADR 0029, with the
// language server in a worker, over the real standalone page and a project folder. The VS Code half of the proof is
// `tools/vscode-web` (the native text editor with the same language server).

interface ProofWindow extends Window {
  __tkrCspViolations?: { readonly directive: string; readonly blocked: string }[];
  __tkrTestFolder?: FileSystemDirectoryHandle;
}
interface PickerInput {
  readonly path: string;
  readonly bytes: readonly number[];
}

const PAGE = "/tools/browser/editor-web/index.html";
const PROGRAM = "Prg/intro.prg";
const main = Array.from(readFileSync(new URL("../../../docs/spec/examples/game/Main/example.gam", import.meta.url)));
/** CRLF endings, a Windows-1252 byte (0xE9) in a string, a label, a function, comments of three forms and no final newline. */
const SOURCE = '// Intro scene\r\nfunction greet(name) {\r\n    mwin("Hello, caf\u00e9")\r\n}\r\n:retry\r\n** Wrap up\r\nx = 1 // trailing';
const programBytes = Array.from(Buffer.from(SOURCE, "latin1"));

/** Monaco's "go to the end of the text": Command+Down on a Mac, Control+End elsewhere. */
const END_OF_TEXT = process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End";

test.use({ trace: "retain-on-failure" });

async function installProject(page: Page, files: readonly PickerInput[]): Promise<void> {
  const folderName = `TkrProgram-${randomUUID()}`;
  await page.addInitScript(async ({ inputs, name }: { readonly inputs: readonly PickerInput[]; readonly name: string }) => {
    window.addEventListener("securitypolicyviolation", (event) => {
      ((window as ProofWindow).__tkrCspViolations ??= []).push({ directive: event.effectiveDirective, blocked: event.blockedURI });
    });
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
    for (const input of inputs) {
      const parts = input.path.split("/");
      let parent = root;
      for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part, { create: true });
      const file = await parent.getFileHandle(parts.at(-1)!, { create: true });
      if ((await file.getFile()).size > 0) continue;
      const writable = await file.createWritable();
      await writable.write(new Uint8Array(input.bytes));
      await writable.close();
    }
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => root });
    (window as ProofWindow).__tkrTestFolder = root;
  }, { inputs: files, name: folderName });
}

async function openProgram(page: Page): Promise<void> {
  await page.goto(PAGE);
  await page.waitForFunction(() => (window as ProofWindow).__tkrTestFolder !== undefined);
  await page.getByRole("button", { name: "Open project folder" }).click();
  await expect(page.getByLabel("Game title")).toBeVisible();
  await page.getByRole("treeitem", { name: "Prg, folder, closed", exact: true }).press("ArrowRight");
  await page.getByRole("treeitem", { name: /^intro\.prg, program editor/ }).dblclick();
  await expect(page.getByRole("tab", { name: PROGRAM, exact: true })).toBeVisible();
  await expect(page.locator(".monaco-editor .view-lines")).toBeVisible();
}

/** The file as the host stores it, as Latin-1 text, once it satisfies `accept` (a save is asynchronous). */
const savedText = async (page: Page, path: string, accept: (text: string) => boolean): Promise<string> => {
  let text = "";
  await expect.poll(async () => {
    const bytes = await page.evaluate(async (target) => {
      try {
        let handle: FileSystemDirectoryHandle = (window as ProofWindow).__tkrTestFolder!;
        const parts = target.split("/");
        for (const part of parts.slice(0, -1)) handle = await handle.getDirectoryHandle(part);
        const file = await (await handle.getFileHandle(parts.at(-1)!)).getFile();
        return Array.from(new Uint8Array(await file.arrayBuffer()));
      } catch (error) {
        if (error instanceof DOMException && error.name === "NotFoundError") return null;
        throw error;
      }
    }, path);
    if (bytes === null) return false;
    text = Buffer.from(bytes).toString("latin1");
    return accept(text);
  }).toBe(true);
  return text;
};
const violations = (page: Page): Promise<readonly { readonly directive: string; readonly blocked: string }[]> =>
  page.evaluate(() => (window as ProofWindow).__tkrCspViolations ?? []);

/** The innermost spans of the visible lines: the ones Monaco gives a colour class. */
const leaf = (page: Page) => page.locator(".monaco-editor .view-line span:not(:has(span))");

/** Click into the text and go to its end: the editor's input element is Monaco's own, so the test reaches it as a person does. */
async function focusEnd(page: Page): Promise<void> {
  await page.locator(".monaco-editor .view-lines").click({ position: { x: 4, y: 4 } });
  await page.keyboard.press(END_OF_TEXT);
}

/** The visible text in line order: Monaco recycles line elements, so their order in the page is not the order of the lines. */
const editorText = (page: Page): Promise<string> =>
  page.locator(".monaco-editor .view-lines").evaluate((node) =>
    [...node.querySelectorAll<HTMLElement>(".view-line")]
      .sort((left, right) => parseFloat(left.style.top) - parseFloat(right.style.top))
      .map((line) => line.innerText.replace(/\u00a0/g, " "))
      .join("\n"));

test("a program edits and saves in Monaco with colouring, bookmarks, call tips, command and header insertion and distraction-free mode, under the strict CSP", async ({ page, baseURL }) => {
  const consoleProblems: string[] = [];
  const outside: string[] = [];
  const workerUrls: string[] = [];
  page.on("worker", (worker) => workerUrls.push(worker.url()));
  page.on("console", (message) => {
    if (/web worker|Falling back|trusted ?types/i.test(message.text())) consoleProblems.push(message.text());
  });
  // Nothing is fetched from another origin: every asset and worker is the page's own (the "offline" claim).
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(baseURL!).origin || url.protocol === "data:" || url.protocol === "blob:") return route.continue();
    outside.push(route.request().url());
    return route.abort();
  });
  await installProject(page, [{ path: "Main/example.gam", bytes: main }, { path: PROGRAM, bytes: programBytes }]);
  await openProgram(page);

  // The page's policy is the one ADR 0029 accepted: strict scripts, inline styles and own fonts for Monaco, nothing else.
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  expect(policy).toContain("script-src 'self'");
  expect(policy).toContain("style-src 'self' 'unsafe-inline'");
  expect(policy).toContain("font-src 'self'");
  expect(policy).not.toContain("unsafe-eval");
  expect(policy).not.toMatch(/script-src[^;]*unsafe-inline/);

  // Live colouring: the comment, the keyword and the string take the preference colours once the server's tokens arrive.
  const intro = leaf(page).filter({ hasText: "// Intro scene" }).first();
  await expect(intro).toHaveCSS("color", "rgb(0, 128, 0)");
  await expect(leaf(page).filter({ hasText: /^function$/ }).first()).toHaveCSS("color", "rgb(0, 0, 255)");
  await expect(leaf(page).filter({ hasText: /^"Hello,\s*caf\u00e9"$/ }).first()).toHaveCSS("color", "rgb(163, 21, 21)");
  // A built-in command is a keyword colour too (docs/spec/engine/rpgcode-tooling.md#tool-10).
  await expect(leaf(page).filter({ hasText: /^mwin$/ }).first()).toHaveCSS("color", "rgb(0, 0, 255)");

  // Bookmarks: functions, labels and the comments that start a line, in source order; choosing one moves the cursor there.
  const bookmarks = page.getByRole("navigation", { name: /Bookmarks/ }).getByRole("button");
  await expect(bookmarks).toHaveText([/Comment\s+Intro scene/, /Function\s+greet/, /Label\s+:?retry/, /Comment\s+Wrap up/]);
  await bookmarks.nth(1).click();
  await page.keyboard.press("Home");
  await page.keyboard.type("// ");
  await expect.poll(() => editorText(page)).toContain("// function greet(name) {");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => editorText(page)).not.toContain("// function greet");

  // Call tips: typing the opening bracket of a built-in shows its signature from the language server.
  await page.keyboard.press(END_OF_TEXT);
  await page.keyboard.press("Enter");
  await page.keyboard.type("mwin(");
  await expect(page.locator(".parameter-hints-widget")).toContainText(/mwin\(/i);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  // Command reference insertion: double-click a row, and it is written at the cursor as one undoable edit.
  await page.getByLabel("Find a command").fill("castint");
  const row = page.locator(".tkr-program-reference-list button").first();
  await expect(row).toContainText("castint(val, [&dest])");
  await row.dblclick();
  await expect.poll(() => editorText(page)).toContain("castint(val)");

  // Header template: inserted at the start, expanded for this file, undone in one step.
  await page.getByRole("button", { name: "Insert header" }).click();
  await expect.poll(() => editorText(page)).toMatch(/^\/\/ intro\.prg\s/);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => editorText(page)).toMatch(/^\/\/ Intro scene/);

  // Distraction-free mode: only the text and a way out; Escape brings the tools back; nothing changed in the document.
  await page.getByRole("button", { name: "Distraction-free" }).click();
  await expect(page.getByRole("toolbar", { name: "Program tools" })).toHaveCount(0);
  await expect(page.locator(".monaco-editor .view-lines")).toBeVisible();
  await page.getByRole("button", { name: /Exit distraction-free/ }).click();
  await expect(page.getByRole("toolbar", { name: "Program tools" })).toBeVisible();

  // Save: the typed text, the CRLF endings, the Windows-1252 byte and the missing final newline all reach the file.
  await focusEnd(page);
  await page.keyboard.type("\n   y = 2");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  // Format Document: the server's formatter answers and Monaco computes the minimal edit in its editor worker.
  // Through the command palette: the key chord differs between platforms, the command does not.
  await page.keyboard.press("F1");
  await page.keyboard.type("Format Document");
  await expect(page.locator(".quick-input-widget .quick-input-list-entry").first()).toContainText("Format Document");
  await page.keyboard.press("Enter");
  await expect.poll(() => editorText(page)).toContain("\ny = 2");
  await page.keyboard.press("ControlOrMeta+s");
  const saved = await savedText(page, PROGRAM, (text) => text.endsWith("y = 2"));
  await expect(page.locator(".tkr-program-state")).toContainText("All changes saved");
  expect(saved.startsWith('// Intro scene\r\nfunction greet(name) {\r\n    mwin("Hello, caf\u00e9")\r\n}\r\n:retry\r\n** Wrap up\r\nx = 1 // trailing')).toBe(true);
  expect(saved).toContain("mwin(");
  expect(saved.endsWith("\r\ny = 2")).toBe(true);
  expect(saved.replace(/\r\n/g, "").includes("\n")).toBe(false);

  // Reopen: the saved program reads back as the same text.
  // The page toolbar sits below the fold in the merged layout; the click is what a person would make after scrolling.
  await page.locator("#close").dispatchEvent("click");
  await expect(page.getByRole("tab", { name: PROGRAM, exact: true })).toHaveCount(0);
  await page.getByRole("treeitem", { name: /^intro\.prg, program editor/ }).dblclick();
  await expect(page.locator(".monaco-editor .view-lines")).toBeVisible();
  await expect.poll(() => editorText(page)).toContain("y = 2");

  // The two workers are the page's own classic scripts and nothing needed another origin or a blob.
  const workers = workerUrls.map((url) => new URL(url).pathname);
  expect(workers).toEqual(expect.arrayContaining([expect.stringMatching(/monaco-editor\.worker\.js$/), expect.stringMatching(/language-worker\.js$/)]));
  expect(workerUrls.every((url) => !url.startsWith("blob:"))).toBe(true);
  expect(outside).toEqual([]);
  expect(consoleProblems).toEqual([]);
  expect(await violations(page)).toEqual([]);
});

test("the probe can fail: under the strict policy of the other editor pages Monaco is blocked, and the violations are reported", async ({ page }) => {
  await installProject(page, [{ path: "Main/example.gam", bytes: main }, { path: PROGRAM, bytes: programBytes }]);
  await page.route((url) => url.pathname === PAGE, async (route) => {
    const response = await route.fetch();
    const html = (await response.text()).replace("style-src 'self' 'unsafe-inline'; font-src 'self'; worker-src 'self'", "style-src 'self'");
    await route.fulfill({ response, body: html, headers: { ...response.headers(), "content-security-policy": "frame-ancestors 'none'" } });
  });
  await openProgram(page);
  await expect.poll(async () => (await violations(page)).map((violation) => violation.directive)).toEqual(expect.arrayContaining(["style-src-attr"]));
});

test("a language server that cannot load leaves the program editable, saveable and reopenable, and says so", async ({ page }) => {
  await installProject(page, [{ path: "Main/example.gam", bytes: main }, { path: PROGRAM, bytes: programBytes }]);
  await page.route("**/language-worker.js", (route) => route.abort());
  await openProgram(page);
  await expect(page.locator(".tkr-program-language-note")).toContainText(/Language features (are unavailable|stopped)/);
  await focusEnd(page);
  await page.keyboard.type("\nz = 3");
  await page.keyboard.press("ControlOrMeta+s");
  const unserved = await savedText(page, PROGRAM, (text) => text.endsWith("z = 3"));
  expect(unserved.endsWith("x = 1 // trailing\r\nz = 3")).toBe(true);
  await expect(page.locator(".tkr-program-state")).toContainText("All changes saved");
  // Header and command insertion do not use the server.
  await page.getByRole("button", { name: "Insert header" }).click();
  await expect.poll(() => editorText(page)).toMatch(/^\/\/ intro\.prg/);
});

test("an edit the document cannot store is refused whole, said in an alert, and the editor goes back to the document's text", async ({ page }) => {
  await installProject(page, [{ path: "Main/example.gam", bytes: main }, { path: PROGRAM, bytes: programBytes }]);
  await openProgram(page);
  await focusEnd(page);
  await page.keyboard.insertText("\u2603");
  await expect(page.getByRole("alert").filter({ hasText: "U+2603" })).toBeVisible();
  await expect.poll(() => editorText(page)).not.toContain("\u2603");
});
