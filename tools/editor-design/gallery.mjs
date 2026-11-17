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
const args = process.argv.slice(2);
const shipping = args.includes("--shipping");
const phaseArg = args.find((arg) => arg.startsWith("--phase="))?.slice(8);
if (shipping && phaseArg !== "before" && phaseArg !== "after") throw new Error("Shipping captures require --phase=before or --phase=after");
if (!shipping && phaseArg !== undefined) throw new Error("--phase is only valid with --shipping");
const phase = shipping ? phaseArg : null;
const paneFilter = args.find((arg) => arg.startsWith("--pane="))?.slice(7);
if (paneFilter !== undefined && paneFilter !== "normal" && paneFilter !== "640") throw new Error("--pane must be normal or 640");
const desiredPaneWidths = paneFilter === undefined ? [null, 640] : [paneFilter === "normal" ? null : 640];
const surfaceFilter = args.find((arg) => arg.startsWith("--surface="))?.slice(10);
const themeFilter = args.find((arg) => arg.startsWith("--theme="))?.slice(8);
if (themeFilter !== undefined && !Object.hasOwn(themes, themeFilter)) throw new Error(`Unknown theme: ${themeFilter}`);
const statesOnly = args.includes("--states-only");
if (statesOnly && (shipping || surfaceFilter !== undefined || themeFilter !== undefined || paneFilter !== undefined)) throw new Error("--states-only cannot be combined with shipping or surface/theme/pane filters");
const includeStates = statesOnly || (!shipping && surfaceFilter === undefined && themeFilter === undefined && paneFilter === undefined);
const paletteReport = shipping ? [] : assertPalettesReadable();
if (shipping && statesOnly) throw new Error("Shipping mode captures the real surface matrix; run the existing state proof separately");
const output = resolve(args.find((arg) => arg.startsWith("--out="))?.slice(6) ?? join(root, shipping ? "docs/design/captures/editor-style" : "docs/design/captures/editor-design", runId));
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
const longResourceName = "this-is-a-deliberately-long-authored-program-resource-name-for-editor-workbench-tab-reachability-check.prg";
const longResourcePath = `Prg/${longResourceName}`;
if (shipping) {
  const programFixture = fixtureFiles.find((file) => file.path === "Prg/start.prg");
  if (programFixture === undefined) throw new Error("Expected authored Prg/start.prg for the shipping-only long-name probe");
  fixtureFiles.push({ path: longResourcePath, source: `generated: byte-identical shipping-only copy of ${programFixture.source}`, bytes: Buffer.from(programFixture.bytes) });
}
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
const sourceInputs = [
  "tools/editor-design/gallery.mjs", "tools/editor-design/palette.mjs", "tools/editor-design/states.mjs",
  "tools/browser/editor-web/index.html", "tools/browser/editor-web/main.tsx", "tools/browser/build.mjs",
  "packages/editor-ui/src/tileset-browser.css", "packages/editor-ui/src/tileset-art.css", "packages/editor-ui/src/program-view.css", "packages/editor-ui/src/program-view.tsx", "packages/editor-ui/src/workbench.tsx",
];
const sourceInputHashes = await Promise.all(sourceInputs.map(async (path) => ({ path, sha256: sha256(await readFile(join(root, path))) })));
function value(result) {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
function hex(channels) {
  return `#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}
async function renderedMetrics(page, scope = page.locator(".tkr-editor-pane:visible"), shippingMode = false) {
  const observed = await scope.locator("button, input, select, textarea").evaluateAll((elements, shippingMode) => {
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
    const label = (element) => element.getAttribute("aria-label") || Array.from(element.labels ?? []).map((item) => item.textContent.trim()).join(" ") || element.textContent.trim();
    const controls = elements.filter((element) => {
      const rect = element.getBoundingClientRect();
      const disabled = element.matches(":disabled") || element.closest('[aria-disabled="true"]') !== null;
      let effectiveOpacity = 1;
      for (let node = element; node !== null; node = parent(node)) effectiveOpacity *= Number(getComputedStyle(node).opacity);
      const inViewport = rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
      return rect.width > 0 && rect.height > 0 && (shippingMode ? inViewport && effectiveOpacity > 0 : true)
        && getComputedStyle(element).visibility === "visible"
        && (shippingMode || !element.matches('input[type="color"], input[type="checkbox"], input[type="radio"], [style*="background"]'))
        && !element.closest(".monaco-editor")
        && (shippingMode || !disabled);
    }).map((element) => {
      const style = getComputedStyle(element);
      let opacity = 1;
      for (let node = element; node !== null; node = parent(node)) opacity *= Number(getComputedStyle(node).opacity);
      const back = background(element);
      const ink = rgba(style.color);
      const border = rgba(style.borderTopColor);
      const rect = element.getBoundingClientRect();
      const selected = element.matches('[aria-pressed="true"], [aria-selected="true"]');
      const boundaryVisible = Number.parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== "none";
      const textRequired = !shippingMode || !(element.tagName === "INPUT" && ["color", "checkbox", "radio", "range"].includes(element.type));
      const textOnlyButton = element.tagName === "BUTTON" && !boundaryVisible && rgba(style.backgroundColor)[3] === 0 && !selected;
      const boundaryRequired = shippingMode ? !textOnlyButton : true;
      return {
        label: label(element), tag: element.tagName, foreground: background(element, ink),
        background: back, adjacentBackground: background(parent(element)), boundary: background(element, border),
        boundaryVisible, boundaryRequired, textRequired,
        fontSize: style.fontSize, lineHeight: style.lineHeight, padding: style.padding, radius: style.borderRadius, opacity, width: rect.width, height: rect.height,
        disabled: element.matches(":disabled") || element.closest('[aria-disabled="true"]') !== null,
        readOnly: element.matches("[readonly]"), selected,
      };
    });
    const helperSelector = "label, .tkr-program-bookmark-kind, .tkr-program-bookmark-line, .tkr-program-reference-hint, .tkr-program-state, .tkr-program-message, .tkr-program-language-note, .tkr-program-readonly, .tkr-program-host-note";
    const helperTexts = shippingMode ? [...document.querySelectorAll(helperSelector)].filter((element) => {
      const rect = element.getBoundingClientRect();
      let opacity = 1;
      for (let node = element; node !== null; node = parent(node)) opacity *= Number(getComputedStyle(node).opacity);
      return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight
        && opacity > 0 && getComputedStyle(element).visibility === "visible" && element.textContent.trim().length > 0 && !element.closest(".monaco-editor");
    }).map((element) => {
      const style = getComputedStyle(element);
      const text = element.textContent.trim();
      return {
        selector: element.className || element.tagName.toLowerCase(), text: text.slice(0, 160), foreground: background(element, rgba(style.color)),
        background: background(element), fontSize: style.fontSize, disabled: element.control?.matches(":disabled") ?? false, opacity: (() => {
          let value = 1;
          for (let node = element; node !== null; node = parent(node)) value *= Number(getComputedStyle(node).opacity);
          return value;
        })(),
      };
    }) : [];
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    let focus = null;
    if (active !== null && active.matches(":focus-visible")) {
      const style = getComputedStyle(active);
      focus = { label: label(active), tag: active.tagName, outline: style.outline, outlineWidth: Number.parseFloat(style.outlineWidth), outlineColor: background(active, rgba(style.outlineColor), true), background: background(parent(active)) };
    }
    return { controls, helperTexts, focus };
  }, shippingMode);
  return {
    controls: observed.controls.map((control) => ({
      ...control, textRatio: contrastRatio(hex(control.foreground), hex(control.background)),
      boundaryRatio: Math.max(control.boundaryVisible ? contrastRatio(hex(control.boundary), hex(control.adjacentBackground)) : 0, contrastRatio(hex(control.background), hex(control.adjacentBackground))),
    })),
    helperTexts: observed.helperTexts.map((helper) => ({
      ...helper, textRatio: contrastRatio(hex(helper.foreground), hex(helper.background)),
    })),
    focus: observed.focus === null ? null : { ...observed.focus, ratio: contrastRatio(hex(observed.focus.outlineColor), hex(observed.focus.background)) },
  };
}
function renderedViolations(metrics) {
  const failures = metrics.controls.filter((control) => !control.disabled && ((control.textRequired && control.textRatio < 4.5) || (control.boundaryRequired && control.boundaryRatio < 3)));
  failures.push(...metrics.helperTexts.filter((helper) => !helper.disabled && helper.textRatio < 4.5).map((helper) => ({ kind: "helper-text-contrast", ...helper })));
  if (metrics.focus === null || metrics.focus.outlineWidth < 2 || metrics.focus.ratio < 3) failures.push({ kind: "keyboard-focus", focus: metrics.focus });
  return failures;
}
function assertRendered(metrics, context) {
  if (metrics.controls.length === 0) throw new Error(`No real controls measured: ${context}`);
  const failures = renderedViolations(metrics);
  if (failures.length) throw new Error(`Rendered contrast failure (${context}): ${JSON.stringify(failures)}`);
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
  const opfsBefore = shipping ? await page.evaluate(async (paths) => {
    const root = Reflect.get(window, "__tkrDesignFolder");
    const result = {};
    for (const path of paths) {
      let directory = root;
      const parts = path.split("/");
      for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
      const file = await directory.getFileHandle(parts.at(-1));
      result[path] = Array.from(new Uint8Array(await (await file.getFile()).arrayBuffer()));
    }
    return result;
  }, fixtureFiles.map((file) => file.path)) : null;

  await mkdir(output, { recursive: true });
  const captures = [];
  const candidateSheet = shipping ? null : await page.addStyleTag({ content: candidateStyles });
  if (candidateSheet !== null) await candidateSheet.evaluate((element) => { element.sheet.disabled = true; });
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
      if (shipping) {
        for (const theme of Object.keys(themes)) {
          if (themeFilter !== undefined && theme !== themeFilter) continue;
          await page.emulateMedia({ colorScheme: theme === "light" ? "light" : "dark", forcedColors: theme === "highContrast" ? "active" : "none" });
          const start = page.locator('.tkr-editor-pane:visible :is(input:not([type="hidden"]):not([type="color"]):not([type="checkbox"]), select, button):enabled:visible:not(.monaco-editor *)').first();
          if (await start.count()) await start.focus();
          else await page.getByRole("button", { name: "Application menu" }).focus();
          await page.keyboard.press("Tab");
          await page.waitForFunction(() => !document.getAnimations().some((animation) => animation.playState === "running" && animation.effect?.getTiming().iterations !== Infinity), undefined, { polling: 100, timeout: 2_000 });
          measuredPane = await page.locator(".tkr-editor-pane:visible").evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return { width: Math.round(rect.width), height: Math.round(rect.height), left: Math.round(rect.left), top: Math.round(rect.top) };
          });
          if (desiredPaneWidth !== null && measuredPane.width !== desiredPaneWidth) throw new Error(`Shipping ${theme} changed the requested ${desiredPaneWidth}px pane to ${measuredPane.width}px`);
          const metrics = await renderedMetrics(page, page, true);
          if (metrics.controls.length === 0) throw new Error(`No actual browser controls measured for ${surface.name}/${paneLabel}/${theme}`);
          const violations = renderedViolations(metrics);
          const layout = await layoutMetrics(page);
          const layoutViolations = [
            ...layout.overlaps.map((overlap) => ({ kind: "overlap", ...overlap })),
            ...layout.outsideViewport.map((control) => ({ kind: "outside-viewport", ...control })),
          ];
          const name = `${title}-${paneLabel}-${theme}.png`;
          await page.screenshot({ path: join(output, name) });
          await delay(100);
          captures.push({
            file: name, phase, surface: surface.label, fixture: fixtureFiles.find((file) => file.path === surface.path).source,
            viewport: layout.viewport, measuredPane, desiredPaneWidth, theme, forcedColors: theme === "highContrast",
            metrics, layout, violations, layoutViolations, presentation: "actual linked shipping styles; no candidate stylesheet",
          });
          if (surface.name === "program" && theme === (themeFilter ?? "dark") && desiredPaneWidth === 640) {
            const reference = page.getByRole("button", { name: "Command reference", exact: true });
            if (await reference.isVisible()) {
              await reference.click();
              const shelfClosed = await layoutMetrics(page);
              const shelfClosedFile = `${title}-${paneLabel}-${theme}-reference-closed.png`;
              await page.screenshot({ path: join(output, shelfClosedFile) });
              await delay(100);
              captures.push({ file: shelfClosedFile, phase, surface: surface.label, fixture: fixtureFiles.find((file) => file.path === surface.path).source, viewport: shelfClosed.viewport, measuredPane: shelfClosed.pane, theme, optionalShelf: "Command reference closed through its actual toggle", layout: shelfClosed, violations: [], layoutViolations: [...shelfClosed.overlaps.map((overlap) => ({ kind: "overlap", ...overlap })), ...shelfClosed.outsideViewport.map((control) => ({ kind: "outside-viewport", ...control }))], presentation: "actual linked shipping styles; no candidate stylesheet" });
              await reference.click();
              await expect(page.locator(".tkr-program-reference")).toBeVisible();
            }
          }
        }
        if (surface.name === "game-settings" && desiredPaneWidth === null && (themeFilter === undefined || themeFilter === "dark")) {
          const titleInput = page.getByLabel("Game title", { exact: true });
          const originalTitle = await titleInput.inputValue();
          const originalBytes = await page.evaluate(async () => {
            const folder = Reflect.get(window, "__tkrDesignFolder");
            const file = await (await folder.getDirectoryHandle("Main")).getFileHandle("example.gam");
            return Array.from(new Uint8Array(await (await file.getFile()).arrayBuffer()));
          });
          const rootStyleBefore = await page.locator("html").evaluate((element) => ({
            value: element.style.getPropertyValue("font-size"),
            priority: element.style.getPropertyPriority("font-size"),
            computed: getComputedStyle(element).fontSize,
          }));
          let rootStyleAfter;
          let titleRect;
          let titleReachability;
          let titleReachable;
          let scaleLayout;
          let scaleMetrics;
          let scaleViolations;
          const scaleFile = `${title}-normal-root-text-200-long-title.png`;
          try {
            await page.emulateMedia({ colorScheme: "dark", forcedColors: "none" });
            await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
            await titleInput.fill("A deliberately long game title used to inspect wrapping and reachable controls");
            titleRect = await titleInput.evaluate((element) => {
              const rect = element.getBoundingClientRect();
              return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
            });
            scaleLayout = await layoutMetrics(page);
            titleReachability = await verifyVerticalReachability(titleInput);
            titleReachable = titleReachability.reachable;
            scaleMetrics = await renderedMetrics(page, page, true);
            if (scaleMetrics.controls.length === 0) throw new Error("No actual controls measured in the 200% root-text/long-title probe");
            scaleViolations = [
              ...scaleMetrics.controls.filter((control) => !control.disabled && ((control.textRequired && control.textRatio < 4.5) || (control.boundaryRequired && control.boundaryRatio < 3))),
              ...scaleMetrics.helperTexts.filter((helper) => !helper.disabled && helper.textRatio < 4.5).map((helper) => ({ kind: "helper-text-contrast", ...helper })),
            ];
            await page.screenshot({ path: join(output, scaleFile) });
            await delay(100);
            const currentBytes = await page.evaluate(async () => {
              const folder = Reflect.get(window, "__tkrDesignFolder");
              const file = await (await folder.getDirectoryHandle("Main")).getFileHandle("example.gam");
              return Array.from(new Uint8Array(await (await file.getFile()).arrayBuffer()));
            });
            if (JSON.stringify(currentBytes) !== JSON.stringify(originalBytes)) throw new Error("Root text/long-title presentation probe changed the authored game bytes");
          } finally {
            await titleInput.fill(originalTitle);
            await page.locator("html").evaluate((element, previous) => {
              if (previous.value === "") element.style.removeProperty("font-size");
              else element.style.setProperty("font-size", previous.value, previous.priority);
            }, rootStyleBefore);
            rootStyleAfter = await page.locator("html").evaluate((element) => ({
              value: element.style.getPropertyValue("font-size"),
              priority: element.style.getPropertyPriority("font-size"),
              computed: getComputedStyle(element).fontSize,
            }));
            if (await titleInput.inputValue() !== originalTitle) throw new Error("Root text/long-title probe did not restore the original staged value");
            if (rootStyleAfter.value !== rootStyleBefore.value || rootStyleAfter.priority !== rootStyleBefore.priority || rootStyleAfter.computed !== rootStyleBefore.computed) {
              throw new Error(`Root text probe did not restore the original font size (${rootStyleBefore.computed} to ${rootStyleAfter.computed})`);
            }
          }
          const scaleLayoutViolations = [...scaleLayout.overlaps.map((overlap) => ({ kind: "overlap", ...overlap })), ...scaleLayout.outsideViewport.map((control) => ({ kind: "outside-viewport", ...control })), ...(!titleReachable ? [{ kind: "title-not-reachable", rect: titleRect, scrollReachability: titleReachability }] : [])];
          captures.push({
            file: scaleFile, phase, surface: "game settings, actual title input with long staged value", fixture: fixtureFiles.find((file) => file.path === surface.path).source,
            viewport: scaleLayout.viewport, measuredPane: scaleLayout.pane, theme: "dark", scaling: "200% root text size; not browser zoom",
            stagedValueRestored: true, rootFontSizeBefore: rootStyleBefore.computed, rootFontSizeAfterRestoration: rootStyleAfter.computed, bytesBeforeAndAfterEqual: true,
            layout: { ...scaleLayout, titleInput: titleRect, titleReachability, titleReachable }, metrics: scaleMetrics, violations: scaleViolations,
            layoutViolations: scaleLayoutViolations,
            presentation: "actual shipping controls; DOM font-size environment probe; no candidate stylesheet",
          });
        }
      } else {
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
  }
  if (shipping) {
    await page.setViewportSize({ width: 1280, height: 900 });
    const programFolder = tree.getByRole("treeitem", { name: /^Prg, folder, (closed|open)$/ });
    if (await programFolder.getAttribute("aria-expanded") !== "true") {
      await programFolder.click();
      await files.getByRole("button", { name: "Open folder", exact: true }).click();
      await expect(programFolder).toHaveAttribute("aria-expanded", "true");
    }
    const longResourceRow = tree.getByRole("treeitem", { name: new RegExp(`^${longResourceName.replaceAll(".", "\\.")},`) });
    await longResourceRow.click();
    await files.getByRole("button", { name: "Open", exact: true }).click();
    const longResourceTab = page.getByRole("tab", { name: new RegExp(longResourceName.replaceAll(".", "\\.")) });
    await expect(longResourceTab).toHaveAttribute("aria-selected", "true");
    const focusStart = page.locator('.tkr-editor-pane:visible :is(input:not([type="hidden"]):not([type="color"]):not([type="checkbox"]), select, button):enabled:visible:not(.monaco-editor *)').first();
    if (await focusStart.count()) await focusStart.focus();
    else await page.getByRole("button", { name: "Application menu" }).focus();
    await page.keyboard.press("Tab");
    await page.waitForFunction(() => !document.getAnimations().some((animation) => animation.playState === "running" && animation.effect?.getTiming().iterations !== Infinity), undefined, { polling: 100, timeout: 2_000 });
    const longMetrics = await renderedMetrics(page, page, true);
    const longViolations = renderedViolations(longMetrics);
    const longLayout = await layoutMetrics(page);
    const longLayoutViolations = [
      ...longLayout.overlaps.map((overlap) => ({ kind: "overlap", ...overlap })),
      ...longLayout.outsideViewport.map((control) => ({ kind: "outside-viewport", ...control })),
    ];
    const identity = await page.evaluate(() => ({
      activeTab: document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim() ?? null,
      hostHeader: document.querySelector(".tkr-web-topbar")?.textContent?.trim() ?? null,
      hostStatus: document.querySelector(".tkr-web-status")?.textContent?.trim() ?? null,
    }));
    const identityScreenshot = "long-resource-identity-open-tab-header.png";
    await page.screenshot({ path: join(output, identityScreenshot) });
    await delay(100);
    captures.push({
      file: identityScreenshot, phase, surface: "long-named authored program resource opened from the real project tree", fixture: fixtureFiles.find((file) => file.path === longResourcePath).source,
      viewport: longLayout.viewport, measuredPane: longLayout.pane, theme: "dark", longResourcePath, openedThrough: "actual project-file Open button",
      activeTab: identity.activeTab, hostHeader: identity.hostHeader, hostStatus: identity.hostStatus, returnedToPriorDocument: "verified after capture: Prg/start.prg",
      layout: longLayout, metrics: longMetrics, violations: longViolations, layoutViolations: longLayoutViolations,
      presentation: "actual linked shipping styles; no candidate stylesheet",
    });
    const priorDocumentTab = page.getByRole("tab", { name: /start\.prg/ });
    await priorDocumentTab.click();
    await expect(priorDocumentTab).toHaveAttribute("aria-selected", "true");
  }
  if (shipping) {
    const opfsAfter = await page.evaluate(async (paths) => {
      const root = Reflect.get(window, "__tkrDesignFolder");
      const result = {};
      for (const path of paths) {
        let directory = root;
        const parts = path.split("/");
        for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
        const file = await directory.getFileHandle(parts.at(-1));
        result[path] = Array.from(new Uint8Array(await (await file.getFile()).arrayBuffer()));
      }
      return result;
    }, fixtureFiles.map((file) => file.path));
    for (const file of fixtureFiles) {
      if (sha256(Buffer.from(opfsBefore[file.path])) !== sha256(file.bytes) || sha256(Buffer.from(opfsAfter[file.path])) !== sha256(file.bytes)) {
        throw new Error(`Shipping presentation probe changed seeded OPFS bytes: ${file.path}`);
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
    story: shipping ? "11.23 / #2988" : "11.22 / #2987", ...(shipping ? { phase } : {}), capturedAt: new Date().toISOString(), revision, branch,
    host: { name: "Chromium", version: browser.version(), node: process.version, platform: process.platform, architecture: process.arch, url: `http://127.0.0.1:${port}/tools/browser/editor-web/index.html` },
    ...(shipping ? { linkedStylesheets: await page.evaluate(() => [...document.styleSheets].map((sheet) => sheet.href).filter((href) => href !== null)) } : {}),
    provenance: fixtureFiles.map(({ path, source, bytes }) => ({ path: source, projectPath: path, sha256: sha256(bytes), bytes: bytes.length })),
    captures, states, selection: { surface: surfaceFilter ?? "all", theme: themeFilter ?? "all", pane: paneFilter ?? "all", statesOnly },
    contrast: paletteReport,
    ...(shipping ? {
      result: captures.some((capture) => capture.violations?.length || capture.layoutViolations?.length) ? "fail" : "pass",
      ownership: "Actual linked shipping CSS, original browser theme and actual forced-colors media; no candidate stylesheet injected or enabled.",
      invariants: { allSeededOpfsFilesMatchFixtureBeforeAndAfter: true, unsavedStatusAbsentAfterCapture: true, authoredFixturesRechecked: true },
      actualControlStateCounts: {
        focusCaptures: captures.filter((capture) => capture.metrics?.focus !== null && capture.metrics?.focus !== undefined).length,
        selectedControls: captures.reduce((count, capture) => count + (capture.metrics?.controls.filter((control) => control.selected).length ?? 0), 0),
        disabledControls: captures.reduce((count, capture) => count + (capture.metrics?.controls.filter((control) => control.disabled).length ?? 0), 0),
        readOnlyControls: captures.reduce((count, capture) => count + (capture.metrics?.controls.filter((control) => control.readOnly).length ?? 0), 0),
      },
      stateProof: "Keyboard focus, selected/disabled/read-only controls are recorded when visible in the actual surface matrix. Run the existing states-only capture separately for native-I/O loading/save/read-only/validation outcomes; those outcomes are not fabricated or duplicated here.",
      limitations: ["Enemy authoring has no provider and is not represented by a fake control or capture.", "200% root text size is an explicit root-font-size probe, not browser zoom.", "Long-name layout uses the real game-title field and a shipping-only byte-identical long-path alias of the authored program fixture.", "This is the actual browser host, not an installed PWA or native VS Code host.", "Layout records include measured horizontal containment and vertical scroll reachability for selected topbar/program panels; they are not a full viewport-wide reachability audit."],
    } : {
      limitations: ["Enemy authoring has no provider and is not represented by a fake control or capture.", "Candidate CSS is isolated engineering evidence, not a shipped restyle or whole-view accessibility audit.", "Document-state snapshots are real native-IO scenarios in candidate dark; native VS Code mapping and host evidence are documented separately."],
    }),
  };
  const buildInputs = [
    "tools/browser/editor-web/dist/editor-web.js", "tools/browser/editor-web/dist/editor-web.css",
    "tools/browser/editor-web/dist/tileset-browser.css", "tools/browser/editor-web/dist/tileset-art.css", "tools/browser/editor-web/dist/program-view.css",
  ];
  const sourceHashesAfter = await Promise.all(sourceInputs.map(async (path) => ({ path, sha256: sha256(await readFile(join(root, path))) })));
  const changedSources = sourceHashesAfter.filter((input, index) => input.sha256 !== sourceInputHashes[index].sha256);
  if (changedSources.length) throw new Error(`Working source changed during capture: ${changedSources.map(({ path }) => path).join(", ")}`);
  const buildInputHashes = await Promise.all(buildInputs.map(async (path) => ({ path, sha256: sha256(await readFile(join(root, path))) })));
  manifest.workingInputs = [...sourceInputHashes, ...buildInputHashes];
  for (const file of fixtureFiles) {
    if (file.source.startsWith("docs/") && sha256(await readFile(join(root, file.source))) !== sha256(file.bytes)) throw new Error(`Authored source fixture changed: ${file.source}`);
  }
  await writeFile(join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  if (shipping && manifest.result !== "pass") process.exitCode = 1;
  console.log(`Editor design gallery: ${captures.length} surface captures and ${states.length} state captures in ${output}`);
} catch (error) {
  try {
    await mkdir(output, { recursive: true });
    if (page !== undefined) {
      await writeFile(join(output, "failure.txt"), `${String(error)}\n${await page.locator("body").ariaSnapshot().catch(String)}\n`);
      await page.screenshot({ path: join(output, "failure.png"), timeout: 2_000 });
    }
  } catch (captureError) {
    console.error("Failure evidence unavailable:", captureError);
  }
  console.error(`Gallery evidence: ${output}`);
  throw error;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await Promise.race([new Promise((resolveExit) => server.once("exit", resolveExit)), delay(3_000)]);
  if (server.exitCode === null) server.kill("SIGKILL");
}
async function layoutMetrics(page) {
  return page.evaluate(() => {
    const rect = (element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
    };
    const activeTab = document.querySelector('[role="tab"][aria-selected="true"]');
    const candidates = [...new Set([...document.querySelectorAll(".tkr-panel-toggles > *, .tkr-web-topbar .tkr-web-status, .tkr-web-topbar .tkr-web-brand, .tkr-program-body > *"), ...(activeTab === null ? [] : [activeTab])])];
    const visibleCandidates = candidates.filter((element) => getComputedStyle(element).display !== "none" && element.getBoundingClientRect().width > 0);
    const controls = visibleCandidates.map((element) => ({ element, selector: element.className || element.tagName.toLowerCase(), text: (element.getAttribute("aria-label") || element.textContent || "").trim().slice(0, 100), ...rect(element) }));
    const outsideViewport = controls.filter((item) => item.left < 0 || item.right > innerWidth).map(({ selector, left, right, top, bottom }) => ({ selector, left, right, top, bottom, axis: "horizontal" }));
    const verticalReachability = [];
    const scrollingElement = document.scrollingElement;
    for (const item of controls.filter((candidate) => candidate.top < -1 || candidate.bottom > innerHeight + 1)) {
      const ancestors = [];
      for (let node = item.element; node !== null; node = node.parentElement) ancestors.push(node);
      const scrollBefore = ancestors.map((node) => ({ node, top: node.scrollTop, left: node.scrollLeft }));
      const windowBefore = { x: scrollX, y: scrollY };
      const nearestScrollable = ancestors.find((node) => {
        const style = getComputedStyle(node);
        return node === scrollingElement
          ? node.scrollHeight > node.clientHeight + 1
          : /(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1;
      });
      item.element.scrollIntoView({ behavior: "instant", block: "nearest", inline: "nearest" });
      const after = rect(item.element);
      let visibleLeft = Math.max(0, after.left);
      let visibleTop = Math.max(0, after.top);
      let visibleRight = Math.min(innerWidth, after.right);
      let visibleBottom = Math.min(innerHeight, after.bottom);
      for (const node of ancestors) {
        const style = getComputedStyle(node);
        if (node === item.element || !/(hidden|clip|auto|scroll|overlay)/.test(`${style.overflowY} ${style.overflowX}`)) continue;
        const clip = node.getBoundingClientRect();
        if (/(hidden|clip|auto|scroll|overlay)/.test(style.overflowX)) {
          visibleLeft = Math.max(visibleLeft, clip.left);
          visibleRight = Math.min(visibleRight, clip.right);
        }
        if (/(hidden|clip|auto|scroll|overlay)/.test(style.overflowY)) {
          visibleTop = Math.max(visibleTop, clip.top);
          visibleBottom = Math.min(visibleBottom, clip.bottom);
        }
      }
      const moved = scrollBefore.some(({ node, top, left }) => Math.abs(node.scrollTop - top) > 1 || Math.abs(node.scrollLeft - left) > 1)
        || Math.abs(scrollY - windowBefore.y) > 1 || Math.abs(scrollX - windowBefore.x) > 1;
      const reached = nearestScrollable !== undefined && moved && visibleRight - visibleLeft > 1 && visibleBottom - visibleTop > 1;
      verticalReachability.push({
        selector: item.selector, reachable: reached, scrollRoute: nearestScrollable === undefined ? null : (nearestScrollable === scrollingElement ? "document" : nearestScrollable.className || nearestScrollable.tagName.toLowerCase()),
        moved, visibleRect: { left: visibleLeft, top: visibleTop, right: visibleRight, bottom: visibleBottom },
      });
      if (!reached) outsideViewport.push({ selector: item.selector, top: after.top, bottom: after.bottom, axis: "vertical", reachable: false });
      for (const saved of scrollBefore.reverse()) saved.node.scrollTo(saved.left, saved.top);
      window.scrollTo(windowBefore.x, windowBefore.y);
    }
    const controlRects = controls.map(({ element: _element, ...control }) => control);
    const overlaps = [];
    for (let i = 0; i < controlRects.length; i += 1) for (let j = i + 1; j < controlRects.length; j += 1) {
      const a = controlRects[i];
      const b = controlRects[j];
      const overlapWidth = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const overlapHeight = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (overlapWidth > 1 && overlapHeight > 1) overlaps.push({ first: a.selector, second: b.selector, overlapWidth, overlapHeight });
    }
    const pane = document.querySelector(".tkr-editor-pane:not([hidden])");
    const viewport = {
      width: innerWidth, height: innerHeight, rootFontSize: getComputedStyle(document.documentElement).fontSize,
      colorScheme: matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark",
      forcedColors: matchMedia("(forced-colors: active)").matches,
    };
    return { viewport, pane: pane === null ? null : rect(pane), controls: controlRects, overlaps, outsideViewport, verticalReachability };
  });
}
async function verifyVerticalReachability(locator) {
  return locator.evaluate((element) => {
    const rect = () => {
      const box = element.getBoundingClientRect();
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
    };
    const ancestors = [];
    for (let node = element; node !== null; node = node.parentElement) ancestors.push(node);
    const saved = ancestors.map((node) => ({ node, top: node.scrollTop, left: node.scrollLeft }));
    const windowBefore = { x: scrollX, y: scrollY };
    const scrollingElement = document.scrollingElement;
    const route = ancestors.find((node) => {
      const style = getComputedStyle(node);
      return node === scrollingElement
        ? node.scrollHeight > node.clientHeight + 1
        : /(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1;
    });
    const initial = rect();
    const initialVisible = initial.left >= 0 && initial.right <= innerWidth && initial.top >= 0 && initial.bottom <= innerHeight;
    try {
      element.scrollIntoView({ behavior: "instant", block: "nearest", inline: "nearest" });
      const after = rect();
      let visibleLeft = Math.max(0, after.left);
      let visibleTop = Math.max(0, after.top);
      let visibleRight = Math.min(innerWidth, after.right);
      let visibleBottom = Math.min(innerHeight, after.bottom);
      for (const node of ancestors) {
        const style = getComputedStyle(node);
        if (node === element || !/(hidden|clip|auto|scroll|overlay)/.test(`${style.overflowY} ${style.overflowX}`)) continue;
        const clip = node.getBoundingClientRect();
        if (/(hidden|clip|auto|scroll|overlay)/.test(style.overflowX)) {
          visibleLeft = Math.max(visibleLeft, clip.left);
          visibleRight = Math.min(visibleRight, clip.right);
        }
        if (/(hidden|clip|auto|scroll|overlay)/.test(style.overflowY)) {
          visibleTop = Math.max(visibleTop, clip.top);
          visibleBottom = Math.min(visibleBottom, clip.bottom);
        }
      }
      const moved = saved.some(({ node, top, left }) => Math.abs(node.scrollTop - top) > 1 || Math.abs(node.scrollLeft - left) > 1)
        || Math.abs(scrollY - windowBefore.y) > 1 || Math.abs(scrollX - windowBefore.x) > 1;
      const visible = visibleRight - visibleLeft > 1 && visibleBottom - visibleTop > 1;
      const reachable = visible && (initialVisible || (route !== undefined && moved));
      return {
        reachable, moved, scrollRoute: initialVisible && visible ? "already-visible" : route === undefined ? null : route === scrollingElement ? "document" : route.className || route.tagName.toLowerCase(),
        initialRect: initial, afterScrollRect: after, visibleRect: { left: visibleLeft, top: visibleTop, right: visibleRight, bottom: visibleBottom },
      };
    } finally {
      for (const position of saved.reverse()) position.node.scrollTo(position.left, position.top);
      window.scrollTo(windowBefore.x, windowBefore.y);
    }
  });
}
