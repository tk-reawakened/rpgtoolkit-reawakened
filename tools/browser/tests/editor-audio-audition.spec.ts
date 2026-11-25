import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { createEmptyMainFile, newProjectMainFile, writeMainFile } from "@tk-reawakened/core";
import { applyMainSettings, buildNewBoard } from "@tk-reawakened/editor-model";

const toneSeconds = 0.24;

function wav(): Uint8Array {
  const rate = 8_000;
  const samples = rate * toneSeconds;
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  for (const [offset, tag] of [[0, "RIFF"], [8, "WAVEfmt "], [36, "data"]] as const) {
    bytes.set(Buffer.from(tag, "ascii"), offset);
  }
  for (const [offset, value] of [[4, bytes.length - 8], [16, 16], [24, rate], [28, rate * 2], [40, samples * 2]]) {
    view.setUint32(offset!, value!, true);
  }
  for (const [offset, value] of [[20, 1], [22, 1], [32, 2], [34, 16]]) view.setUint16(offset!, value!, true);
  for (let i = 0; i < samples; i += 1) view.setInt16(44 + i * 2, Math.round(16_000 * Math.sin(2 * Math.PI * 440 * i / rate)), true);
  return bytes;
}

// Format 0, one middle C sounding for one beat.
const midi = new Uint8Array([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96, 77, 84, 114, 107, 0, 0, 0, 12, 0, 144, 60, 100, 96, 128, 60, 0, 0, 255, 47, 0]);
interface AudioProofWindow extends Window {
  auditionGraph?: { readonly context: BaseAudioContext; readonly analyser: AnalyserNode };
}

async function signal(page: Page): Promise<{ time: number; peak: number }> {
  return page.evaluate(() => {
    const graph = (window as AudioProofWindow).auditionGraph;
    if (graph === undefined) return { time: 0, peak: 0 };
    const samples = new Float32Array(graph.analyser.fftSize);
    graph.analyser.getFloatTimeDomainData(samples);
    let peak = 0;
    for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
    return { time: graph.context.currentTime, peak };
  });
}

test("editor auditions real WAV and configured-bank MIDI; loop outlives the WAV and Stop silences it", async ({ page }) => {
  const main = writeMainFile(applyMainSettings(newProjectMainFile(), { defaultSoundFont: "project.sf2" }));
  if (!main.ok) throw new Error("The proof main file must serialize");
  const board = buildNewBoard({ name: "audition", coordSystem: "2d", pixelCoordinates: false, width: 4, height: 3, layers: 1, backgroundImage: "", template: null });
  if (!board.ok) throw new Error(board.message);
  const bank = readFileSync(new URL("../../../media/soundfonts/TK-16.sf2", import.meta.url));
  const files = Object.fromEntries(Object.entries({
    "Main/demo.gam": main.value,
    "Boards/audition.brd": board.bytes,
    "Media/tone.wav": wav(),
    "Media/theme.mid": midi,
    "Media/project.sf2": bank,
    "Media/unsupported.ogg": Uint8Array.of(0),
  }).map(([path, bytes]) => [path, Buffer.from(bytes).toString("base64")]));
  const folder = `Audition-${randomUUID()}`;
  const bundledRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/dist/TK-16.sf2")) bundledRequests.push(request.url());
  });
  await page.addInitScript(({ files, folder }) => {
    // Use the native worklet and output graph. The analyser is only a second connection observing real PCM.
    const NativeWorklet = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends NativeWorklet {
      constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
        super(context, name, options);
        if (name !== "tkr-pcm-processor") return;
        const analyser = context.createAnalyser();
        this.connect(analyser);
        (window as AudioProofWindow).auditionGraph = { context, analyser };
      }
    };
    let project: Promise<FileSystemDirectoryHandle> | undefined;
    Object.defineProperty(window, "showDirectoryPicker", { value: () => project ??= (async () => {
      const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(folder, { create: true });
      for (const [path, bytes] of Object.entries(files)) {
        const [dir, file] = path.split("/");
        const parent = await root.getDirectoryHandle(dir!, { create: true });
        const stream = await (await parent.getFileHandle(file!, { create: true })).createWritable();
        await stream.write(Uint8Array.from(atob(bytes), (char) => char.charCodeAt(0)));
        await stream.close();
      }
      return root;
    })() });
  }, { files, folder });
  await page.goto("/tools/browser/editor-web/index.html");
  await page.getByRole("button", { name: "Open project folder", exact: true }).click();
  const boards = page.getByRole("treeitem", { name: /^Boards, folder/ });
  if (await boards.getAttribute("aria-expanded") !== "true") await boards.dblclick();
  await page.getByRole("treeitem", { name: /^audition\.brd,/ }).dblclick();
  const properties = page.locator(".tkr-board-properties");
  await properties.locator("summary").click();
  const field = properties.getByRole("textbox", { name: "Background music", exact: true });
  const group = properties.getByRole("group", { name: "Background music audition" });
  const play = group.getByRole("button", { name: "Play background music", exact: true });
  const stop = group.getByRole("button", { name: "Stop", exact: true });
  const loop = group.getByRole("checkbox", { name: "Loop playback" });
  const polling = { intervals: [25, 50, 75, 100], timeout: 7_000 };
  const audible = async (): Promise<void> => {
    await expect.poll(async () => (await signal(page)).peak, polling).toBeGreaterThan(0.002);
  };
  const silenceAfter = async (elapsed: number): Promise<void> => {
    const until = (await signal(page)).time + elapsed;
    await expect.poll(async () => {
      const sample = await signal(page);
      return sample.time >= until && sample.peak < 0.00001;
    }, polling).toBe(true);
  };

  await field.fill("tone.wav");
  await play.click();
  await audible();
  await silenceAfter(toneSeconds);

  await loop.check();
  await play.click();
  await audible();
  const afterThreePasses = (await signal(page)).time + toneSeconds * 3;
  await expect.poll(async () => {
    const sample = await signal(page);
    return sample.time >= afterThreePasses && sample.peak > 0.002;
  }, polling).toBe(true);
  await stop.click();
  await silenceAfter(toneSeconds);
  await loop.uncheck();

  await field.fill("theme.mid");
  await play.click();
  await audible();
  await stop.click();
  await silenceAfter(toneSeconds);
  expect(bundledRequests, "MIDI played using the project's own bank without fetching the fallback").toEqual([]);

  await field.fill("unsupported.ogg");
  await play.click();
  await expect(group.getByRole("alert")).toContainText("Audition plays .wav, .mid and .midi files");
  await expect(page.locator(".tkr-board-state")).toHaveText("All changes saved");
  const onDisk = await page.evaluate(async ({ folder, paths }) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(folder);
    const digests: string[] = [];
    for (const path of paths) {
      const [dir, file] = path.split("/");
      const entry = await (await root.getDirectoryHandle(dir!)).getFileHandle(file!);
      const digest = await crypto.subtle.digest("SHA-256", await (await entry.getFile()).arrayBuffer());
      digests.push(Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""));
    }
    return digests;
  }, { folder, paths: Object.keys(files) });
  expect(onDisk).toEqual(Object.values(files).map((bytes) => createHash("sha256").update(bytes, "base64").digest("hex")));
});
test("a loose board auditions its root Media folder while a nested game Main is active", async ({ page }) => {
  const main = writeMainFile({ ...createEmptyMainFile(), major: 2, minor: 9, projectPath: "A" });
  if (!main.ok) throw new Error("The proof main file must serialize");
  const board = buildNewBoard({ name: "loose-audition", coordSystem: "2d", pixelCoordinates: false, width: 4, height: 3, layers: 1, backgroundImage: "", template: null });
  if (!board.ok) throw new Error(board.message);
  const rootTone = wav();
  const gameTone = wav();
  gameTone.fill(0, 44);
  const files = Object.fromEntries(Object.entries({
    "Main/A.gam": main.value,
    "Boards/loose.brd": board.bytes,
    "Media/tone.wav": rootTone,
    "Game/A/Media/tone.wav": gameTone,
  }).map(([path, bytes]) => [path, Buffer.from(bytes).toString("base64")]));
  const folder = `Loose-Audition-${randomUUID()}`;
  await page.addInitScript(({ files, folder }) => {
    const NativeWorklet = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends NativeWorklet {
      constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
        super(context, name, options);
        if (name !== "tkr-pcm-processor") return;
        const analyser = context.createAnalyser();
        this.connect(analyser);
        (window as AudioProofWindow).auditionGraph = { context, analyser };
      }
    };
    let project: Promise<FileSystemDirectoryHandle> | undefined;
    Object.defineProperty(window, "showDirectoryPicker", { value: () => project ??= (async () => {
      const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(folder, { create: true });
      for (const [path, encoded] of Object.entries(files)) {
        const parts = path.split("/");
        const file = parts.pop()!;
        let parent = root;
        for (const part of parts) parent = await parent.getDirectoryHandle(part, { create: true });
        const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
        const stream = await (await parent.getFileHandle(file, { create: true })).createWritable();
        await stream.write(bytes);
        await stream.close();
      }
      return root;
    })() });
  }, { files, folder });
  await page.goto("/tools/browser/editor-web/index.html");
  await page.getByRole("button", { name: "Open project folder", exact: true }).click();
  const mainFolder = page.getByRole("treeitem", { name: /^Main, folder/ });
  if (await mainFolder.getAttribute("aria-expanded") !== "true") await mainFolder.dblclick();
  await page.getByRole("treeitem", { name: /^A\.gam,/ }).dblclick();
  await expect(page.getByRole("tab", { name: "Main/A.gam", exact: true })).toBeVisible();
  const boards = page.getByRole("treeitem", { name: /^Boards, folder/ });
  if (await boards.getAttribute("aria-expanded") !== "true") await boards.dblclick();
  await page.getByRole("treeitem", { name: /^loose\.brd,/ }).dblclick();
  const properties = page.locator(".tkr-board-properties");
  await properties.locator("summary").click();
  const field = properties.getByRole("textbox", { name: "Background music", exact: true });
  const play = properties.getByRole("group", { name: "Background music audition" }).getByRole("button", { name: "Play background music", exact: true });
  await field.fill("tone.wav");
  await play.click();
  await expect.poll(async () => (await signal(page)).peak, { intervals: [25, 50, 75, 100], timeout: 7_000 }).toBeGreaterThan(0.002);
});
