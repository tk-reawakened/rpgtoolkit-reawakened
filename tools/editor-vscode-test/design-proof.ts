import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { expect as playwrightExpect, Frame, Page } from "@playwright/test";
import { openNativeQuickOpenFile } from "./native-quick-open.ts";

type Expect = typeof playwrightExpect;
type DesignPhase = "before" | "after";
type DesignCase = { id: string; path: string; kind: "custom-webview" | "native-program"; description: string; rootSelector: string };
type DesignOptions = {
  root: string;
  extension: string;
  workspace: string;
  game: string;
  phase: DesignPhase;
  output: string;
  caseFilter?: string;
  themeFilter?: string;
  paneFilter?: string;
};

const longProgramPath = "Game/Example/Prg/this-is-a-deliberately-long-authored-program-resource-name-for-editor-workbench-tab-reachability-check.prg";

const cases: readonly DesignCase[] = [
  { id: "game", path: "Main/example.gam", kind: "custom-webview", description: "Authored game settings document", rootSelector: ".tkr-settings" },
  { id: "board", path: "Game/Example/Boards/village.brd", kind: "custom-webview", description: "Authored board document", rootSelector: ".tkr-board" },
  { id: "board-properties", path: "Game/Example/Boards/village.brd", kind: "custom-webview", description: "The real board-properties disclosure opened through its native summary control", rootSelector: ".tkr-board" },
  { id: "character", path: "Game/Example/Chrs/ada.tem", kind: "custom-webview", description: "Authored character document including its composed graphics and authoring views", rootSelector: '.tkr-editor-surface[data-tkr-editor="Character"]' },
  { id: "item", path: "Game/Example/Item/chest.itm", kind: "custom-webview", description: "Authored item document; does not imply expanded item authoring", rootSelector: ".tkr-sprite-graphics" },
  { id: "tileset-art", path: "Game/Example/Tiles/village.tst", kind: "custom-webview", description: "Authored tileset artwork document", rootSelector: ".tkr-tileset-art" },
  { id: "tile-bitmap", path: "Game/Example/Bitmap/house.tbm", kind: "custom-webview", description: "Authored tile bitmap document", rootSelector: ".tkr-bitmap" },
  { id: "animation", path: "Game/Example/Misc/chest/chest.anm", kind: "custom-webview", description: "Authored animation document", rootSelector: ".tkr-animation-editor" },
  { id: "program", path: "Game/Example/Prg/start.prg", kind: "native-program", description: "Authored RPGCode program in VS Code's native text editor; not shared Monaco", rootSelector: ".monaco-editor" },
  { id: "program-long-name", path: longProgramPath, kind: "native-program", description: "Byte-identical derived alias of the authored program, opened as a real native resource to stress document identity", rootSelector: ".monaco-editor" },
];

const themes = [
  { id: "light", pickerLabel: "Light Modern", settingName: "Light Modern", kind: "light" },
  { id: "dark", pickerLabel: "Dark Modern", settingName: "Dark Modern", kind: "dark" },
  { id: "high-contrast-dark", pickerLabel: "Dark High Contrast", settingName: "Default High Contrast", kind: "high-contrast-dark" },
  { id: "high-contrast-light", pickerLabel: "Light High Contrast", settingName: "Default High Contrast Light", kind: "high-contrast-light" },
] as const;

/** Capture the existing vscode-test-web workbench without injecting candidate or replacement CSS. */
export async function runVscodeDesignProof(page: Page, expect: Expect, options: DesignOptions): Promise<void> {
  if (!isAbsolute(options.output)) throw new Error("The native design evidence destination must be absolute");
  const selectedCases = selectFilter(options.caseFilter, cases.map((item) => item.id), "case");
  const selectedThemes = selectFilter(options.themeFilter, themes.map((theme) => theme.id), "theme");
  const selectedPanes = selectFilter(options.paneFilter, ["normal", "640px"] as const, "pane");
  const workspaceRoot = resolve(options.workspace);
  const output = resolve(options.output);
  if (output === workspaceRoot || output.startsWith(`${workspaceRoot}/`)) {
    throw new Error("The native design evidence destination must be outside the ephemeral proof workspace");
  }
  await mkdir(output, { recursive: true });

  const authoredRoot = resolve(options.root, "docs/spec/examples/game");
  const authoredPaths = [
    options.game,
    ...(await listFixtureFiles(resolve(authoredRoot, "Game/Example"))).map((path) => `Game/Example/${path}`),
  ];
  const authoredFiles = await Promise.all(authoredPaths.map(async (path) => {
    const sourcePath = resolve(authoredRoot, path);
    const bytes = new Uint8Array(await readFile(sourcePath));
    return { path, source: relative(options.root, sourcePath).replaceAll("\\", "/"), bytes, sha256: sha256(bytes) };
  }));
  const sourceProgram = authoredFiles.find((file) => file.path === "Game/Example/Prg/start.prg");
  if (sourceProgram === undefined) throw new Error("The authored native long-resource source program is missing");
  await writeFile(resolve(workspaceRoot, longProgramPath), sourceProgram.bytes);
  authoredFiles.push({ ...sourceProgram, path: longProgramPath });
  const workspaceFiles = await Promise.all(authoredFiles.map(async (file) => {
    const bytes = new Uint8Array(await readFile(resolve(workspaceRoot, file.path)));
    if (sha256(bytes) !== file.sha256) throw new Error(`The staged native design fixture differs from its authored source: ${file.path}`);
    return { path: file.path, bytes, sha256: sha256(bytes) };
  }));
  const sourceHashes = await hashFiles(options.root, [
    "tools/editor-vscode-test/run.mjs",
    "tools/editor-vscode-test/design-proof.ts",
    "tools/editor-vscode-test/probe-extension/extension.js",
    "tools/editor-vscode-test/native-quick-open.ts",
    "tools/editor-vscode-test/proof-directories.mjs",
    "tools/editor-vscode-test/lifecycle.ts",
    "tools/editor-vscode-test/web-proof.ts",
    "packages/editor-ui/src/program-view.css",
    "packages/editor-ui/src/tileset-art.css",
    "packages/editor-ui/src/tileset-browser.css",
    ...authoredFiles.map((file) => file.source),
  ]);
  const manifest = {
    schema: "tkr-vscode-editor-design-capture/v1",
    phase: options.phase,
    evidenceDirectory: output,
    host: { product: "VS Code for the Web via vscode-test-web", vscodeVersion: null, browserVersion: null, browserVersionSource: null, browserUserAgent: null, nodeVersion: process.version, platform: process.platform, architecture: process.arch },
    ownership: {
      programText: "native VS Code TextDocument in the workbench; not shared Monaco",
      programPreferences: "native VS Code workbench preferences remain host-owned",
      themeChange: "native Preferences: Color Theme command; startup setting restored after capture",
    },
    source: { revision: await readWorktreeRevision(options.root), workingSourceSha256: sourceHashes, unchanged: true },
    build: { sha256: await hashFiles(options.extension, ["package.json", "dist/extension.browser.js", "dist/webview.js", "dist/tileset-art.css", "dist/tileset-browser.css"]), unchanged: true },
    fixtures: authoredFiles.map(({ path, source, sha256 }) => ({ path, source, sha256 })),
    selection: {
      filters: { cases: options.caseFilter ?? null, themes: options.themeFilter ?? null, panes: options.paneFilter ?? null },
      caseIds: selectedCases,
      themeIds: selectedThemes,
      paneIds: selectedPanes,
      rootTextScaleIncluded: selectedCases.includes("game"),
      fullMatrix: selectedCases.length === cases.length && selectedThemes.length === themes.length && selectedPanes.length === 2,
    },
    themeCatalog: [...themes],
    initialTheme: { name: null, kind: "unknown", source: "actual VS Code extension API startup metadata" },
    observations: [],
    captures: [],
    captureFilesVerified: [],
    unchangedWorkspaceFiles: [],
    limitations: [
      "This is actual VS Code Web, not installed VS Code desktop.",
      "Program captures use the native VS Code text editor and TextDocument authority; shared Monaco is not presented as native.",
      "The long-resource case is a byte-identical temporary alias of the authored start.prg, opened through the actual native file command and preserved by the fixture-byte checks; it is not a newly authored game asset or a full shelf/panel stress certification.",
      "The 640 CSS-pixel editor pane and computed common-control/focus observations are measured; they are not browser zoom or simulated controls.",
      "Existing item coverage is the current authored SpriteView, not expanded item authoring; no enemy provider is implied.",
      "The root-text-scale screenshot uses a temporary 200% inline root font-size and restores its exact prior inline value/priority; it is not browser zoom.",
    ],
  } as {
    schema: string;
    phase: DesignPhase;
    evidenceDirectory: string;
    host: { product: string; vscodeVersion: string | null; browserVersion: string | null; browserVersionSource: string | null; browserUserAgent: string | null; nodeVersion: string; platform: string; architecture: string };
    ownership: { programText: string; programPreferences: string; themeChange: string };
    source: { revision: string; workingSourceSha256: Record<string, string>; finalWorkingSourceSha256?: Record<string, string>; unchanged: boolean };
    build: { sha256: Record<string, string>; finalSha256?: Record<string, string>; unchanged: boolean };
    fixtures: { path: string; source: string; sha256: string }[];
    selection: { filters: { cases: string | null; themes: string | null; panes: string | null }; caseIds: string[]; themeIds: string[]; paneIds: string[]; rootTextScaleIncluded: boolean; fullMatrix: boolean };
    themeCatalog: { id: string; pickerLabel: string; settingName: string; kind: string }[];
    initialTheme: { name: string | null; kind: string; source: string };
    observations: Record<string, unknown>[];
    captures: Record<string, unknown>[];
    unchangedWorkspaceFiles: Record<string, unknown>[];
    captureFilesVerified: { path: string; bytes: number; sha256: string }[];
    limitations: string[];
  };

  manifest.host.browserUserAgent = await page.evaluate(() => navigator.userAgent);
  const browserVersion = page.context().browser()?.version();
  manifest.host.browserVersion = browserVersion || (/Chrome\/([^ ]+)/.exec(manifest.host.browserUserAgent)?.[1] ?? null);
  manifest.host.browserVersionSource = browserVersion ? "Playwright Chromium Browser.version()" : "Chrome version token from navigator.userAgent";
  if (manifest.host.browserVersion === null) throw new Error("The actual Chromium browser version was not available to the design evidence capture");
  const measuredViolations: string[] = [];
  try {
    const lightSelection = await selectTheme(page, expect, themes[0]);
    if (!lightSelection.available) throw new Error(`The actual VS Code host does not expose the required native theme ${themes[0].pickerLabel}`);
    const darkSelection = await selectTheme(page, expect, themes[1]);
    if (!darkSelection.available) throw new Error(`The actual VS Code host does not expose the required native theme ${themes[1].pickerLabel}`);
    await waitForTheme(page, expect, themes[1].settingName, themes[1].kind);
    const nativeStartup = await readNativeThemeInfo(page, expect);
    manifest.initialTheme.name = nativeStartup.initialThemeName;
    manifest.initialTheme.kind = nativeStartup.initialThemeKind;
    manifest.initialTheme.source = "probe extension startup workbench.colorTheme and activeColorTheme";
    manifest.host.vscodeVersion = nativeStartup.vscodeVersion;
    for (const themeId of selectedThemes) {
      const theme = themes.find((candidate) => candidate.id === themeId)!;
      const selection = await selectTheme(page, expect, theme);
      if (!selection.available) {
        measuredViolations.push(`Theme unavailable in this actual host: ${theme.id} (${theme.pickerLabel})`);
        continue;
      }
      const actualTheme = await waitForTheme(page, expect, theme.settingName, theme.kind);
      await settleTheme(page);
      for (const pane of selectedPanes) {
        await sizeEditorPane(page, pane === "normal" ? null : 640);
        await settleTheme(page);
        for (const caseId of selectedCases) {
          const item = cases.find((candidate) => candidate.id === caseId)!;
          await openNativeQuickOpenFile(page, expect, item.path);
          const frame = await waitForDocument(page, expect, item);
          if (frame !== null && (item.id === "board" || item.id === "board-properties")) {
            const summary = frame.locator("summary").filter({ hasText: /^Board properties$/ });
            await expect.poll(() => summary.count(), { timeout: 2_000, intervals: [50, 100, 200] }).toBe(1);
            const expanded = await summary.evaluate((element) => {
              if (!(element.parentElement instanceof HTMLDetailsElement)) throw new Error("Board properties is not a native details disclosure");
              return element.parentElement.open;
            });
            if (expanded !== (item.id === "board-properties")) await summary.click();
          }
          const measurement = await measureDocument(page, expect, item, frame);
          const captureName = `${item.id}-${pane}-${theme.id}.png`;
          const captureBytes = await page.screenshot({ path: resolve(output, captureName), fullPage: false });
          const captureHash = sha256(new Uint8Array(captureBytes));
          manifest.observations.push({
            activeTab: measurement.activeTab,
            selectedResource: { requestedPath: item.path, activeTabLabel: measurement.activeTab.label, rootSelector: item.rootSelector },
            description: item.description,
            path: item.path,
            editorKind: item.kind,
            theme: actualTheme,
            paneRequest: pane,
            pane: measurement.pane,
            browserViewport: measurement.viewport,
            focus: measurement.focus,
            controls: measurement.controls,
            layout: measurement.layout,
            screenshot: captureName,
            screenshotSha256: captureHash,
          });
          manifest.captures.push({ case: item.id, pane, theme: theme.id, screenshot: captureName, sha256: captureHash, bytes: captureBytes.length });
          for (const issue of measurement.violations) measuredViolations.push(`${item.id}/${pane}/${theme.id}: ${issue}`);
          const changed = await compareWorkspaceBytes(workspaceRoot, workspaceFiles);
          if (changed.length !== 0) measuredViolations.push(`Workspace fixture bytes changed during theme/layout capture: ${changed.join(", ")}`);
        }
      }
    }
  } finally {
    if (manifest.initialTheme.name !== null) {
      await selectThemeBySetting(page, expect, manifest.initialTheme.name);
      await waitForTheme(page, expect, manifest.initialTheme.name, manifest.initialTheme.kind);
    }
    const changed = await compareWorkspaceBytes(workspaceRoot, workspaceFiles);
    manifest.unchangedWorkspaceFiles = workspaceFiles.map((file) => ({ path: file.path, sha256: file.sha256, unchanged: !changed.includes(file.path) }));
    if (changed.length !== 0) measuredViolations.push(`Workspace fixture byte changes remain after capture: ${changed.join(", ")}`);
  }

  if (selectedCases.includes("game")) {
    const rootTextScale = await captureRootTextScale(page, expect, output, workspaceRoot, workspaceFiles);
    manifest.observations.push({ ...rootTextScale.observation, theme: { name: manifest.initialTheme.name, kind: manifest.initialTheme.kind } });
    for (const issue of rootTextScale.violations) measuredViolations.push(`root-text-scale-200: ${issue}`);
    manifest.captures.push({ case: "game", pane: "normal", theme: manifest.initialTheme.name, variant: "root-text-scale-200", screenshot: rootTextScale.screenshot, sha256: rootTextScale.screenshotSha256, bytes: rootTextScale.screenshotBytes });
  }
  const expectedCaptureCount = selectedCases.length * selectedThemes.length * selectedPanes.length + (selectedCases.includes("game") ? 1 : 0);
  const captureMatrixComplete = manifest.captures.length === expectedCaptureCount;
  if (!captureMatrixComplete) measuredViolations.push(`Capture matrix incomplete: expected ${expectedCaptureCount} retained screenshots, observed ${manifest.captures.length}`);
  manifest.captureFilesVerified = await validateCaptureFiles(output, manifest.captures);
  const finalSourceHashes = await hashFiles(options.root, Object.keys(sourceHashes));
  const finalBuildHashes = await hashFiles(options.extension, Object.keys(manifest.build.sha256));
  manifest.source.finalWorkingSourceSha256 = finalSourceHashes;
  manifest.source.unchanged = sameHashes(sourceHashes, finalSourceHashes);
  manifest.build.finalSha256 = finalBuildHashes;
  manifest.build.unchanged = sameHashes(manifest.build.sha256, finalBuildHashes);
  if (!manifest.source.unchanged) measuredViolations.push("Tracked working source bytes changed during design capture");
  if (!manifest.build.unchanged) measuredViolations.push("Built extension/webview bytes changed during design capture");
  const report = {
    ...manifest,
    outcome: measuredViolations.length === 0 ? "green" : "measured-violations",
    measuredViolations,
    expectedCaptureCount,
    captureCount: manifest.captures.length,
    captureMatrixComplete,
    openedCases: [...new Set(manifest.captures.map((capture) => String(capture.case)))],
  };
  await writeFile(resolve(output, "manifest.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (measuredViolations.length !== 0) {
    throw new Error(`VS Code editor design ${options.phase} capture recorded ${measuredViolations.length} measured violation(s); see ${resolve(output, "manifest.json")}`);
  }
}

async function nativeThemeMetadata(page: Page): Promise<string | null> {
  const status = page.locator(".statusbar-item").filter({ hasText: /^TKR design ·/ }).first();
  const label = await status.getAttribute("aria-label", { timeout: 1_000 }).catch(() => null);
  if (label === null) return null;
  const start = label.indexOf('{"vscodeVersion":');
  return start < 0 ? null : label.slice(start);
}

async function readNativeThemeInfo(page: Page, expect: Expect) {
  await expect.poll(() => nativeThemeMetadata(page), { timeout: 20_000, intervals: [100, 250, 500, 1_000] }).not.toBeNull();
  const metadata = await nativeThemeMetadata(page);
  if (metadata === null) throw new Error("The native VS Code design status item has no accessible theme metadata");
  const info = JSON.parse(metadata) as { vscodeVersion: string; themeName: string; themeKind: string; initialThemeName: string; initialThemeKind: string };
  if (typeof info.vscodeVersion !== "string" || typeof info.themeName !== "string" || typeof info.themeKind !== "string" || typeof info.initialThemeName !== "string" || typeof info.initialThemeKind !== "string") {
    throw new Error("The native VS Code theme probe did not report its startup theme, active theme, kind, and version");
  }
  return info;
}

async function openThemePicker(page: Page, expect: Expect) {
  await page.keyboard.press("ControlOrMeta+Shift+P");
  const widget = page.locator(".quick-input-widget");
  const commandInput = widget.locator("input:visible");
  await expect(commandInput).toHaveCount(1);
  await commandInput.fill(">Preferences: Color Theme");
  const command = page.getByRole("option", { name: /^Preferences: Color Theme(?:,|$)/ });
  await expect(command).toHaveCount(1);
  await command.click();
  const picker = widget.locator("input:visible");
  await expect(picker).toHaveCount(1);
  await expect.poll(async () => await page.getByRole("option").count(), { timeout: 10_000, intervals: [100, 250, 500, 1_000] }).toBeGreaterThan(0);
  return { widget, picker };
}


async function selectTheme(page: Page, expect: Expect, theme: typeof themes[number]): Promise<{ available: boolean }> {
  const { widget, picker } = await openThemePicker(page, expect);
  const option = page.getByRole("option", { name: new RegExp(`^${escapeRegExp(theme.pickerLabel)}(?:,|$)`) });
  await picker.fill(theme.pickerLabel);
  let count = 0;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    count = await option.count();
    if (count > 0) break;
    await page.waitForTimeout(100);
  }
  if (count > 1) throw new Error(`Native theme picker returned an ambiguous entry for ${theme.pickerLabel}`);
  if (count === 0) {
    await page.keyboard.press("Escape");
    await expect(widget).toBeHidden();
    return { available: false };
  }
  await option.click();
  await expect(widget).toBeHidden();
  return { available: true };
}

async function selectThemeBySetting(page: Page, expect: Expect, settingName: string) {
  const { widget, picker } = await openThemePicker(page, expect);
  const pickerLabel = themes.find((theme) => theme.settingName === settingName)?.pickerLabel ?? settingName;
  await picker.fill(pickerLabel);
  const option = page.getByRole("option", { name: new RegExp(`^${escapeRegExp(pickerLabel)}(?:,|$)`) });
  await expect(option).toHaveCount(1);
  await option.click();
  await expect(widget).toBeHidden();
}

async function waitForTheme(page: Page, expect: Expect, themeName: string, themeKind: string) {
  await expect.poll(async () => {
    const metadata = await nativeThemeMetadata(page);
    if (metadata === null) return null;
    try {
      const info = JSON.parse(metadata) as { themeName?: string; themeKind?: string };
      return info.themeName === themeName && info.themeKind === themeKind ? `${info.themeName}|${info.themeKind}` : null;
    } catch {
      return null;
    }
  }, { timeout: 20_000, intervals: [100, 250, 500, 1_000] }).toBe(`${themeName}|${themeKind}`);
  const metadata = await nativeThemeMetadata(page);
  if (metadata === null) throw new Error("The native VS Code design status item has no accessible theme metadata");
  return JSON.parse(metadata) as { vscodeVersion: string; themeName: string; themeKind: string; initialThemeName?: string; initialThemeKind?: string };
}



async function settleTheme(page: Page) {
  let previous = "";
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const current = await page.evaluate(() => {
      const workbench = document.querySelector(".monaco-workbench") ?? document.body;
      return `${getComputedStyle(workbench).backgroundColor}|${getComputedStyle(workbench).color}|${workbench.getBoundingClientRect().width}`;
    });
    if (current === previous) return;
    previous = current;
    await page.waitForTimeout(120 * (attempt + 1));
  }
  throw new Error("VS Code theme/layout did not settle within the bounded wait");
}

async function sizeEditorPane(page: Page, targetWidth: number | null) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  if (targetWidth === null) return;
  let viewportWidth = 1440;
  let measurement = 0;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    measurement = await page.evaluate(() => {
      const editor = document.querySelector(".monaco-workbench .part.editor");
      return editor?.getBoundingClientRect().width ?? 0;
    });
    if (measurement <= 0) throw new Error("Could not measure the actual VS Code editor pane");
    const difference = targetWidth - measurement;
    if (Math.abs(difference) <= 2) break;
    viewportWidth = Math.max(720, Math.min(2_400, viewportWidth + difference));
    await page.setViewportSize({ width: Math.round(viewportWidth), height: 1000 });
    await page.waitForTimeout(100 * (attempt + 1));
  }
  measurement = await page.evaluate(() => document.querySelector(".monaco-workbench .part.editor")?.getBoundingClientRect().width ?? 0);
  if (Math.abs(measurement - targetWidth) > 4) throw new Error(`Could not establish a measured 640px VS Code editor pane (actual ${measurement.toFixed(1)}px)`);
}

async function waitForDocument(page: Page, expect: Expect, item: DesignCase): Promise<Frame | null> {
  const expectedName = item.path.split("/").at(-1)!;
  const selectedTab = page.locator('.monaco-workbench .part.editor .tab[role="tab"][aria-selected="true"]:visible');
  await expect.poll(async () => {
    if (await selectedTab.count() !== 1) return false;
    const label = await selectedTab.getAttribute("aria-label") ?? await selectedTab.innerText().catch(() => "");
    return label.includes(expectedName);
  }, { timeout: 30_000, intervals: [100, 250, 500, 1_000] }).toBe(true);
  const tabLabel = await selectedTab.getAttribute("aria-label") ?? await selectedTab.innerText();
  if (!tabLabel.includes(expectedName)) throw new Error(`Selected VS Code resource does not match ${item.path}: ${tabLabel}`);
  if (item.kind === "native-program") {
    await expect(page.locator(`.monaco-workbench .part.editor ${item.rootSelector}:visible`).first()).toBeVisible({ timeout: 30_000 });
    return null;
  }
  return await waitForCustomEditorFrame(page, item);
}

async function waitForCustomEditorFrame(page: Page, item: DesignCase): Promise<Frame> {
  const deadline = Date.now() + 30_000;
  let pause = 100;
  while (Date.now() < deadline) {
    const visibleWebviews = await page.locator("iframe.webview:visible").elementHandles();
    for (const webview of visibleWebviews) {
      const outerFrame = await webview.contentFrame().catch(() => null);
      if (outerFrame === null) continue;
      for (const contentElement of await outerFrame.locator("iframe:visible").elementHandles()) {
        const content = await contentElement.contentFrame().catch(() => null);
        if (content === null) continue;
        const root = content.locator(item.rootSelector);
        if (await root.count().catch(() => 0) === 1 && await root.isVisible().catch(() => false)) return content;
      }
    }
    await page.waitForTimeout(pause);
    pause = Math.min(pause * 2, 1_000);
  }
  throw new Error(`Timed out waiting for a visible webview and visible content iframe containing ${item.rootSelector} for ${item.path}`);
}

type HostPaintLayer = { background: [number, number, number, number]; opacity: number; element: string };

async function outsideFramePaintLayers(frame: Frame): Promise<HostPaintLayer[]> {
  const layers: HostPaintLayer[] = [];
  for (let current = frame; current.parentFrame() !== null; current = current.parentFrame()!) {
    const element = await current.frameElement();
    try {
      layers.push(...await element.evaluate((iframe) => {
        const result: HostPaintLayer[] = [];
        for (let node: Element | null = iframe; node !== null;) {
          const style = getComputedStyle(node);
          const srgb = /^color\(srgb\s+(.+)\)$/.exec(style.backgroundColor);
          let channels: number[];
          if (srgb !== null) {
            const [color, alpha = "1"] = srgb[1].split("/");
            const normalized = (token: string) => token.trim().endsWith("%") ? Number.parseFloat(token) / 100 : Number(token);
            channels = [...color.trim().split(/\s+/).map((token) => Math.max(0, Math.min(1, normalized(token))) * 255), Math.max(0, Math.min(1, normalized(alpha)))];
          } else {
            if (!/^rgba?\(/.test(style.backgroundColor)) throw new Error(`Unmeasurable actual host backdrop: ${style.backgroundColor}`);
            channels = style.backgroundColor.match(/[\d.]+/g)!.map(Number);
          }
          if ((channels.length !== 3 && channels.length !== 4) || !channels.every(Number.isFinite)) throw new Error(`Unmeasurable actual host backdrop: ${style.backgroundColor}`);
          result.push({
            background: [channels[0], channels[1], channels[2], channels[3] ?? 1],
            opacity: Number(style.opacity),
            element: node.tagName.toLowerCase(),
          });
          const root = node.getRootNode();
          node = node.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
        }
        return result;
      }));
    } finally {
      await element.dispose();
    }
  }
  return layers;
}

async function measureDocument(page: Page, expect: Expect, item: DesignCase, frame: Frame | null) {
  const { pane, activeTab } = await page.evaluate(() => {
    const editor = document.querySelector(".monaco-workbench .part.editor");
    const rect = editor?.getBoundingClientRect();
    const tab = document.querySelector('.monaco-workbench .part.editor .tab.active[role="tab"]') ?? document.querySelector('.monaco-workbench .part.editor .tab[role="tab"][aria-selected="true"]');
    const tabLabel = tab?.getAttribute("aria-label") ?? tab?.textContent?.trim() ?? null;
    const tabState = tab?.getAttribute("aria-label") ?? "";
    return {
      pane: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      activeTab: { label: tabLabel, modified: /unsaved|modified|dirty/i.test(tabState) || Boolean(tab?.querySelector(".codicon-modified,.tab-dirty")) },
    };
  });
  if (pane === null) throw new Error(`Actual editor pane geometry unavailable for ${item.path}`);
  if (activeTab.label === null || !activeTab.label.includes(item.path.split("/").at(-1)!)) {
    throw new Error(`Selected VS Code resource changed before measurement: ${item.path} (active tab: ${activeTab.label ?? "none"})`);
  }
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, devicePixelRatio }));
  const violations: string[] = [];
  if (activeTab.modified) violations.push(`active document tab is marked modified: ${activeTab.label ?? item.path}`);
  let focus: Record<string, unknown>;
  let controls: Record<string, unknown>[];
  let layout: Record<string, unknown>;
  if (frame !== null) {
    const firstControl = frame.locator(`${item.rootSelector} :is(button,input:not([type="hidden"]),select,textarea):enabled:visible`).first();
    await firstControl.focus();
    await firstControl.press("Tab");
    await expect.poll(() => frame.evaluate(() => document.getAnimations().filter((animation) =>
      animation.playState === "running" && Number.isFinite(animation.effect?.getComputedTiming().endTime ?? Infinity)
    ).length), { timeout: 2_000, intervals: [50, 100, 200] }).toBe(0);
    const hostPaintLayers = await outsideFramePaintLayers(frame);
    const inside = await frame.evaluate(({ rootSelector, hostPaintLayers }) => {
      const root = document.querySelector(rootSelector);
      if (root === null || document.querySelectorAll(rootSelector).length !== 1) throw new Error(`Selected native webview document root is missing or ambiguous: ${rootSelector}`);
      const visible = (element: Element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
          && element.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true });
      };
      const parentElement = (element: Element): Element | null => {
        if (element.parentElement !== null) return element.parentElement;
        const tree = element.getRootNode();
        return tree instanceof ShadowRoot ? tree.host : null;
      };
      type RGBA = [number, number, number, number];
      const parseColor = (value: string): RGBA => {
        const srgb = /^color\(srgb\s+(.+)\)$/.exec(value);
        if (srgb !== null) {
          const [color, alpha = "1"] = srgb[1].split("/");
          const normalized = (token: string) => token.trim().endsWith("%") ? Number.parseFloat(token) / 100 : Number(token);
          const channels = color.trim().split(/\s+/).map((token) => Math.max(0, Math.min(1, normalized(token))) * 255);
          const opacity = Math.max(0, Math.min(1, normalized(alpha)));
          if (channels.length !== 3 || !channels.every(Number.isFinite) || !Number.isFinite(opacity)) throw new Error(`Cannot measure computed CSS color: ${value}`);
          return [channels[0], channels[1], channels[2], opacity];
        }
        if (!/^rgba?\(/.test(value)) throw new Error(`Cannot measure computed CSS color: ${value}`);
        const parts = value.match(/[\d.]+%?/g);
        if (parts === null || parts.length < 3) throw new Error(`Cannot measure computed CSS color: ${value}`);
        const channel = (part: string) => {
          const numeric = Number.parseFloat(part);
          return part.endsWith("%") ? numeric * 2.55 : numeric;
        };
        const alpha = parts.length > 3 ? (parts[3].endsWith("%") ? Number.parseFloat(parts[3]) / 100 : Number.parseFloat(parts[3])) : 1;
        return [channel(parts[0]), channel(parts[1]), channel(parts[2]), alpha];
      };
      const composite = (foreground: RGBA, background: RGBA): RGBA => {
        const alpha = foreground[3] + background[3] * (1 - foreground[3]);
        if (alpha === 0) return [0, 0, 0, 0];
        return [
          (foreground[0] * foreground[3] + background[0] * background[3] * (1 - foreground[3])) / alpha,
          (foreground[1] * foreground[3] + background[1] * background[3] * (1 - foreground[3])) / alpha,
          (foreground[2] * foreground[3] + background[2] * background[3] * (1 - foreground[3])) / alpha,
          alpha,
        ];
      };
      const colorAt = (element: Element, ink: RGBA = [0, 0, 0, 0], omitOwnBackground = false): RGBA => {
        let foreground = [...ink] as RGBA;
        for (let node: Element | null = element; node !== null; node = parentElement(node)) {
          const style = getComputedStyle(node);
          const background = parseColor(style.backgroundColor);
          if (!(omitOwnBackground && node === element)) foreground = composite(foreground, background);
          foreground[3] *= Number.parseFloat(style.opacity || "1");
        }
        for (const layer of hostPaintLayers) {
          foreground = composite(foreground, layer.background);
          foreground[3] *= layer.opacity;
        }
        if (foreground[3] < 0.999) throw new Error(`Computed color has no opaque backing surface at ${element.tagName.toLowerCase()}`);
        return foreground;
      };
      const luminance = (rgba: RGBA) => rgba.slice(0, 3).reduce((sum, channel, index) => {
        const normalized = channel / 255;
        const linear = normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        return sum + linear * [0.2126, 0.7152, 0.0722][index];
      }, 0);
      const contrast = (first: RGBA, second: RGBA) => {
        const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
        return (values[0] + 0.05) / (values[1] + 0.05);
      };
      const active = document.activeElement as HTMLElement | null;
      const activeStyle = active === null ? null : getComputedStyle(active);
      const activeRect = active?.getBoundingClientRect();
      const controls = [...root.querySelectorAll("button,input,select,textarea,[role=button],[role=tab]")]
        .filter(visible)
        .filter((element) => !(element instanceof HTMLInputElement && element.type === "hidden"))
        .map((element) => {
          const html = element as HTMLElement;
          const style = getComputedStyle(html);
          const rect = html.getBoundingClientRect();
          const background = colorAt(html);
          const foreground = colorAt(html, parseColor(style.color));
          const adjacent = colorAt(parentElement(html) ?? html);
          const borderEdges = ["top", "right", "bottom", "left"].map((side) => {
            const width = Number.parseFloat(style.getPropertyValue(`border-${side}-width`));
            const borderStyle = style.getPropertyValue(`border-${side}-style`);
            const ink = parseColor(style.getPropertyValue(`border-${side}-color`));
            const drawn = width > 0 && borderStyle !== "none" && borderStyle !== "hidden" && ink[3] > 0;
            const effective = drawn ? colorAt(html, ink) : null;
            return { side, width, style: borderStyle, drawn, effectiveColor: effective?.slice(0, 3) ?? null, contrast: effective === null ? null : contrast(effective, adjacent) };
          });
          const drawnEdges = borderEdges.filter((edge) => edge.drawn);
          const fillContrast = contrast(background, adjacent);
          const boundaryContrast = Math.max(fillContrast, ...drawnEdges.map((edge) => edge.contrast!));
          const boundaryVisible = drawnEdges.length > 0 || fillContrast >= 3;
          const nativeType = html instanceof HTMLInputElement && ["color", "checkbox", "radio", "range"].includes(html.type);
          const nativeUaUnmeasured = nativeType && style.appearance !== "none";
          const textOnlyButton = html.tagName === "BUTTON" && drawnEdges.length === 0 && parseColor(style.backgroundColor)[3] === 0 && !html.matches('[aria-selected="true"],.selected');
          const textRequired = !nativeType;
          return {
            tag: html.tagName.toLowerCase(),
            role: html.getAttribute("role"),
            name: html.getAttribute("aria-label") || Array.from((html as HTMLInputElement).labels ?? []).map((label) => label.textContent?.trim() ?? "").join(" ") || html.getAttribute("title") || html.textContent?.trim() || "",
            disabled: html.matches(":disabled,[aria-disabled=true]"),
            readOnly: html instanceof HTMLInputElement || html instanceof HTMLTextAreaElement ? html.readOnly : false,
            selected: html.matches('[aria-selected="true"],[aria-pressed="true"],.selected'),
            foreground: style.color,
            effectiveForeground: foreground.slice(0, 3),
            background: style.backgroundColor,
            effectiveBackground: background.slice(0, 3),
            adjacentBackground: adjacent.slice(0, 3),
            textContrast: contrast(foreground, background),
            borderEdges,
            boundaryVisible,
            boundaryRequired: !textOnlyButton && !nativeUaUnmeasured,
            boundaryContrast: nativeUaUnmeasured ? null : boundaryContrast,
            boundaryAssessment: nativeUaUnmeasured ? "native-UA-appearance-not-measurable-from-CSS" : "CSS-rendered-edges-or-fill",
            appearance: nativeType ? style.appearance : null,
            accentColor: nativeType ? style.accentColor : null,
            checked: html instanceof HTMLInputElement && ["checkbox", "radio"].includes(html.type) ? html.checked : null,
            textRequired,
            outlineColor: style.outlineColor,
            outlineWidth: style.outlineWidth,
            fontSize: style.fontSize,
            lineHeight: style.lineHeight,
            padding: style.padding,
            radius: style.borderRadius,
            opacity: style.opacity,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          };
        });
      const focusBackground = active === null ? null : colorAt(parentElement(active) ?? active);
      const focus = active === null ? { found: false } : {
        found: active !== document.body && active !== document.documentElement,
        withinSelectedRoot: root.contains(active),
        tag: active.tagName.toLowerCase(),
        role: active.getAttribute("role"),
        name: active.getAttribute("aria-label") ?? active.getAttribute("title") ?? active.textContent?.trim() ?? "",
        outlineColor: activeStyle?.outlineColor,
        outlineWidth: activeStyle?.outlineWidth,
        outlineStyle: activeStyle?.outlineStyle,
        focusVisible: active.matches(":focus-visible"),
        focusContrast: activeStyle === null || focusBackground === null ? null : contrast(colorAt(active, parseColor(activeStyle.outlineColor), true), focusBackground),
        rect: activeRect ? { x: activeRect.x, y: activeRect.y, width: activeRect.width, height: activeRect.height } : null,
      };
      const scrollContainers = [...document.querySelectorAll("body,body *")].filter((element) => {
        const html = element as HTMLElement;
        return visible(element) && (html.scrollHeight > html.clientHeight + 1 || html.scrollWidth > html.clientWidth + 1);
      }).map((element) => {
        const html = element as HTMLElement;
        const style = getComputedStyle(html);
        const startTop = html.scrollTop;
        const startLeft = html.scrollLeft;
        const maxTop = Math.max(0, html.scrollHeight - html.clientHeight);
        const maxLeft = Math.max(0, html.scrollWidth - html.clientWidth);
        html.scrollTop = maxTop;
        html.scrollLeft = maxLeft;
        const verticalReachable = maxTop === 0 || html.scrollTop >= maxTop - 1;
        const horizontalReachable = maxLeft === 0 || html.scrollLeft >= maxLeft - 1;
        html.scrollTop = startTop;
        html.scrollLeft = startLeft;
        return {
          element: `${html.tagName.toLowerCase()}${html.id ? `#${html.id}` : ""}${typeof html.className === "string" && html.className.trim() ? `.${html.className.trim().split(/\s+/).join(".")}` : ""}`,
          overflowY: style.overflowY,
          overflowX: style.overflowX,
          scrollHeight: html.scrollHeight,
          clientHeight: html.clientHeight,
          scrollWidth: html.scrollWidth,
          clientWidth: html.clientWidth,
          verticalReachable: /^(auto|scroll)$/.test(style.overflowY) && verticalReachable,
          horizontalReachable: /^(auto|scroll)$/.test(style.overflowX) && horizontalReachable,
        };
      });
      const documentRoot = document.documentElement;
      return {
        focus,
        controls,
        layout: {
          viewport: { width: innerWidth, height: innerHeight },
          document: { width: documentRoot.scrollWidth, height: documentRoot.scrollHeight },
          horizontalOverflow: documentRoot.scrollWidth > innerWidth + 1,
          verticalOverflow: documentRoot.scrollHeight > innerHeight + 1,
          verticalOverflowTreatment: "ordinary vertical scroll is not a violation; scroll containers report overflow mode and reachability",
          scrollContainers,
          bodyBackground: getComputedStyle(document.body).backgroundColor,
          hostPaintLayers,
        },
      };
    }, { rootSelector: item.rootSelector, hostPaintLayers });
    focus = inside.focus;
    controls = inside.controls;
    layout = inside.layout;
  } else {
    focus = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      const style = active === null ? null : getComputedStyle(active);
      return { found: active !== null && active !== document.body, tag: active?.tagName.toLowerCase(), role: active?.getAttribute("role"), outlineColor: style?.outlineColor, outlineWidth: style?.outlineWidth, outlineStyle: style?.outlineStyle };
    });
    controls = [];
    layout = await page.evaluate(() => ({
      viewport: { width: innerWidth, height: innerHeight },
      document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      verticalOverflow: document.documentElement.scrollHeight > innerHeight + 1,
      verticalOverflowTreatment: "native program text editing; no custom control contrast or layout assertions",
      note: "Native program editor geometry; editor controls and preferences are host-owned",
    }));
  }
  if (item.kind === "custom-webview" && focus.found !== true) violations.push("Tab did not produce a measurable keyboard-focused webview control");
  if (item.kind === "custom-webview" && focus.found === true && focus.withinSelectedRoot !== true) violations.push("keyboard focus moved outside the selected webview document root");
  if (layout.horizontalOverflow === true) violations.push("document content has horizontal overflow in the actual webview viewport");
  if (item.kind === "custom-webview" && controls.length === 0) violations.push("no visible common controls were sampled");
  for (const control of controls) {
    if (control.disabled === true) continue;
    if (control.textRequired === true && typeof control.textContrast === "number" && control.textContrast < 4.5) {
      violations.push(`sampled control text contrast below 4.5:1 (${control.name || control.tag}, ${control.textContrast.toFixed(2)}:1)`);
    }
    if (control.boundaryRequired === true && control.boundaryVisible !== true) {
      violations.push(`sampled control boundary is not visually distinguishable (${control.name || control.tag})`);
    }
    if (control.boundaryRequired === true && typeof control.boundaryContrast === "number" && control.boundaryContrast < 3) {
      violations.push(`sampled control boundary contrast below 3:1 (${control.name || control.tag}, ${control.boundaryContrast.toFixed(2)}:1)`);
    }
  }
  if (item.kind === "custom-webview" && focus.found === true) {
    if (focus.focusVisible !== true) violations.push("keyboard focus is not reported by :focus-visible");
    if (parseFloat(String(focus.outlineWidth)) < 2) violations.push("keyboard focus outline is thinner than 2 CSS pixels");
    if (typeof focus.focusContrast === "number" && focus.focusContrast < 3) violations.push(`keyboard focus contrast below 3:1 (${focus.focusContrast.toFixed(2)}:1)`);
  }
  return { pane, activeTab, viewport, focus, controls, layout, violations };
}

async function captureRootTextScale(page: Page, expect: Expect, output: string, workspaceRoot: string, workspaceFiles: readonly { path: string; bytes: Uint8Array; sha256: string }[]) {
  await sizeEditorPane(page, null);
  const gameCase = cases.find((item) => item.id === "game")!;
  await openNativeQuickOpenFile(page, expect, gameCase.path);
  const frame = await waitForDocument(page, expect, gameCase);
  if (frame === null) throw new Error("Actual game settings webview frame missing for root text scaling");
  const activeTab = page.locator('.monaco-workbench .part.editor .tab[role="tab"][aria-selected="true"]:visible');
  const activeTabLabel = await activeTab.getAttribute("aria-label") ?? await activeTab.innerText();
  const readScale = () => frame.evaluate(() => {
    const root = document.documentElement;
    const rect = root.getBoundingClientRect();
    const verticalOverflow = root.scrollHeight > innerHeight + 1;
    const startScrollY = window.scrollY;
    window.scrollTo(0, Math.max(0, root.scrollHeight - innerHeight));
    const verticalScrollReachable = !verticalOverflow || window.scrollY >= root.scrollHeight - innerHeight - 1;
    window.scrollTo(0, startScrollY);
    return {
      computedFontSize: getComputedStyle(root).fontSize,
      viewport: { width: innerWidth, height: innerHeight },
      document: { width: root.scrollWidth, height: root.scrollHeight },
      horizontalOverflow: root.scrollWidth > innerWidth + 1,
      verticalOverflow,
      verticalScrollReachable,
      verticalOverflowTreatment: "ordinary vertical overflow is only treated as clipping if the actual document cannot scroll to its content",
      root: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  });
  const hostPane = await page.evaluate(() => {
    const rect = document.querySelector(".monaco-workbench .part.editor")?.getBoundingClientRect();
    return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
  });
  if (hostPane === null) throw new Error("Actual VS Code editor pane geometry unavailable for root text scaling");
  const before = await readScale();
  const originalStyle = await frame.evaluate(() => ({
    value: document.documentElement.style.getPropertyValue("font-size"),
    priority: document.documentElement.style.getPropertyPriority("font-size"),
  }));
  const screenshot = "game-root-text-scale-200.png";
  let after: typeof before;
  let screenshotBytes: Buffer;
  try {
    await frame.evaluate(() => document.documentElement.style.setProperty("font-size", "200%"));
    let previous = "";
    after = await readScale();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const state = JSON.stringify(after);
      if (state === previous) break;
      previous = state;
      await page.waitForTimeout(100 * (attempt + 1));
      after = await readScale();
    }
    screenshotBytes = await page.screenshot({ path: resolve(output, screenshot), fullPage: false });
  } finally {
    await frame.evaluate((original) => {
      const style = document.documentElement.style;
      if (original.value === "") style.removeProperty("font-size");
      else style.setProperty("font-size", original.value, original.priority);
    }, originalStyle);
  }
  const restoredStyle = await frame.evaluate(() => ({
    value: document.documentElement.style.getPropertyValue("font-size"),
    priority: document.documentElement.style.getPropertyPriority("font-size"),
  }));
  const unchanged = await compareWorkspaceBytes(workspaceRoot, workspaceFiles);
  const violations: string[] = [];
  if (after.horizontalOverflow) violations.push("the game settings view has horizontal overflow at 200% root text scale");
  if (after.verticalOverflow && !after.verticalScrollReachable) violations.push("vertical content is clipped because the actual document cannot scroll to its bottom at 200% root text scale");
  if (restoredStyle.value !== originalStyle.value || restoredStyle.priority !== originalStyle.priority) {
    violations.push("webview root font-size inline value or priority was not restored exactly");
  }
  if (unchanged.length !== 0) violations.push(`workspace fixture bytes changed during root text scaling: ${unchanged.join(", ")}`);
  const screenshotSha256 = sha256(new Uint8Array(screenshotBytes));
  return {
    observation: {
      case: "game",
      paneRequest: "normal",
      selectedResource: { requestedPath: gameCase.path, activeTabLabel, rootSelector: gameCase.rootSelector },
      textScale: "200% via temporary webview documentElement inline font-size; not browser zoom or candidate stylesheet",
      hostPane,
      before,
      after,
      originalStyle,
      restoredStyle,
      screenshot,
      screenshotSha256,
      workspaceBytesChecked: "all authored capture fixture files",
    },
    screenshot,
    screenshotSha256,
    screenshotBytes: screenshotBytes.length,
    violations,
  };
}


async function listFixtureFiles(directory: string, parent = ""): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  const files: string[] = [];
  for (const entry of entries) {
    const path = parent === "" ? entry.name : `${parent}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await listFixtureFiles(resolve(directory, entry.name), path));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Unsupported authored fixture entry: ${resolve(directory, entry.name)}`);
  }
  return files;
}

function selectFilter(input: string | undefined, allowed: readonly string[], label: string): string[] {
  if (input === undefined) return [...allowed];
  const selected = input.split(",").map((value) => value.trim());
  if (selected.some((value) => value === "") || new Set(selected).size !== selected.length) {
    throw new Error(`TKR_EDITOR_DESIGN_${label.toUpperCase()}S must be a comma-separated list of unique ${label} ids`);
  }
  const unknown = selected.filter((value) => !allowed.includes(value));
  if (unknown.length !== 0) throw new Error(`Unknown editor design ${label} id(s): ${unknown.join(", ")}; allowed: ${allowed.join(", ")}`);
  return selected;
}

async function validateCaptureFiles(output: string, captures: readonly Record<string, unknown>[]) {
  const verified = [];
  for (const capture of captures) {
    const name = capture.screenshot;
    const expectedHash = capture.sha256;
    const expectedBytes = capture.bytes;
    if (typeof name !== "string" || name.includes("/") || name.includes("\\") || typeof expectedHash !== "string" || typeof expectedBytes !== "number") {
      throw new Error("The design evidence manifest contains an invalid screenshot reference");
    }
    const bytes = await readFile(resolve(output, name));
    if (bytes.length !== expectedBytes || sha256(bytes) !== expectedHash) {
      throw new Error(`Retained screenshot does not match its evidence manifest: ${name}`);
    }
    if (bytes.length < 8 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new Error(`Retained screenshot is not a PNG image: ${name}`);
    }
    verified.push({ path: resolve(output, name), bytes: bytes.length, sha256: expectedHash });
  }
  return verified;
}

async function compareWorkspaceBytes(workspace: string, expected: readonly { path: string; bytes: Uint8Array; sha256: string }[]) {
  const paths = expected.length === 0 ? [] : expected.map((file) => file.path);
  const changed: string[] = [];
  for (const path of paths) {
    const current = new Uint8Array(await readFile(resolve(workspace, path)));
    const original = expected.find((file) => file.path === path)!;
    if (sha256(current) !== original.sha256 || current.length !== original.bytes.length) changed.push(path);
  }
  return changed;
}

async function hashFiles(root: string, paths: readonly string[]) {
  const result: Record<string, string> = {};
  for (const path of paths) result[path] = sha256(new Uint8Array(await readFile(resolve(root, path))));
  return result;
}
function sameHashes(before: Record<string, string>, after: Record<string, string>) {
  const beforePaths = Object.keys(before).sort();
  const afterPaths = Object.keys(after).sort();
  return beforePaths.length === afterPaths.length && beforePaths.every((path, index) => path === afterPaths[index] && before[path] === after[path]);
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readWorktreeRevision(root: string) {
  try {
    const gitPath = resolve(root, ".git");
    const gitPointer = await readFile(gitPath, "utf8").catch(() => "");
    const gitDirectory = gitPointer.startsWith("gitdir: ") ? resolve(root, gitPointer.trim().slice("gitdir: ".length)) : gitPath;
    const commonPointer = await readFile(resolve(gitDirectory, "commondir"), "utf8").catch(() => "");
    const commonDirectory = commonPointer.trim() === "" ? gitDirectory : resolve(gitDirectory, commonPointer.trim());
    const head = (await readFile(resolve(gitDirectory, "HEAD"), "utf8")).trim();
    if (/^[a-f0-9]{40}$/i.test(head)) return head;
    if (!head.startsWith("ref: ")) return "unavailable";
    const reference = head.slice(5);
    try { return (await readFile(resolve(commonDirectory, reference), "utf8")).trim(); } catch {
      const packed = await readFile(resolve(commonDirectory, "packed-refs"), "utf8");
      return packed.split(/\r?\n/).find((line) => line.endsWith(` ${reference}`))?.split(" ")[0] ?? "unavailable";
    }
  } catch {
    return "unavailable";
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
