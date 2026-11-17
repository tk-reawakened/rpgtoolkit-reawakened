import { BinaryReader, readAnimation, readTileBitmap } from "@tk-reawakened/core";
import type { expect as playwrightExpect, Locator } from "@playwright/test";

export const ANIMATION_PROOF_PATH = "Misc/host-proof.anm";
export interface AnimationProofHost {
  create(): Promise<Locator>;
  reopen(): Promise<Locator>;
  /** Close affected documents and recreate the host session before recovery. */
  restart(): Promise<void>;
  restore(reason: "before-wizard" | "before-restore"): Promise<void>;
  read(path: string): Promise<Uint8Array | null>;
  consent(): Promise<void>;
  refuseAnimationWrite(check: () => Promise<void>): Promise<void>;
  settle(): Promise<void>;
}

/** Identical author actions and persisted-byte assertions in the shipped browser and real VS Code custom editor. */
export async function runAnimationAuthoringProof(host: AnimationProofHost, expect: typeof playwrightExpect): Promise<void> {
  console.log("animation proof: creating a new animation");
  let editor = await host.create();
  const click = async (name: string) => { await editor.getByRole("button", { name, exact: true }).click(); await host.settle(); };
  const decode = async () => {
    const bytes = await host.read(ANIMATION_PROOF_PATH);
    if (bytes === null) throw new Error("The animation destination is missing");
    const read = readAnimation(new BinaryReader(bytes));
    if (!read.ok) throw new Error(read.error.message);
    return read.value;
  };
  const empty = await host.read(ANIMATION_PROOF_PATH);
  expect((await decode()).frames).toHaveLength(0);
  await editor.locator("summary").filter({ hasText: "Build from sorted Bitmap images" }).click();
  await editor.getByRole("checkbox", { name: "a.gif", exact: true }).check();
  await click("Cancel image wizard");
  expect(await host.read(ANIMATION_PROOF_PATH)).toEqual(empty);
  await editor.locator("summary").filter({ hasText: "Build from sorted Bitmap images" }).click();
  await editor.getByRole("checkbox", { name: "a.gif", exact: true }).check();
  await editor.getByRole("checkbox", { name: "z.gif", exact: true }).check();
  await editor.getByRole("list", { name: "Staged image order" }).getByRole("button", { name: "Move image earlier" }).nth(1).click();
  await click("Insert selected sorted images");
  await host.consent();
  await expect.poll(async () => (await decode()).frames.map((frame) => frame.image)).toEqual(["z.gif", "a.gif"]);
  await expect(editor.getByRole("img", { name: "Animation frame 1 preview" })).toBeVisible();
  await editor.getByLabel("Sound reference", { exact: true }).fill("Sounds/first.wav");
  await editor.getByLabel("red", { exact: true }).fill("17");
  await editor.getByLabel("green", { exact: true }).fill("29");
  await editor.getByLabel("blue", { exact: true }).fill("41");
  await click("Save");
  await expect.poll(async () => (await decode()).frames[0]).toEqual({ image: "z.gif", transparent: { r: 17, g: 29, b: 41 }, sound: "Sounds/first.wav" });
  await editor.getByLabel("Canvas width", { exact: true }).fill("8");
  await editor.getByLabel("Canvas height", { exact: true }).fill("6");
  await click("Save");
  // Authored GIF source is 4×3; the unequal 8×6 canvas must scale each source pixel twice.
  // Its first opaque palette entry is (10,20,30).
  // Canvas pixels (including premultiplied transparent RGB) prove a real rendered frame, not merely mounted controls.
  await expect.poll(async () => editor.getByRole("img", { name: "Animation frame 1 preview" }).evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    return { width: canvas.width, height: canvas.height, pixels: [...canvas.getContext("2d")!.getImageData(0, 0, 4, 1).data] };
  })).toEqual({ width: 8, height: 6, pixels: [10, 20, 30, 255, 10, 20, 30, 255, 0, 0, 0, 0, 0, 0, 0, 0] });
  const moveLater = editor.getByRole("button", { name: "Move later", exact: true });
  // Keyboard dispatch does not wait for a button disabled by the preceding save.
  await expect(moveLater).toBeEnabled();
  await moveLater.focus();
  await moveLater.press("Enter");
  await expect(editor.getByRole("button", { name: "Frame 2: z.gif", exact: true })).toHaveAttribute("aria-current", "true");
  await click("Save");
  await expect.poll(async () => (await decode()).frames[1]?.sound).toBe("Sounds/first.wav");
  editor = await host.reopen();
  await click("Frame 2: z.gif");
  await expect(editor.getByLabel("Sound reference")).toHaveValue("Sounds/first.wav");
  await expect(editor.getByLabel("red", { exact: true })).toHaveValue("17");
  await click("Play");
  await expect(editor.getByRole("button", { name: "Stop playback", exact: true })).toBeVisible();
  await click("Stop playback");
  await click("Frame 1: a.gif");
  console.log("animation proof: image order and metadata saved/reopened; composing tiles");
  const beforeTiles = await host.read(ANIMATION_PROOF_PATH);
  await editor.locator("summary").filter({ hasText: "Compose 4×4 tile bitmap frames" }).click();
  await editor.locator(".tkr-tileset-browser select").selectOption("Tiles/village.tst");
  await editor.locator('[data-browser-reference="village.tst1"] .tkr-tileset-browser-source').click();
  await host.settle();
  for (let cell = 1; cell <= 16; cell++) {
    await editor.getByRole("group", { name: "4 by 4 tile cells" }).getByRole("button", { name: new RegExp(`^Cell ${cell}:`) }).click();
    await click("Put selected tile in cell");
  }
  await editor.getByLabel("New tile bitmap name").fill("cancelled.tbm");
  await click("Stage TBM frame");
  await expect(editor.getByRole("img", { name: "Preview of Bitmap/cancelled.tbm" })).toBeVisible();
  await click("Cancel staged frame");
  expect(await host.read("Bitmap/cancelled.tbm")).toBeNull();
  expect(await host.read(ANIMATION_PROOF_PATH)).toEqual(beforeTiles);
  for (const name of ["proof-first.tbm", "proof-second.tbm"]) {
    await editor.getByLabel("New tile bitmap name").fill(name);
    await click("Stage TBM frame");
    await expect(editor.getByRole("img", { name: `Preview of Bitmap/${name}` })).toBeVisible();
    if (name === "proof-first.tbm") await click("Add composition to sequence and reuse template");
  }
  await expect(editor.getByRole("list", { name: "Staged tile frame order" }).getByRole("listitem")).toHaveCount(1);
  await host.refuseAnimationWrite(async () => {
    await click("Create tile sequence including staged frame");
    await host.consent();
    const group = editor.getByRole("article").filter({ hasText: "Bitmap/proof-first.tbm" });
    await expect(group).toContainText("Misc/host-proof.anm: failed", { timeout: 20_000 });
    await expect(group).toContainText("Bitmap/proof-first.tbm: written");
    await expect(group).toContainText("Bitmap/proof-second.tbm: written");
    expect(await host.read(ANIMATION_PROOF_PATH)).toEqual(beforeTiles);
    await group.getByRole("button", { name: "Leave as is", exact: true }).click();
  });
  const group = editor.getByRole("article").filter({ hasText: "Bitmap/proof-first.tbm" });
  await group.getByRole("button", { name: "Retry remaining", exact: true }).click();
  await host.consent();
  await expect.poll(async () => (await decode()).frames.map((frame) => frame.image)).toEqual(["proof-first.tbm", "proof-second.tbm", "a.gif", "z.gif"]);
  await click("Frame 1: proof-first.tbm");
  // The authored tile has red 0 at x=0 and 127 at x=16. The 128px TBM sampled onto
  // the 8px canvas alternates those samples; its (0,0,60) key becomes transparent.
  await expect.poll(async () => editor.getByRole("img", { name: "Animation frame 1 preview" }).evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    return [...canvas.getContext("2d")!.getImageData(0, 0, 4, 1).data];
  })).toEqual([0, 0, 0, 0, 127, 0, 60, 255, 0, 0, 0, 0, 127, 0, 60, 255]);
  const completed = await host.read(ANIMATION_PROOF_PATH);
  expect((await decode()).frames[3]).toEqual({ image: "z.gif", transparent: { r: 17, g: 29, b: 41 }, sound: "Sounds/first.wav" });
  for (const path of ["Bitmap/proof-first.tbm", "Bitmap/proof-second.tbm"]) {
    const bytes = await host.read(path);
    expect(bytes).not.toBeNull();
    const decoded = readTileBitmap(new BinaryReader(bytes!));
    if (!decoded.ok) throw new Error(decoded.error.message);
    expect([decoded.value.width, decoded.value.height]).toEqual([4, 4]);
    for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) expect(decoded.value.cells[x * 5 + y]?.tile).toBe("village.tst1");
  }
  console.log("animation proof: partial-write retry passed; restarting for recovery");
  await host.restart();
  await host.restore("before-wizard");
  await expect.poll(() => host.read(ANIMATION_PROOF_PATH)).toEqual(beforeTiles);
  expect(await host.read("Bitmap/proof-first.tbm")).toBeNull();
  expect(await host.read("Bitmap/proof-second.tbm")).toBeNull();
  await host.restore("before-restore");
  await expect.poll(() => host.read(ANIMATION_PROOF_PATH)).toEqual(completed);
  expect(await host.read("Bitmap/proof-first.tbm")).not.toBeNull();
  editor = await host.reopen();
  await click("Frame 4: z.gif");
  await expect(editor.getByLabel("Sound reference")).toHaveValue("Sounds/first.wav");
  await expect(editor.getByLabel("blue", { exact: true })).toHaveValue("41");
  // Direct tile references retain their native 32px size even on a larger canvas.
  await click("Frame 1: proof-first.tbm");
  await editor.getByLabel("Image reference", { exact: true }).fill("village.tst1");
  await editor.getByLabel("Canvas width", { exact: true }).fill("64");
  await editor.getByLabel("Canvas height", { exact: true }).fill("64");
  await click("Save");
  await expect.poll(async () => editor.getByRole("img", { name: "Animation frame 1 preview" }).evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    return { width: canvas.width, height: canvas.height, pixels: [...canvas.getContext("2d")!.getImageData(31, 31, 2, 1).data] };
  })).toEqual({ width: 64, height: 64, pixels: [247, 247, 60, 255, 0, 0, 0, 0] });
}
