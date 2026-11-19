import { decodeTexture, utf8Encode, type BoardImage } from "@tk-reawakened/core";
import type { AssetPack, Scene } from "@tk-reawakened/native-data";
import { sha256Hex } from "./document-history.ts";
import { encodeScenePng } from "./scene-png.ts";

export type ScenePackImageOutput = { readonly path: string; readonly bytes: Uint8Array };
export type ScenePackImageResult =
  | { readonly ok: true; readonly images: readonly BoardImage[]; readonly outputs: readonly ScenePackImageOutput[] }
  | { readonly ok: false; readonly problems: readonly { readonly path: string; readonly message: string }[] };

/** Returns only generated board slots, in placement/visual order. Outputs are project-relative. */
export async function lowerScenePackImages(
  scene: Scene,
  scenePath: string,
  resolvePack: (path: string) => Promise<AssetPack | null>,
  readSource: (path: string) => Promise<Uint8Array | null>,
  existingOutputPaths: readonly string[] = [],
): Promise<ScenePackImageResult> {
  const problems: { path: string; message: string }[] = [];
  const images: BoardImage[] = [];
  const outputs: ScenePackImageOutput[] = [];
  const occupied = new Set(existingOutputPaths.map((path) => path.toLowerCase()));
  const ids = new Set<string>();
  const sceneKey = await sha256Hex(utf8Encode(scenePath));
  const integer = (n: number): boolean => Number.isInteger(n) && n >= -2147483648 && n <= 2147483647;
  const fail = (path: string, message: string): void => { problems.push({ path, message }); };
  if (!Number.isInteger(scene.images?.length ?? 0) || (scene.images?.length ?? 0) > 32768) {
    return { ok: false, problems: [{ path: "images", message: "Image count exceeds the board table limit." }] };
  }
  for (const [index, placement] of (scene.placedPacks ?? []).entries()) {
    const path = `placedPacks[${index}]`;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(placement.instanceId) || ids.has(placement.instanceId)) {
      fail(`${path}.instanceId`, "Placement instance ID is invalid or duplicated."); continue;
    }
    ids.add(placement.instanceId);
    let pack: AssetPack | null;
    try { pack = await resolvePack(placement.pack); } catch { fail(`${path}.pack`, "Unable to read pack."); continue; }
    if (pack === null) { fail(`${path}.pack`, "Unable to resolve pack."); continue; }
    if (pack.projection !== scene.projection) { fail(`${path}.pack`, "Pack projection differs from scene projection."); continue; }
    const assets = pack.assets.filter((asset) => asset.id === placement.asset);
    if (assets.length !== 1) { fail(`${path}.asset`, "Pack asset must resolve exactly once."); continue; }
    const asset = assets[0]!;
    const floors = scene.floors.flatMap((floor, i) => floor.id === placement.floor ? [i + 1] : []);
    if (floors.length !== 1 || floors[0]! > 32767) { fail(`${path}.floor`, "Placement floor cannot be represented as a board layer."); continue; }
    const left = placement.x - asset.anchor.x, top = placement.y - asset.anchor.y;
    if (![placement.x, placement.y, asset.anchor.x, asset.anchor.y, left, top].every(integer)) {
      fail(path, "Image origin exceeds the board's signed 32-bit coordinate range."); continue;
    }
    if (asset.visuals.length === 0) { fail(`${path}.asset`, "Pack asset has no visuals."); continue; }
    for (const [visualIndex, visual] of asset.visuals.entries()) {
      const visualPath = `${path}.visuals[${visualIndex}]`;
      const layer = floors[0]! + (visual.layerOffset ?? 0);
      if (!Number.isInteger(visual.layerOffset ?? 0) || layer < 1 || layer > scene.floors.length || layer > 32767) {
        fail(visualPath, "Visual layer is outside the board's layers."); continue;
      }
      if ((scene.images?.length ?? 0) + images.length >= 32768) { fail(visualPath, "Image count exceeds the board table limit."); continue; }
      const sources = pack.sources.filter((source) => source.id === visual.source);
      if (sources.length !== 1) { fail(visualPath, "Visual source must resolve exactly once."); continue; }
      const source = sources[0]!;
      const transparency = source.transparent;
      if (transparency !== undefined && transparency.mode !== "alpha" && transparency.mode !== "colorKey") {
        fail(visualPath, "Unsupported transparency mode."); continue;
      }
      if (transparency?.mode === "colorKey" && (!Array.isArray(transparency.color) || transparency.color.length !== 3 || !transparency.color.every((v) => Number.isInteger(v) && v >= 0 && v <= 255))) {
        fail(visualPath, "Invalid transparent color key."); continue;
      }
      let bytes: Uint8Array | null;
      try { bytes = await readSource(source.file); } catch { fail(visualPath, "Unable to read visual source."); continue; }
      if (!(bytes instanceof Uint8Array)) { fail(visualPath, "Unable to read visual source."); continue; }
      const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      const [x, y, width, height] = visual.rect;
      if (jpeg && (x !== 0 || y !== 0 || transparency?.mode === "colorKey")) {
        fail(visualPath, "JPEG crops and transparency conversion are unavailable."); continue;
      }
      const decoded = decodeTexture(bytes, source.file);
      if (!decoded.ok) { fail(visualPath, `Unable to decode visual source: ${decoded.error.message}`); continue; }
      const { w, h, rgba } = decoded.value;
      if (![x, y, width, height].every(Number.isSafeInteger) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > w || y + height > h) {
        fail(visualPath, "Visual crop is outside the source image."); continue;
      }
      if (jpeg && (width !== w || height !== h || !/^Bitmap\/.+/i.test(source.file))) {
        fail(visualPath, "JPEG requires a whole Bitmap source without transparency conversion."); continue;
      }
      const crop = new Uint8Array(width * height * 4);
      const used = new Set<number>();
      for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
        const from = ((y + row) * w + x + col) * 4, to = (row * width + col) * 4;
        const r = rgba[from]!, g = rgba[from + 1]!, b = rgba[from + 2]!;
        let alpha = rgba[from + 3]!;
        if (transparency?.mode === "colorKey" && r === transparency.color[0] && g === transparency.color[1] && b === transparency.color[2]) alpha = 0;
        crop[to] = r; crop[to + 1] = g; crop[to + 2] = b; crop[to + 3] = alpha;
        if (alpha !== 0) used.add((r << 16) | (g << 8) | b);
      }
      let key = 0;
      while (key < 0x1000000 && used.has(key)) key++;
      if (key === 0x1000000) { fail(visualPath, "Crop has no available transparent RGB key."); continue; }
      const color = { r: key >>> 16, g: (key >>> 8) & 255, b: key & 255 };
      let file: string;
      if (jpeg) {
        file = source.file.slice(7).replaceAll("/", "\\");
      } else {
        for (let i = 0; i < crop.length; i += 4) if (crop[i + 3] === 0) {
          crop[i] = color.r; crop[i + 1] = color.g; crop[i + 2] = color.b;
        }
        const outputPath = `Bitmap/.tkr-generated/${sceneKey}/${placement.instanceId}-${visualIndex}.png`;
        if (occupied.has(outputPath.toLowerCase())) { fail(visualPath, "Generated image path collides with another output."); continue; }
        occupied.add(outputPath.toLowerCase());
        try { outputs.push({ path: outputPath, bytes: encodeScenePng({ w: width, h: height, rgba: crop }) }); }
        catch { fail(visualPath, "Visual crop cannot be encoded as PNG."); continue; }
        file = outputPath.slice(7).replaceAll("/", "\\");
      }
      images.push({ file, left, top, layer, drawType: 0, transparent: color, reserved: 100 });
    }
  }
  return problems.length === 0 ? { ok: true, images, outputs } : { ok: false, problems };
}
