// A project TrueType face reaches the live WebGL renderer (#1938). The core draw list names TrueType glyph IDs; a renderer
// that held only the bundled faces replays them against the bitmap fallback and draws other characters. This serves a
// generated package that ships its own `Font/custom.ttf`, boots it through the real player page (`createLiveSession`
// with the real WebGL2 renderer), and compares the pixels on the canvas with the ink of the same draw-list command
// rendered from an independently parsed project face, and with the bitmap fallback's reading of the same IDs, which the
// canvas must not show.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  createEmptyBoard,
  createEmptyCharacter,
  createEmptyMainFile,
  deriveGameId,
  derivePackageIdentity,
  readLegacyFont,
  readTrueTypeFont,
  textInk,
  writeBoard,
  writeCharacter,
  writeDistributionPackage,
  writeMainFile,
  type DrawList,
  type Rgb,
  type TextCommand,
  type TextInk,
} from "@tk-reawakened/core";

type TestWindow = Window & {
  __session?: {
    viewSize(): { readonly width: number; readonly height: number };
    displayGeometry(): { readonly game: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } };
    engine: { drawList(alpha: number, include: { shading: boolean; images: boolean; sprites: boolean }): DrawList };
  };
  __live?: { readonly tick: number; readonly error?: string };
};

const fontBytes = new Uint8Array(readFileSync("media/fonts/LiberationSans-Regular.ttf"));
const bitmapBytes = new Uint8Array(readFileSync("media/fonts/tkr-8x8.fnt"));
const encoder = new TextEncoder();
const packageName = "project-font.tpk";

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** A 3.1 package whose start program draws `Hello` in the package's own `custom.ttf`; no bundled face carries that key. */
function projectFontPackage(): { readonly bytes: Uint8Array; readonly descriptor: Record<string, unknown> } {
  const empty = createEmptyBoard();
  const main = unwrap(writeMainFile({
    ...createEmptyMainFile(), major: 2, minor: 9, startupPrg: "start.prg", initBoard: "start.brd", initChar: "hero.tem",
    movementControls: 5, movementScanCodes: [0xcd, 0, 0xd0, 0, 0xcb, 0, 0xc8, 0],
  }));
  const board = unwrap(writeBoard({
    ...empty, sizeX: 8, sizeY: 8, sizeL: 1, tileMatrix: Array.from({ length: 64 }, () => 0),
    tileRuns: [{ lutIndex: 0, count: 64, marker: true }], layerTitles: ["", ""],
    properties: { ...empty.properties, start: { x: 200, y: 200, layer: 1 } },
  }));
  const hero = unwrap(writeCharacter({
    ...createEmptyCharacter(), minor: 5, name: "Hero", movementAnimations: Array(8).fill(""), battleStances: Array(6).fill(""),
  }));
  const tree = [
    { path: "Main/test.gam", bytes: main },
    { path: "Boards/start.brd", bytes: board },
    { path: "Chrs/hero.tem", bytes: hero },
    { path: "Prg/start.prg", bytes: encoder.encode('font("custom")\ntext(1, 1, "Hello")\nwait()\nend()\n') },
    { path: "Font/custom.ttf", bytes: fontBytes },
  ];
  const packaged = unwrap(writeDistributionPackage({ files: tree, manifest: { schema: 1, main: "Main/test.gam", index: tree.map((file) => file.path) } }));
  return {
    bytes: packaged,
    descriptor: {
      schema: 1, file: packageName, sha256: createHash("sha256").update(packaged).digest("hex"), size: packaged.length,
      gameId: deriveGameId(main, derivePackageIdentity(tree)), title: "Project font probe", version: "1",
    },
  };
}

type Pixel = readonly [number, number, number];

/** How many pixels of `region` differ from what drawing `ink` over a uniform `background` would leave. */
function mismatches(pixels: ReadonlyMap<string, Pixel>, ink: readonly TextInk[], rgb: Rgb, background: Pixel): number {
  const covered = new Map<string, number>();
  for (const point of ink) covered.set(`${point.x},${point.y}`, point.coverage);
  const ink3: Pixel = [rgb.r, rgb.g, rgb.b];
  let bad = 0;
  for (const [at, pixel] of pixels) {
    const coverage = covered.get(at) ?? 0;
    const tolerance = coverage === 0 || coverage === 255 ? 0 : 2;
    const expected = ink3.map((channel, index) => coverage === 0
      ? background[index]!
      : Math.round(background[index]! + (channel - background[index]!) * coverage / 255));
    if (pixel.some((channel, index) => Math.abs(channel - expected[index]!) > tolerance)) bad += 1;
  }
  return bad;
}

test("a project TrueType face in the package is what the live WebGL renderer draws", async ({ page }) => {
  const fixture = projectFontPackage();
  await page.route(`**/fixtures/packages/${packageName}`, (route) => {
    const range = route.request().headers()["range"];
    const match = range === undefined ? null : /^bytes=(\d+)-(\d+)$/.exec(range);
    if (match === null) {
      return route.fulfill({ status: 200, contentType: "application/octet-stream", headers: { "content-length": String(fixture.bytes.length), "accept-ranges": "bytes" }, body: Buffer.from(fixture.bytes) });
    }
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), fixture.bytes.length - 1);
    const slice = fixture.bytes.subarray(start, end + 1);
    return route.fulfill({ status: 206, contentType: "application/octet-stream", headers: { "content-range": `bytes ${start}-${end}/${fixture.bytes.length}`, "content-length": String(slice.length) }, body: Buffer.from(slice) });
  });
  await page.route(`**/fixtures/packages/${packageName}.json`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixture.descriptor) }));
  // Roomy enough for exactly one logical pixel per canvas pixel, so no scaling filter sits between the draw list and the glyph pixels.
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto(`/packages/runner-web/app/index.html?package=fixtures/packages/${packageName}`);
  await page.waitForFunction(() => (window as TestWindow).__live?.error !== undefined || ((window as TestWindow).__live?.tick ?? 0) > 30, undefined, { timeout: 45_000 });
  expect(await page.evaluate(() => (window as TestWindow).__live?.error)).toBeUndefined();

  const helloCommand = (): Promise<TextCommand | null> => page.evaluate((): TextCommand | null => {
    const list = (window as TestWindow).__session?.engine.drawList(0, { shading: true, images: true, sprites: true });
    return list?.commands.find((candidate): candidate is TextCommand => candidate.kind === "text" && candidate.text === "Hello") ?? null;
  });
  await expect.poll(helloCommand, { timeout: 20_000 }).not.toBeNull();
  const command = await helloCommand();
  if (command === null) throw new Error("the start program drew no Hello text");
  expect(command.font.asset).toBe("font/custom.ttf");

  const face = unwrap(readTrueTypeFont(fontBytes));
  const reference = textInk(command, face);
  const fallback = textInk(command, unwrap(readLegacyFont(bitmapBytes, "tkr-8x8.fnt")));
  if (reference === null || fallback === null) throw new Error("the reference faces could not draw the command");
  expect(reference.length).toBeGreaterThan(50);
  expect(command.advances.map((advance) => advance.glyph)).toEqual(Array.from("Hello", (character) => face.charToGlyph(character).id));

  const xs = [...reference, ...fallback].map((point) => point.x);
  const ys = [...reference, ...fallback].map((point) => point.y);
  const region = {
    left: Math.min(...xs) - 2, top: Math.min(...ys) - 2,
    width: Math.max(...xs) - Math.min(...xs) + 5, height: Math.max(...ys) - Math.min(...ys) + 5,
  };
  const shot = await page.evaluate((box) => {
    const canvas = document.querySelector<HTMLCanvasElement>("#screen");
    const session = (window as TestWindow).__session;
    const gl = canvas?.getContext("webgl2");
    if (canvas === null || session === undefined || gl === null || gl === undefined) throw new Error("live player canvas, WebGL context, or session is unavailable");
    const { game } = session.displayGeometry();
    const view = session.viewSize();
    const rgba = new Uint8Array(box.width * box.height * 4);
    gl.readPixels(game.x + box.left, canvas.height - (game.y + box.top + box.height), box.width, box.height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    return { scaleX: game.width / view.width, scaleY: game.height / view.height, rgba: Array.from(rgba) };
  }, region);
  expect([shot.scaleX, shot.scaleY]).toEqual([1, 1]);

  const pixels = new Map<string, Pixel>();
  for (let row = 0; row < region.height; row += 1) {
    for (let column = 0; column < region.width; column += 1) {
      const at = ((region.height - 1 - row) * region.width + column) * 4;
      pixels.set(`${region.left + column},${region.top + row}`, [shot.rgba[at]!, shot.rgba[at + 1]!, shot.rgba[at + 2]!]);
    }
  }
  // The background is whatever the region holds away from the reference glyph pixels, so no colour is assumed.
  const inked = new Set(reference.map((point) => `${point.x},${point.y}`));
  const counts = new Map<string, number>();
  for (const [at, pixel] of pixels) if (!inked.has(at)) counts.set(pixel.join(","), (counts.get(pixel.join(",")) ?? 0) + 1);
  const channels = [...counts].sort((a, b) => b[1] - a[1])[0]![0].split(",").map(Number);
  const background: Pixel = [channels[0]!, channels[1]!, channels[2]!];

  expect(mismatches(pixels, reference, command.rgb, background), "the canvas shows the project face's glyph pixels").toBe(0);
  // The same check against the bitmap fallback must fail, so a renderer that reverted to it could not pass this test.
  expect(mismatches(pixels, fallback, command.rgb, background), "the canvas is not the bitmap fallback's reading of the glyph IDs").toBeGreaterThan(20);
});
