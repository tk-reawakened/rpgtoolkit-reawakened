#!/usr/bin/env node
/** Opt-in real Chromium captures of the existing browser editor; all seeded data stays in an isolated browser OPFS. */
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { chromium, expect } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { resolve, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { BinaryReader, createEmptyBoard, createEmptyMainFile, readCharacter, readItem, writeBoard, writeCharacter, writeItem, writeMainFile, writeTileset } from "@tk-reawakened/core";
import { assertPalettesReadable, candidateStyles, contrastRatio, themes } from "./palette.mjs";
import { captureOpeningStates, captureDocumentStates } from "./states.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const requestedPort = Number(process.env.EDITOR_DESIGN_PORT ?? "0");
if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) throw new Error("EDITOR_DESIGN_PORT must be a valid TCP port");
const port = await new Promise((resolvePort, reject) => {
  const reservation = createServer();
  reservation.once("error", reject);
  reservation.listen(requestedPort, "127.0.0.1", () => {
    const address = reservation.address();
    reservation.close((error) => error ? reject(error) : resolvePort(address.port));
  });
});
const fixtureRoot = join(root, "docs/spec/examples/game");
const runId = `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomUUID()}`;
const output = resolve(process.argv.find((arg) => arg.startsWith("--out="))?.slice(6) ?? join(root, "docs/design/captures/editor-design", runId));
const paneFilter = process.argv.find((arg) => arg.startsWith("--pane="))?.slice(7);
if (paneFilter !== undefined && paneFilter !== "normal" && paneFilter !== "640") throw new Error("--pane must be normal or 640");
const desiredPaneWidths = paneFilter === undefined ? [null, 640] : [paneFilter === "normal" ? null : 640];
const surfaceFilter = process.argv.find((arg) => arg.startsWith("--surface="))?.slice(10);
const themeFilter = process.argv.find((arg) => arg.startsWith("--theme="))?.slice(8);
if (themeFilter !== undefined && !Object.hasOwn(themes, themeFilter)) throw new Error(`Unknown theme: ${themeFilter}`);
const statesOnly = process.argv.includes("--states-only");
if (statesOnly && (surfaceFilter !== undefined || themeFilter !== undefined || paneFilter !== undefined)) throw new Error("--states-only cannot be combined with surface/theme/pane filters");
const includeStates = statesOnly || (surfaceFilter === undefined && themeFilter === undefined && paneFilter === undefined);
const paletteReport = assertPalettesReadable();
const fixtureFiles = (await collectFiles(fixtureRoot)).flatMap((file) => {
  const prefix = "Game/Example/";
  const path = file.path.startsWith(prefix) ? file.path.slice(prefix.length) : file.path.startsWith("Main/") ? file.path : null;
  return path === null ? [] : [{ ...file, source: `docs/spec/examples/game/${file.path}`, path }];
});
const sparseCharacter = value(readCharacter(new BinaryReader(await readFile(join(fixtureRoot, "Game/Example/Chrs/ada.tem")))));
const sparseItem = value(readItem(new BinaryReader(await readFile(join(fixtureRoot, "Game/Example/Item/chest.itm")))));
const sparse = [
  ["Main/design-sparse.gam", "writeMainFile: minimal game settings", value(writeMainFile({ ...createEmptyMainFile(), major: 2, minor: 9, gameTitle: "Sparse project", startupPrg: "", initBoard: "", initChar: "" }))],
  ["Boards/design-sparse.brd", "writeBoard: one empty cell", value(writeBoard({ ...createEmptyBoard(), sizeX: 1, sizeY: 1, sizeL: 1, tileMatrix: [0], tileRuns: [{ lutIndex: 0, count: 1, marker: true }], layerTitles: ["", ""] }))],
  ["Chrs/design-sparse.tem", "readCharacter(ada.tem), clear graphics references, writeCharacter", value(writeCharacter({ ...sparseCharacter, name: "Sparse character", movementAnimations: sparseCharacter.movementAnimations?.map(() => ""), idleAnimations: sparseCharacter.idleAnimations?.map(() => ""), restAnimation: "", customStances: [] }))],
  ["Item/design-sparse.itm", "readItem(chest.itm), clear graphics references, writeItem", value(writeItem({ ...sparseItem, name: "Sparse item", movementAnimations: sparseItem.movementAnimations?.map(() => ""), idleAnimations: sparseItem.idleAnimations?.map(() => ""), restAnimation: "", customStances: [] }))],
  ["Tiles/design-sparse.tst", "writeTileset: one uniform white 32px tile", value(writeTileset({ version: 20, detail: { code: 1, size: 32, bytesPerPixel: 3, isometric: false }, tiles: [{ pixels: new Uint8Array(32 * 32 * 3).fill(255) }], residue: new Uint8Array() }))],
  ["Prg/design-sparse.prg", "authored empty program", new Uint8Array()],
];
for (const [path, recipe, bytes] of sparse) fixtureFiles.push({ path, source: `generated: ${recipe}`, bytes });
if (fixtureFiles.length === 0 || !fixtureFiles.some((file) => file.path === "Main/example.gam")) {
  throw new Error("Expected authored editor fixture docs/spec/examples/game/Main/example.gam");
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
}
async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const found = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await collectFiles(path)));
    else if (entry.isFile()) found.push({ path: relative(fixtureRoot, path).split(sep).join("/"), bytes: await readFile(path) });
  }
  return found;
}
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function waitForHost(url, child) {
  return new Promise((resolveReady, reject) => {
    let settled = false;
    const timeout = setTimeout(() => finish(new Error(`Timed out waiting for ${url}`)), 30_000);
    child.once("error", finish);
    child.once("exit", (code) => finish(new Error(`Browser host exited before ready (code ${code})`)));
    const poll = async () => {
      if (settled) return;
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
        if (response.ok) return finish();
      } catch { /* The owned server is still starting. */ }
      setTimeout(poll, 200);
    };
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      error ? reject(error) : resolveReady();
    }
    setTimeout(poll, 200);
  });
}

run(process.execPath, ["tools/browser/build.mjs"]);
function value(result) {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
function hex(channels) {
  return `#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}
async function renderedMetrics(page, scope = page.locator(".tkr-editor-pane:visible")) {
  const observed = await scope.locator("button, input, select, textarea").evaluateAll((elements) => {
    const rgba = (text) => {
      if (!/^rgba?\(/.test(text)) throw new Error(`Unmeasurable rendered color: ${text}`);
      const values = text.match(/[\d.]+/g).map(Number);
      return [values[0], values[1], values[2], values[3] ?? 1];
    };
    const parent = (element) => element.parentElement ?? element.getRootNode().host ?? null;
    const layers = new Map();
    const layer = (element) => {
      if (!layers.has(element)) {
        const style = getComputedStyle(element);
        layers.set(element, { color: rgba(style.backgroundColor), opacity: Number(style.opacity) });
      }
      return layers.get(element);
    };
    const background = (element, ink = [0, 0, 0, 0], omitOwnBackground = false) => {
      let front = ink;
      for (let node = element; node !== null; node = parent(node)) {
        const back = layer(node);
        if (node !== element || !omitOwnBackground) {
          const alpha = front[3] + back.color[3] * (1 - front[3]);
          front = [...front.slice(0, 3).map((channel, i) => alpha === 0 ? 0 : (channel * front[3] + back.color[i] * back.color[3] * (1 - front[3])) / alpha), alpha];
        }
        front[3] *= back.opacity;
      }
      if (front[3] < 1) throw new Error("Rendered control has no opaque backing surface");
      return front.slice(0, 3);
    };
    const label = (element) => element.getAttribute("aria-label") || Array.from(element.labels ?? []).map((label) => label.textContent.trim()).join(" ") || element.textContent.trim();
    const controls = elements.filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility === "visible"
        && !element.matches(":disabled") && !element.closest('[aria-disabled="true"]')
        && !element.matches('input[type="color"], input[type="checkbox"], input[type="radio"], [style*="background"], .monaco-editor *');
    }).map((element) => {
      const style = getComputedStyle(element);
      let opacity = 1;
      for (let node = element; node !== null; node = parent(node)) opacity *= Number(getComputedStyle(node).opacity);
      const back = background(element);
      const ink = rgba(style.color);
      const border = rgba(style.borderTopColor);
      const rect = element.getBoundingClientRect();
      return {
        label: label(element), tag: element.tagName, foreground: background(element, ink),
        background: back, adjacentBackground: background(parent(element)), boundary: background(element, border),
        boundaryVisible: Number.parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== "none",
        fontSize: style.fontSize, lineHeight: style.lineHeight, padding: style.padding, radius: style.borderRadius, opacity, width: rect.width, height: rect.height,
      };
    });
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    let focus = null;
    if (active !== null && active.matches(":focus-visible")) {
      const style = getComputedStyle(active);
      focus = { label: label(active), tag: active.tagName, outline: style.outline, outlineWidth: Number.parseFloat(style.outlineWidth), outlineColor: background(active, rgba(style.outlineColor), true), background: background(parent(active)) };
    }
    return { controls, focus };
  });
  return {
    controls: observed.controls.map((control) => ({
      ...control, textRatio: contrastRatio(hex(control.foreground), hex(control.background)),
      boundaryRatio: Math.max(control.boundaryVisible ? contrastRatio(hex(control.boundary), hex(control.adjacentBackground)) : 0, contrastRatio(hex(control.background), hex(control.adjacentBackground))),
    })),
    focus: observed.focus === null ? null : { ...observed.focus, ratio: contrastRatio(hex(observed.focus.outlineColor), hex(observed.focus.background)) },
  };
}
function assertRendered(metrics, context) {
  if (metrics.controls.length === 0) throw new Error(`No real controls measured: ${context}`);
  const failures = metrics.controls.filter((control) => control.textRatio < 4.5 || control.boundaryRatio < 3);
  if (failures.length) throw new Error(`Rendered contrast failure (${context}): ${JSON.stringify(failures)}`);
  if (metrics.focus === null || metrics.focus.outlineWidth < 2 || metrics.focus.ratio < 3) throw new Error(`Unreadable or absent actual keyboard focus (${context}): ${JSON.stringify(metrics.focus)}`);
}
const checkout = spawnSync("bash", ["-c", "pwd; git branch --show-current; git rev-parse HEAD"], { cwd: root, encoding: "utf8" });
if (checkout.error) throw checkout.error;
if (checkout.status !== 0) throw new Error(`Could not identify capture checkout: ${checkout.stderr}`);
const [directory, branch, revision] = checkout.stdout.trim().split("\n");
if (directory !== root || !/^[a-f0-9]{40}$/.test(revision)) throw new Error("Capture checkout provenance is invalid");
console.log(`Capture checkout: ${directory} (${branch} at ${revision})`);
const server = spawn(process.execPath, ["tools/browser/serve.mjs", "--port", String(port)], { cwd: root, stdio: "inherit" });
let browser;
let page;
try {
  await waitForHost(`http://127.0.0.1:${port}/health`, server);
  browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark", forcedColors: "none" });
  await context.addInitScript(async ({ files, folderName }) => {
    const rootHandle = await (await navigator.storage.getDirectory()).getDirectoryHandle(folderName, { create: true });
    for (const file of files) {
      const pieces = file.path.split("/");
      let parent = rootHandle;
      for (const piece of pieces.slice(0, -1)) parent = await parent.getDirectoryHandle(piece, { create: true });
      const handle = await parent.getFileHandle(pieces.at(-1), { create: true });
      const writer = await handle.createWritable();
      await writer.write(new Uint8Array(file.bytes));
      await writer.close();
    }
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => rootHandle });
    Reflect.set(window, "__tkrDesignFolder", rootHandle);
  }, { files: fixtureFiles.map(({ path, bytes }) => ({ path, bytes: Array.from(bytes) })), folderName: `TkrDesign-${runId}` });
  page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/tools/browser/editor-web/index.html`);
  await page.waitForFunction(() => Reflect.get(window, "__tkrDesignFolder") !== undefined);
  const states = includeStates ? await captureOpeningStates(page, output) : [];
  if (!includeStates) {
    await page.getByRole("button", { name: "Open project folder" }).click();
    await page.getByLabel("Game in project").selectOption("Main/example.gam");
    await page.getByRole("button", { name: "Open selected game" }).click();
  }
  await page.getByLabel("Game title", { exact: true }).waitFor({ state: "visible" });
  await page.locator(".tkr-editor-pane:visible").waitFor({ state: "visible" });

  await mkdir(output, { recursive: true });
  const captures = [];
  const candidateSheet = await page.addStyleTag({ content: candidateStyles });
  await candidateSheet.evaluate((element) => { element.sheet.disabled = true; });
  const surfaces = [
    { path: "Main/example.gam", name: "game-settings", label: "game settings" },
    { path: "Boards/village.brd", name: "board", label: "board" },
    { path: "Chrs/ada.tem", name: "character", label: "character" },
    { path: "Item/chest.itm", name: "item", label: "item" },
    { path: "Tiles/village.tst", name: "tileset", label: "tileset artwork" },
    { path: "Misc/hero/hero_walk_s.anm", name: "animation", label: "animation" },
    { path: "Prg/start.prg", name: "program", label: "program" },
    { path: "Bitmap/house.tbm", name: "tile-bitmap", label: "tile bitmap" },
    { path: "Main/design-sparse.gam", name: "game-settings-sparse", label: "sparse game settings" },
    { path: "Boards/design-sparse.brd", name: "board-sparse", label: "one-cell empty board" },
    { path: "Chrs/design-sparse.tem", name: "character-sparse", label: "character with no graphics references" },
    { path: "Item/design-sparse.itm", name: "item-sparse", label: "item with no graphics references" },
    { path: "Tiles/design-sparse.tst", name: "tileset-sparse", label: "single uniform tile" },
    { path: "Misc/chest/chest.anm", name: "animation-sparse", label: "minimal authored animation" },
    { path: "Prg/design-sparse.prg", name: "program-sparse", label: "empty program" },
  ];
  if (surfaceFilter !== undefined && !surfaces.some((surface) => surface.name === surfaceFilter)) throw new Error(`Unknown surface: ${surfaceFilter}`);
  const tree = page.getByRole("tree", { name: "Project files" });
  const files = page.locator(".tkr-files");
  for (const surface of surfaces) {
    if (statesOnly) continue;
    if (surfaceFilter !== undefined && surface.name !== surfaceFilter) continue;
    if (surface.path !== "Main/example.gam") {
      const parts = surface.path.split("/");
      for (const directory of parts.slice(0, -1)) {
        const folder = tree.getByRole("treeitem", { name: new RegExp(`^${directory}, folder, (closed|open)$`) });
        await folder.waitFor({ state: "visible" });
        if (await folder.getAttribute("aria-expanded") !== "true") {
          await folder.click();
          await files.getByRole("button", { name: "Open folder", exact: true }).click();
          await expect(folder).toHaveAttribute("aria-expanded", "true");
        }
      }
      const filename = parts.at(-1);
      const row = tree.getByRole("treeitem", { name: new RegExp(`^${filename.replaceAll(".", "\\.")},`) });
      await row.click();
      await files.getByRole("button", { name: "Open", exact: true }).click();
      await expect(page.getByRole("tab", { name: new RegExp(filename.replaceAll(".", "\\.")) })).toHaveAttribute("aria-selected", "true");
    }
    await page.locator(".tkr-editor-pane:visible").waitFor({ state: "visible" });
    const title = surface.name;
    for (const desiredPaneWidth of desiredPaneWidths) {
      await page.setViewportSize({ width: 1280, height: 900 });
      if (desiredPaneWidth !== null) {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const actualWidth = await page.locator(".tkr-editor-pane:visible").evaluate((element) => element.getBoundingClientRect().width);
          if (Math.round(actualWidth) === desiredPaneWidth) break;
          const currentWidth = await page.evaluate(() => window.innerWidth);
          await page.setViewportSize({ width: Math.max(640, Math.min(1600, Math.round(currentWidth + desiredPaneWidth - actualWidth))), height: 900 });
        }
      }
      const viewportWidth = await page.evaluate(() => window.innerWidth);
      let measuredPane = await page.locator(".tkr-editor-pane:visible").evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { width: Math.round(rect.width), height: Math.round(rect.height), left: Math.round(rect.left), top: Math.round(rect.top) };
      });
      if (desiredPaneWidth !== null && measuredPane.width !== desiredPaneWidth) throw new Error(`Could not size actual editor pane to ${desiredPaneWidth}px (measured ${measuredPane.width}px)`);
      const paneLabel = desiredPaneWidth === null ? "normal" : `${desiredPaneWidth}px`;
      await page.emulateMedia({ colorScheme: "dark", forcedColors: "none" });
      await candidateSheet.evaluate((element) => { element.sheet.disabled = true; });
      const currentName = `${title}-${paneLabel}-current.png`;
      await page.screenshot({ path: join(output, currentName) });
      await delay(100);
      captures.push({ file: currentName, surface: surface.label, fixture: fixtureFiles.find((file) => file.path === surface.path).source, viewport: { width: viewportWidth, height: 900 }, measuredPane, desiredPaneWidth, theme: "current-dark", presentation: "unmodified shipping styles" });
      for (const [theme, palette] of Object.entries(themes)) {
        if (themeFilter !== undefined && theme !== themeFilter) continue;
        await page.emulateMedia({ colorScheme: theme === "light" ? "light" : "dark", forcedColors: theme === "highContrast" ? "active" : "none" });
        await page.locator("html").evaluate((element, { values, theme }) => {
          element.style.colorScheme = theme === "light" ? "light" : "dark";
          for (const [key, value] of Object.entries(values)) element.style.setProperty(`--design-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, value);
          element.dataset.designTheme = theme;
        }, { values: palette, theme });
        await candidateSheet.evaluate((element) => { element.sheet.disabled = false; });
        const start = page.locator('.tkr-editor-pane:visible :is(input:not([type="hidden"]):not([type="color"]):not([type="checkbox"]), select, button):enabled:visible:not(.monaco-editor *)').first();
        if (await start.count()) await start.focus();
        else await page.getByRole("button", { name: "Application menu" }).focus();
        await page.keyboard.press("Tab");
        await page.waitForFunction(() => !document.getAnimations().some((animation) => animation.playState === "running" && animation.effect?.getTiming().iterations !== Infinity), undefined, { polling: 100, timeout: 2_000 });
        measuredPane = await page.locator(".tkr-editor-pane:visible").evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return { width: Math.round(rect.width), height: Math.round(rect.height), left: Math.round(rect.left), top: Math.round(rect.top) };
        });
        if (desiredPaneWidth !== null && measuredPane.width !== desiredPaneWidth) throw new Error(`Candidate ${theme} changed the requested ${desiredPaneWidth}px pane to ${measuredPane.width}px`);
        const metricScope = surface.name.startsWith("program") ? page.getByRole("toolbar", { name: "Workbench bar" }) : page.locator(".tkr-editor-pane:visible");
        const metrics = await renderedMetrics(page, metricScope);
        assertRendered(metrics, `${title}/${paneLabel}/${theme}`);
        const name = `${title}-${paneLabel}-${theme}.png`;
        await page.screenshot({ path: join(output, name) });
        await delay(100);
        captures.push({ file: name, surface: surface.label, fixture: fixtureFiles.find((file) => file.path === surface.path).source, viewport: { width: viewportWidth, height: 900 }, measuredPane, desiredPaneWidth, theme, forcedColors: theme === "highContrast", metrics, presentation: "candidate-only common roles on the real editor; not a production restyle or whole-view accessibility certification" });
        await candidateSheet.evaluate((element) => { element.sheet.disabled = true; });
        await page.locator("html").evaluate((element) => { element.removeAttribute("data-design-theme"); element.style.removeProperty("color-scheme"); for (const name of [...element.style]) if (name.startsWith("--design-")) element.style.removeProperty(name); });
      }
    }
  }
  await expect(page.getByRole("status", { includeHidden: true }).filter({ hasText: /^Unsaved changes$/ })).toHaveCount(0);
  if (includeStates) {
    await page.emulateMedia({ colorScheme: "dark", forcedColors: "none" });
    await page.locator("html").evaluate((element, values) => {
      element.style.colorScheme = "dark";
      for (const [key, value] of Object.entries(values)) element.style.setProperty(`--design-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, value);
      element.dataset.designTheme = "dark";
    }, themes.dark);
    await candidateSheet.evaluate((element) => { element.sheet.disabled = false; });
    states.push(...await captureDocumentStates(page, output, fixtureFiles.find((file) => file.path === "Main/design-sparse.gam").bytes));
  }
  const manifest = {
    story: "11.22 / #2987", capturedAt: new Date().toISOString(), revision, branch,
    host: { name: "Chromium", version: browser.version(), node: process.version, platform: process.platform, architecture: process.arch, url: `http://127.0.0.1:${port}/tools/browser/editor-web/index.html` },
    provenance: fixtureFiles.map(({ path, source, bytes }) => ({ path: source, projectPath: path, sha256: sha256(bytes), bytes: bytes.length })),
    captures, states, selection: { surface: surfaceFilter ?? "all", theme: themeFilter ?? "all", pane: paneFilter ?? "all", statesOnly },
    contrast: paletteReport, limitations: ["Enemy authoring has no provider and is not represented by a fake control or capture.", "Candidate CSS is isolated engineering evidence, not a shipped restyle or whole-view accessibility audit.", "Document-state snapshots are real native-IO scenarios in candidate dark; native VS Code mapping and host evidence are documented separately."],
  };
  const inputs = ["tools/editor-design/gallery.mjs", "tools/editor-design/palette.mjs", "tools/editor-design/states.mjs", "tools/browser/editor-web/index.html", "tools/browser/editor-web/dist/editor-web.js", "tools/browser/editor-web/dist/editor-web.css", "tools/browser/editor-web/dist/tileset-browser.css", "tools/browser/editor-web/dist/tileset-art.css", "tools/browser/editor-web/dist/program-view.css"];
  manifest.workingInputs = await Promise.all(inputs.map(async (path) => ({ path, sha256: sha256(await readFile(join(root, path))) })));
  for (const file of fixtureFiles) {
    if (file.source.startsWith("docs/") && sha256(await readFile(join(root, file.source))) !== sha256(file.bytes)) throw new Error(`Authored source fixture changed: ${file.source}`);
  }
  await writeFile(join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Editor design gallery: ${captures.length} surface captures and ${states.length} state captures in ${output}`);
} catch (error) {
  await mkdir(output, { recursive: true });
  if (page !== undefined) {
    await writeFile(join(output, "failure.txt"), `${String(error)}\n${await page.locator("body").ariaSnapshot().catch(String)}\n`);
    await page.screenshot({ path: join(output, "failure.png"), timeout: 2_000 }).catch((captureError) => console.error("Failure capture unavailable:", captureError));
  }
  console.error(`Gallery evidence: ${output}`);
  throw error;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await Promise.race([new Promise((resolveExit) => server.once("exit", resolveExit)), delay(3_000)]);
  if (server.exitCode === null) server.kill("SIGKILL");
}
