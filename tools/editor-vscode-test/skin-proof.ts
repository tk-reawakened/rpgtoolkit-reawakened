import { crc32, deflateSync } from "node:zlib";
import type { expect as playwrightExpect, Locator } from "@playwright/test";

// Story 14.2 (T-64, ADR 0045 option 3A): the native skin document (docs/spec/formats/native-skin.md) in a real host. One
// scenario, two host adapters (the browser editor page and the VS Code workbench): open the skin, read the exact pixels of
// each role's preview back from the page, choose images through the project asset picker, undo and redo, refuse a write and
// keep the draft, save only the two reference values, reopen, and compare the legacy `.gam` bytes before and after.

type Expect = typeof playwrightExpect;
type Rgba = readonly [number, number, number, number];
export interface SkinPicture { readonly width: number; readonly height: number; readonly pixels: readonly Rgba[] }

export const SKIN_PROOF_PATH = "Game/Example/Skins/stone.tkrskin";
export const SKIN_PROOF_GAME = "Main/example.gam";
const BITMAPS = "Game/Example/Bitmap";

/** A PNG written from first principles: signature, IHDR (8-bit RGBA), one IDAT of unfiltered rows, IEND. */
function png(picture: SkinPicture): Uint8Array {
  const chunk = (type: string, data: Uint8Array): Buffer => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(picture.width, 0);
  header.writeUInt32BE(picture.height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const rows = Buffer.alloc((picture.width * 4 + 1) * picture.height);
  for (let y = 0; y < picture.height; y += 1) {
    const at = y * (picture.width * 4 + 1);
    for (let x = 0; x < picture.width; x += 1) rows.set(picture.pixels[y * picture.width + x]!, at + 1 + x * 4);
  }
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]));
}

export const WINDOW_A: SkinPicture = { width: 3, height: 2, pixels: [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 0, 255], [0, 255, 255, 255], [255, 0, 255, 255]] };
export const WINDOW_B: SkinPicture = { width: 2, height: 3, pixels: [[10, 20, 30, 255], [40, 50, 60, 255], [70, 80, 90, 255], [100, 110, 120, 255], [130, 140, 150, 255], [160, 170, 180, 255]] };
export const BUTTON_A: SkinPicture = { width: 2, height: 2, pixels: [[200, 10, 10, 255], [10, 200, 10, 255], [10, 10, 200, 255], [250, 250, 250, 255]] };
export const BUTTON_B: SkinPicture = { width: 4, height: 1, pixels: [[1, 2, 3, 255], [4, 5, 6, 255], [7, 8, 9, 255], [11, 12, 13, 255]] };

export const SKIN_PROOF_TEXT = `# stone keep skin
contract: skin
version: 1.0.0-pre.1+build.2
tags: [preview]
metadata: {note: 1.10}
label: Stone keep
windowImage: bitmap/window-a.png
buttonImage: bitmap/button-a.png # button comment
pluginData:
  com.example.glow:
    version: 1.0.0
    data: {future: 1.10} # opaque
`;

/** The authored skin and its four pictures; one picture is spelled in mixed case on disk, as the project may store it. */
export function skinProofFiles(): readonly { readonly path: string; readonly bytes: Uint8Array }[] {
  return [
    { path: SKIN_PROOF_PATH, bytes: new TextEncoder().encode(SKIN_PROOF_TEXT) },
    { path: `${BITMAPS}/window-a.png`, bytes: png(WINDOW_A) },
    { path: `${BITMAPS}/Window-B.PNG`, bytes: png(WINDOW_B) },
    { path: `${BITMAPS}/button-a.png`, bytes: png(BUTTON_A) },
    { path: `${BITMAPS}/button-b.png`, bytes: png(BUTTON_B) },
  ];
}

export interface SkinProofHost {
  readonly expect: Expect;
  /** Open the skin from the project (not an already open tab) and return its editor. */
  open(): Promise<Locator>;
  /** Close the skin's editor without a prompt. */
  close(): Promise<void>;
  /** Choose `file` for `role` through the project asset picker; `decline` answers the host's confirmation with Cancel. */
  choose(editor: Locator, role: "window" | "button", file: string, decline?: boolean): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  /** The host's own Save for the active editor. */
  save(): Promise<void>;
  /** The host says the save was refused (its own words), rather than silently keeping the draft. */
  expectRefusalShown(): Promise<void>;
  /** Whether the skin's tab shows unsaved changes. */
  expectDirty(dirty: boolean): Promise<void>;
  read(path: string): Promise<Uint8Array>;
  /** Run `check` while writes to the skin file are refused by the host's storage. */
  refuseSkinWrites(check: () => Promise<void>): Promise<void>;
  screenshot(name: string): Promise<void>;
}

/** The preview canvas of one role read back from the page until it holds exactly `picture`: its size, then every RGBA value. */
export async function expectSkinPreview(expect: Expect, editor: Locator, role: "Window graphic" | "Button graphic", reference: string, picture: SkinPicture): Promise<void> {
  const canvas = editor.getByRole("img", { name: `${role} image preview: ${reference}`, exact: true });
  await expect(canvas).toBeVisible();
  await expect.poll(() => canvas.evaluate((element) => {
    const target = element as HTMLCanvasElement;
    const data = target.getContext("2d")!.getImageData(0, 0, target.width, target.height).data;
    return [target.width, target.height, ...data];
  }), { message: `${role} shows ${reference} pixel for pixel` }).toEqual([picture.width, picture.height, ...picture.pixels.flat()]);
}

export async function runSkinAuthoringProof(host: SkinProofHost): Promise<void> {
  const { expect } = host;
  const same = async (path: string, bytes: Uint8Array): Promise<void> => { expect([...await host.read(path)]).toEqual([...bytes]); };
  const original = new TextEncoder().encode(SKIN_PROOF_TEXT);
  const gameBefore = await host.read(SKIN_PROOF_GAME);

  let editor = await host.open();
  await expect(editor.getByText("Preview only: the engine does not use skins yet.", { exact: true })).toBeVisible();
  await expect(editor.getByText("version: 1.0.0-pre.1+build.2")).toBeVisible();
  // The exact pixels of each selected image, each in its own role.
  await expectSkinPreview(expect, editor, "Window graphic", "bitmap/window-a.png", WINDOW_A);
  await expectSkinPreview(expect, editor, "Button graphic", "bitmap/button-a.png", BUTTON_A);

  // Previewing and cancelling a picker, at either of its two questions, are not edits.
  await host.choose(editor, "button", "button-b.png", true);
  await host.expectDirty(false);
  await same(SKIN_PROOF_PATH, original);

  // Each role changes on its own, and the preview follows the file whatever case it is spelled in.
  await host.choose(editor, "window", "Window-B.PNG");
  await host.expectDirty(true);
  await expectSkinPreview(expect, editor, "Window graphic", "bitmap/window-b.png", WINDOW_B);
  await expectSkinPreview(expect, editor, "Button graphic", "bitmap/button-a.png", BUTTON_A);
  await host.undo();
  await expectSkinPreview(expect, editor, "Window graphic", "bitmap/window-a.png", WINDOW_A);
  await host.expectDirty(false);
  await host.redo();
  await expectSkinPreview(expect, editor, "Window graphic", "bitmap/window-b.png", WINDOW_B);
  await host.expectDirty(true);
  await host.choose(editor, "button", "button-b.png");
  await expectSkinPreview(expect, editor, "Button graphic", "bitmap/button-b.png", BUTTON_B);

  // A refused write keeps the draft: both edits stay visible, the editor stays unsaved, and no file changes.
  await host.refuseSkinWrites(async () => {
    await host.save();
    await host.expectRefusalShown();
    await host.expectDirty(true);
    await expectSkinPreview(expect, editor, "Window graphic", "bitmap/window-b.png", WINDOW_B);
    await expectSkinPreview(expect, editor, "Button graphic", "bitmap/button-b.png", BUTTON_B);
    await same(SKIN_PROOF_PATH, original);
    await same(SKIN_PROOF_GAME, gameBefore);
    await host.screenshot("native-skin-refused-save");
  });

  // Writes are allowed again: the same draft saves, changing only the two reference values.
  await host.save();
  const saved = new TextEncoder().encode(SKIN_PROOF_TEXT
    .replace("windowImage: bitmap/window-a.png", "windowImage: bitmap/window-b.png")
    .replace("buttonImage: bitmap/button-a.png", "buttonImage: bitmap/button-b.png"));
  await expect.poll(async () => [...await host.read(SKIN_PROOF_PATH)]).toEqual([...saved]);
  await host.expectDirty(false);
  await same(SKIN_PROOF_GAME, gameBefore);

  // Reopened, the saved references and their exact pictures are back, and the game file is still untouched.
  await host.close();
  editor = await host.open();
  await expectSkinPreview(expect, editor, "Window graphic", "bitmap/window-b.png", WINDOW_B);
  await expectSkinPreview(expect, editor, "Button graphic", "bitmap/button-b.png", BUTTON_B);
  await host.expectDirty(false);
  await same(SKIN_PROOF_PATH, saved);
  await same(SKIN_PROOF_GAME, gameBefore);
  await host.screenshot("native-skin-reopened");
}
