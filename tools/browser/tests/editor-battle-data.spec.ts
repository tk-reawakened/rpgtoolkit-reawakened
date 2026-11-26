import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { newProjectMainFile, writeMainFile } from "@tk-reawakened/core";
import { expect, test, type Page } from "@playwright/test";

// Story 13.10 and 13.11 in the real browser host: battle-data forms edit and save through the shipped workbench.

const bytes = (path: string): number[] => Array.from(readFileSync(new URL(`../../../docs/spec/examples/${path}`, import.meta.url)));
const FIREBALL = bytes("game/Game/Example/SpcMove/fireball.spc");
const BURN = bytes("game/Game/Example/StatusE/burn.ste");
const BKG = bytes("game/Game/Example/Bkrounds/forest.bkg");
const BKG_VALUES = {
  image: "Nature/forest.tbm", music: "battle-tone.wav", selectSound: "cursor.wav", chooseSound: "choose.wav", readySound: "ready.mid", cantDoSound: "nope.wav",
} as const;
const BKG_FIELDS = [
  ["Background picture", "image"],
  ["Battle music", "music"],
  ["Menu cursor sound", "selectSound"],
  ["Menu choice sound", "chooseSound"],
  ["Fighter ready sound", "readySound"],
  ["Action unavailable sound", "cantDoSound"],
] as const;
const battleTone = (): number[] => {
  const rate = 8_000;
  const samples = Math.floor(rate / 3);
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  for (const [offset, tag] of [[0, "RIFF"], [8, "WAVEfmt "], [36, "data"]] as const) bytes.set(Buffer.from(tag, "ascii"), offset);
  for (const [offset, value] of [[4, bytes.length - 8], [16, 16], [24, rate], [28, rate * 2], [40, samples * 2]]) view.setUint32(offset!, value!, true);
  for (const [offset, value] of [[20, 1], [22, 1], [32, 2], [34, 16]]) view.setUint16(offset!, value!, true);
  for (let sample = 0; sample < samples; sample += 1) view.setInt16(44 + sample * 2, Math.round(16_000 * Math.sin(2 * Math.PI * 440 * sample / rate)), true);
  return Array.from(bytes);
};
interface AudioProofWindow extends Window {
  auditionGraph?: { readonly context: BaseAudioContext; readonly analyser: AnalyserNode };
}
async function observeAudio(page: Page): Promise<{ time: number; peak: number }> {
  return page.evaluate(() => {
    const graph = (window as AudioProofWindow).auditionGraph;
    if (graph === undefined) return { time: 0, peak: 0 };
    const samples = new Float32Array(graph.analyser.fftSize);
    graph.analyser.getFloatTimeDomainData(samples);
    return { time: graph.context.currentTime, peak: Math.max(...samples.map(Math.abs)) };
  });
}
async function installAudioAnalyser(page: Page): Promise<void> {
  await page.addInitScript(() => {
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
  });
}
const BKG_EDITED = (() => {
  const fields = [new TextEncoder().encode("RPGTLKIT BKG\x00"), Uint8Array.of(2, 0, 3, 0)];
  for (const [, key] of BKG_FIELDS) fields.push(new TextEncoder().encode(`${BKG_VALUES[key]}\x00`));
  return Array.from(fields.reduce((all, part) => [...all, ...part], [] as number[]));
})();
const moveBytesWithDescription = (text: string): number[] => [...FIREBALL.slice(0, 0x43), ...Buffer.from(text, "latin1"), 0];
// fireball.spc: fp 0x1e (i32), battle 0x37, menu 0x38. burn.ste: hpAmount 0x24 (i16).
const MOVE_EDITED = (() => {
  const bytes = [...FIREBALL];
  bytes.splice(0x1e, 4, 0xe2, 0xff, 0xff, 0xff);
  bytes[0x37] = 0;
  return bytes;
})();
const STATUS_EDITED = (() => {
  const bytes = [...BURN];
  bytes.splice(0x24, 2, 0xfb, 0xff);
  return bytes;
})();

interface ProofWindow extends Window { __tkrTestFolder?: FileSystemDirectoryHandle }

/** The shipped editor page over a seeded origin-private project folder, opened the way a person does it. */
async function openWorkbench(page: Page, extra: readonly { readonly path: string; readonly bytes: number[] }[] = [], mainBytes: number[] = bytes("game/Main/example.gam")): Promise<void> {
  const files = [
    { path: "Main/example.gam", bytes: mainBytes },
    { path: "SpcMove/fireball.spc", bytes: FIREBALL },
    { path: "StatusE/burn.ste", bytes: BURN },
    ...extra,
  ];
  const folderName = `TkrBattleData-${randomUUID()}`;
  await page.addInitScript(async ({ inputs, name }) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
    for (const input of inputs) {
      let parent = root;
      const parts = input.path.split("/");
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
  await page.goto("/tools/browser/editor-web/index.html");
  await page.waitForFunction(() => (window as ProofWindow).__tkrTestFolder !== undefined);
  await page.getByRole("button", { name: "Open project folder" }).click();
  await expect(page.getByLabel("Game title")).toBeVisible();
}

async function openFile(page: Page, folderName: string, fileName: string): Promise<void> {
  const folder = page.getByRole("treeitem", { name: new RegExp(`^${folderName}, folder`) });
  await expect(folder).toBeVisible();
  if ((await folder.getAttribute("aria-expanded")) !== "true") await folder.dblclick();
  await page.getByRole("treeitem", { name: new RegExp(`^${fileName.replace(".", "\\.")},`) }).dblclick();
}
async function openProjectFile(page: Page, path: string): Promise<void> {
  const parts = path.split("/");
  const folders = parts.slice(0, -1);
  for (const name of folders) {
    const item = page.getByRole("treeitem", { name: new RegExp(`^${name.replace(".", "\\.")}, folder`) });
    await expect(item).toBeVisible();
    if (await item.getAttribute("aria-expanded") !== "true") await item.dblclick();
  }
  const fileName = parts.at(-1)!;
  await page.getByRole("treeitem", { name: new RegExp(`^${fileName.replace(".", "\\.")},`) }).dblclick();
}

async function readProjectFile(page: Page, path: string): Promise<number[]> {
  return await page.evaluate(async (file) => {
    let handle = (window as ProofWindow).__tkrTestFolder!;
    const parts = file.split("/");
    for (const part of parts.slice(0, -1)) handle = await handle.getDirectoryHandle(part);
    return Array.from(new Uint8Array(await (await (await handle.getFileHandle(parts.at(-1)!)).getFile()).arrayBuffer()));
  }, path);
}

async function toggleSecondView(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Application menu" }).click();
  await page.getByRole("menuitem", { name: "View", exact: true }).click();
  await page.getByRole("menuitem", { name: "Toggle Split Second View", exact: true }).click();
}

/** Type into a field and leave it: the form submits when the field is left. */
async function retype(page: Page, label: string, value: string): Promise<void> {
  const field = page.getByLabel(label, { exact: true });
  await field.fill(value);
  await field.blur();
}

test("a special move opens, edits its signed damage and inverted usable flag, and Save writes exactly those bytes", async ({ page }) => {
  await openWorkbench(page);
  await openFile(page, "SpcMove", "fireball.spc");
  const editor = page.locator('[data-tkr-editor="Special move"]');
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Fireball");
  await expect(editor.getByLabel("Damage (FP)", { exact: true })).toHaveValue("12");
  // The committed move stores battle = 1 (not usable) and menu = 0 (usable).
  await expect(editor.getByLabel("Usable in battle", { exact: true })).not.toBeChecked();
  await expect(editor.getByLabel("Usable from the menu", { exact: true })).toBeChecked();
  await expect(editor.getByText("Stored value 1: 0 means usable")).toBeVisible();

  await retype(page, "Damage (FP)", "-30");
  await expect(editor.getByText("Heals the target by 30")).toBeVisible();
  await editor.getByLabel("Usable in battle", { exact: true }).check();
  expect(await readProjectFile(page, "SpcMove/fireball.spc")).toEqual(FIREBALL);
  await page.getByRole("button", { name: "Save active editor", exact: true }).click();
  await expect.poll(() => readProjectFile(page, "SpcMove/fireball.spc")).toEqual(MOVE_EDITED);
  await expect(editor.getByLabel("Usable in battle", { exact: true })).toBeChecked();
});
test("a fight background resolves assets, auditions real media, routes palette actions to a focused split, and saves six references", async ({ page }) => {
  await installAudioAnalyser(page);
  const main = writeMainFile({ ...newProjectMainFile(), projectPath: "" });
  if (!main.ok) throw new Error("The proof Main file must serialize");
  const bkgPath = "Game/Bkrounds/forest.bkg";
  const imagePath = "Game/Bitmap/Nature/forest.tbm";
  await openWorkbench(page, [
    { path: bkgPath, bytes: BKG },
    { path: "Game/Bitmap/forest.tbm", bytes: bytes("game/Game/Example/Bitmap/forest.tbm") },
    { path: imagePath, bytes: bytes("game/Game/Example/Bitmap/forest.tbm") },
    { path: "Game/Media/battle-tone.wav", bytes: battleTone() },
  ], [...main.value]);
  await openProjectFile(page, bkgPath);
  const editor = page.locator('[data-tkr-editor="Fight background"]').first();
  await expect(editor).toBeVisible();
  await page.getByRole("button", { name: "Application menu" }).click();
  await page.getByRole("menuitem", { name: "Run", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Play background music", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Application menu" }).click();
  await retype(page, "Background picture file", "Nature/forest.tbm");
  const openImage = editor.getByRole("button", { name: "Open background picture", exact: true });
  await expect(openImage).toBeEnabled();
  await openImage.click();
  await expect(page.locator('[data-tkr-editor="Tile bitmap"]')).toBeVisible();
  await expect(page.getByRole("tab", { name: /forest\.tbm/ }).first()).toBeVisible();
  await page.getByRole("tab", { name: /forest\.bkg/ }).first().click();
  for (const [label, key] of BKG_FIELDS) await retype(page, `${label} file`, BKG_VALUES[key]);
  await expect(editor.getByRole("button", { name: "Play battle music" })).toBeVisible();
  await toggleSecondView(page);
  const mirror = page.locator("#mirror");
  const mirrorLoop = mirror.getByRole("group", { name: "Battle music audition" }).getByRole("checkbox", { name: "Loop playback" });
  const primaryLoop = editor.getByRole("group", { name: "Battle music audition" }).getByRole("checkbox", { name: "Loop playback" });
  await mirrorLoop.check();
  await page.getByRole("button", { name: "Application menu" }).click();
  await page.getByRole("menuitem", { name: "Run", exact: true }).click();
  await page.getByRole("menuitem", { name: "Toggle fight-background audition loop", exact: true }).click();
  await expect(mirrorLoop).not.toBeChecked();
  await expect(primaryLoop).not.toBeChecked();

  const group = editor.getByRole("group", { name: "Battle music audition" });
  await primaryLoop.check();
  await group.getByRole("button", { name: "Play battle music", exact: true }).click();
  await expect.poll(async () => (await observeAudio(page)).peak, { intervals: [25, 50, 75, 100], timeout: 7_000 }).toBeGreaterThan(0.002);
  const activeAudioStart = (await observeAudio(page)).time;
  await expect.poll(async () => {
    const sample = await observeAudio(page);
    return sample.time >= activeAudioStart + 0.45 && sample.peak > 0.002;
  }, { intervals: [25, 50, 75, 100], timeout: 7_000 }).toBe(true);
  await group.getByRole("button", { name: "Stop", exact: true }).click();
  const silenceTime = (await observeAudio(page)).time + 0.4;
  await expect.poll(async () => {
    const sample = await observeAudio(page);
    return sample.time >= silenceTime && sample.peak < 0.00001;
  }, { intervals: [25, 50, 75, 100], timeout: 7_000 }).toBe(true);

  await page.getByRole("button", { name: "Application menu" }).click();
  await page.getByRole("menuitem", { name: "Run", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Play battle music", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Stop fight-background audition", exact: true })).toBeVisible();
  await expect(editor.getByRole("button", { name: "Play menu cursor sound" })).toBeVisible();
  await page.getByRole("button", { name: "Application menu" }).click();
  await page.getByRole("button", { name: "Save active editor", exact: true }).click();
  await expect.poll(() => readProjectFile(page, bkgPath)).toEqual(BKG_EDITED);
  await page.getByRole("button", { name: `Close ${bkgPath}` }).click();
  await openProjectFile(page, bkgPath);
  const reopened = page.locator('[data-tkr-editor="Fight background"]').first();
  for (const [label, key] of BKG_FIELDS) await expect(reopened.getByLabel(`${label} file`, { exact: true })).toHaveValue(BKG_VALUES[key]);
});

test("saving a linked status effect refreshes both move views without dropping the second view's refused text", async ({ page }) => {
  await openWorkbench(page);
  await openFile(page, "SpcMove", "fireball.spc");
  const move = page.locator('[data-tkr-editor="Special move"]').first();
  await expect(move.getByText("Burn: 3 rounds; removes 2 HP each round.")).toBeVisible();
  await toggleSecondView(page);
  const mirror = page.locator("#mirror");
  await expect(mirror.getByText("Burn: 3 rounds; removes 2 HP each round.")).toBeVisible();
  const draft = mirror.getByLabel("Damage (FP)", { exact: true });
  await draft.fill("9999999999");
  await draft.blur();
  await expect(mirror.getByRole("alert")).toContainText("whole number");
  await move.getByRole("button", { name: "Open status effect" }).click();
  const status = page.locator('[data-tkr-editor="Status effect"]').first();
  await expect(status).toBeVisible();
  await expect(status.getByLabel("Name", { exact: true })).toHaveValue("Burn");
  await expect(status.getByLabel("HP per round", { exact: true })).toHaveValue("2");

  const hp = status.getByLabel("HP per round", { exact: true });
  await hp.fill("-5");
  await hp.blur();
  await expect(status.getByText("Heals 5 HP each round")).toBeVisible();
  expect(await readProjectFile(page, "StatusE/burn.ste")).toEqual(BURN);
  await page.getByRole("button", { name: "Save active editor", exact: true }).click();
  await expect.poll(() => readProjectFile(page, "StatusE/burn.ste")).toEqual(STATUS_EDITED);
  expect(await readProjectFile(page, "SpcMove/fireball.spc"), "editing the link never touched the move's own file").toEqual(FIREBALL);

  await page.getByRole("button", { name: "Return to board" }).click();
  await expect(move).toBeVisible();
  await expect(move.getByText("Burn: 3 rounds; restores 5 HP each round.")).toBeVisible();
  await expect(mirror.getByText("Burn: 3 rounds; restores 5 HP each round.")).toBeVisible();
  await expect(draft).toHaveValue("9999999999");
  await expect(mirror.getByRole("alert")).toContainText("whole number");
});

test("native description Undo after blur and save restores the original binary line separators", async ({ page }) => {
  const path = "SpcMove/mixed.spc";
  const original = moveBytesWithDescription("A\r\nB\nC");
  await openWorkbench(page, [{ path, bytes: original }]);
  await openFile(page, "SpcMove", "mixed.spc");
  const field = page.getByLabel("Description", { exact: true });
  await expect(field).toHaveValue("A\nB\nC");
  await field.focus();
  await field.evaluate((textarea: HTMLTextAreaElement) => textarea.setSelectionRange(2, 2));
  await field.press("Backspace");
  await expect(field).toHaveValue("AB\nC");
  await field.blur();
  const save = page.getByRole("button", { name: "Save active editor", exact: true });
  await save.click();
  await expect.poll(() => readProjectFile(page, path)).toEqual(moveBytesWithDescription("AB\nC"));

  await field.press("ControlOrMeta+z");
  await expect(field).toHaveValue("A\nB\nC");
  await field.blur();
  await save.click();
  await expect.poll(() => readProjectFile(page, path)).toEqual(original);
});

test("a second description edit uses the separators the previous save actually wrote", async ({ page }) => {
  const path = "SpcMove/empty-line.spc";
  await openWorkbench(page, [{ path, bytes: moveBytesWithDescription("A\rB\nC") }]);
  await openFile(page, "SpcMove", "empty-line.spc");
  const field = page.getByLabel("Description", { exact: true });
  const save = page.getByRole("button", { name: "Save active editor", exact: true });
  await expect(field).toHaveValue("A\nB\nC");
  await field.focus();
  await field.evaluate((textarea: HTMLTextAreaElement) => textarea.setSelectionRange(2, 3));
  await field.press("Backspace");
  await expect(field).toHaveValue("A\n\nC");
  await field.blur();
  await save.click();
  await expect.poll(() => readProjectFile(page, path)).toEqual(moveBytesWithDescription("A\r\rC"));

  await field.focus();
  await field.evaluate((textarea: HTMLTextAreaElement) => textarea.setSelectionRange(2, 2));
  await field.press("x");
  await expect(field).toHaveValue("A\nx\nC");
  await field.blur();
  await save.click();
  await expect.poll(() => readProjectFile(page, path)).toEqual(moveBytesWithDescription("A\rx\rC"));
});

test("two files that differ only in case are reported as a collision in a real case-sensitive project folder", async ({ page }) => {
  // OPFS is case-sensitive, so both spellings live side by side and the reference names neither.
  await openWorkbench(page, [{ path: "StatusE/Burn.STE", bytes: BURN }]);
  await openFile(page, "SpcMove", "fireball.spc");
  const editor = page.locator('[data-tkr-editor="Special move"]');
  await expect(editor.getByText("differ only in case")).toBeVisible();
  await expect(editor.getByRole("button", { name: "Open status effect" })).toBeDisabled();
  await expect(editor.getByText("Burn: 3 rounds")).toHaveCount(0);
  // The reference is untouched: the file still holds burn.ste and the form still holds it.
  expect(await readProjectFile(page, "SpcMove/fireball.spc")).toEqual(FIREBALL);
});

test("a value the field cannot hold is refused with its reason, is never saved, and is discarded on request", async ({ page }) => {
  await openWorkbench(page);
  await openFile(page, "SpcMove", "fireball.spc");
  const editor = page.locator('[data-tkr-editor="Special move"]');
  await retype(page, "Damage (FP)", "9999999999");
  await expect(editor.getByRole("alert")).toContainText("whole number from -2147483648 to 2147483647");
  // The refused text keeps its place and its reason; nothing is written behind the author's back.
  await page.getByRole("button", { name: "Save active editor", exact: true }).click();
  await expect(editor.getByRole("alert").filter({ hasText: "Nothing was saved" })).toBeVisible();
  expect(await readProjectFile(page, "SpcMove/fireball.spc")).toEqual(FIREBALL);
  // Discarding it returns the field to the file's value and the file saves normally.
  await editor.getByRole("button", { name: "Discard the unapplied text" }).click();
  await expect(editor.getByLabel("Damage (FP)", { exact: true })).toHaveValue("12");
  await page.getByRole("button", { name: "Save active editor", exact: true }).click();
  await expect.poll(() => readProjectFile(page, "SpcMove/fireball.spc")).toEqual(FIREBALL);
});

test("text a field refused is unsaved work: leaving the page asks until it is discarded and saved (#3385)", async ({ page }) => {
  await openWorkbench(page);
  await openFile(page, "SpcMove", "fireball.spc");
  const editor = page.locator('[data-tkr-editor="Special move"]');
  const asks = (): Promise<boolean> => page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(await asks(), "an untouched document lets the page go").toBe(false);
  await retype(page, "Damage (FP)", "9999999999");
  await expect(editor.getByRole("alert")).toContainText("whole number from -2147483648 to 2147483647");
  expect(await asks(), "the refused text is held in the document, so it is unsaved").toBe(true);
  await editor.getByRole("button", { name: "Discard the unapplied text" }).click();
  await expect(editor.getByLabel("Damage (FP)", { exact: true })).toHaveValue("12");
  expect(await asks(), "discarding is an edit too: Undo can bring the text back").toBe(true);
  await page.getByRole("button", { name: "Save active editor", exact: true }).click();
  await expect.poll(asks).toBe(false);
  expect(await readProjectFile(page, "SpcMove/fireball.spc")).toEqual(FIREBALL);
});

test("text one view holds is the document's: the other view shows it, Save refuses it, and a value typed over it replaces it (#3385)", async ({ page }) => {
  await openWorkbench(page);
  await openFile(page, "SpcMove", "fireball.spc");
  await toggleSecondView(page);
  const mirror = page.locator("#mirror");
  const field = mirror.getByLabel("Damage (FP)", { exact: true });
  await field.fill("9999999999");
  await field.blur();
  await expect(mirror.getByRole("alert")).toContainText("whole number");
  await toggleSecondView(page);
  await expect(mirror).toBeHidden();
  const primary = page.locator('[data-tkr-editor="Special move"]');
  const damage = primary.getByLabel("Damage (FP)", { exact: true });
  await expect(damage, "the primary view shows the text the document holds").toHaveValue("9999999999");
  await page.getByRole("button", { name: "Save active editor", exact: true }).click();
  await expect(primary.getByRole("alert").filter({ hasText: "Nothing was saved" })).toBeVisible();
  expect(await readProjectFile(page, "SpcMove/fireball.spc")).toEqual(FIREBALL);
  await damage.fill("-30");
  await damage.blur();
  await toggleSecondView(page);
  await expect(field, "a value typed in either view replaces the held text in both").toHaveValue("-30");
  await page.getByRole("button", { name: "Save active editor", exact: true }).click();
  await expect.poll(async () => Buffer.from(await readProjectFile(page, "SpcMove/fireball.spc")).readInt32LE(0x1e)).toBe(-30);
});
