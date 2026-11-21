import {
  TILE_ANIMATION_MAGIC, TILE_ANIMATION_MAJOR, TILE_ANIMATION_MINOR, tilesetDetail,
  utf8Encode, writeTileAnimation, writeTileset, type DecodedTexture, type TilesetTile,
} from "@tk-reawakened/core";
import { documentId, type NativeTile, type NativeTileSample } from "@tk-reawakened/native-data";
import { sha256Hex } from "./document-history.ts";
import { encodeSceneTileCrop } from "./scene-tile-encoder.ts";

export type SceneTileSlot =
  | { readonly slot: number; readonly tile: string; readonly cel?: string; readonly reserved?: never }
  | { readonly slot: number; readonly tile?: never; readonly cel?: never; readonly reserved: true };

type Member = { readonly path: string; readonly tile: NativeTile };
type Binding = { readonly target: string; readonly detail: number; readonly slots: readonly SceneTileSlot[] };
export type SceneTileCrop = { readonly image: DecodedTexture; readonly rect: readonly [number, number, number, number] };
type Problem = { readonly path: string; readonly message: string };
type Output = { readonly path: string; readonly bytes: Uint8Array };
type Result =
  | { readonly ok: false; readonly problems: readonly Problem[] }
  | { readonly ok: true; readonly outputs: readonly Output[]; readonly references: ReadonlyMap<string, string> };
type Allocation = { readonly path: string; readonly tile: NativeTile; readonly sample: NativeTileSample };
type CelAllocation = { readonly sample: NativeTileSample; slot: number };
type TileAllocation = { readonly cels: Map<string, CelAllocation>; readonly member: Member };

const fold = (path: string): string => documentId(path).replace(/[A-Z]/g, (c) => c.toLowerCase());
const legacyReference = (path: string): string => path.slice("Tiles/".length).replaceAll("/", "\\");
const EXACT_MS = new Set([50, 100, 200, 250, 500, 1000]);

/** Prepare the legacy images and references; the scene build owns preflight, freshness and persistence. */
export async function lowerSceneTileSlots(
  binding: Binding,
  members: readonly Member[],
  resolveCrop: (sample: NativeTileSample) => Promise<SceneTileCrop | null>,
): Promise<Result> {
  // docs/spec/formats/native-tileset.md#terrain-cutover
  const target = documentId(binding.target);
  const problems: Problem[] = [];
  if (!/^Tiles\/.+\.tst$/i.test(target)) problems.push({ path: "outputBinding.target", message: "Generated tilesets must have a .tst destination under Tiles/." });
  const detail = tilesetDetail(binding.detail);
  if (detail === undefined || detail.isometric) problems.push({ path: "outputBinding.detail", message: "The binding requires an unsupported flat tileset detail." });
  if (binding.slots.length > 32767) problems.push({ path: "outputBinding.slots", message: "The slot table exceeds the signed tileset count of 32767." });
  if (problems.length > 0 || detail === undefined) return { ok: false, problems };
  const tiles = new Map<string, TileAllocation>();
  for (const member of members) {
    const id = fold(member.path);
    if (tiles.has(id)) problems.push({ path: member.path, message: "This tile is listed more than once in the palette." });
    else {
      const cels = new Map<string, CelAllocation>();
      if (member.tile.visual.sample !== undefined) cels.set("", { sample: member.tile.visual.sample, slot: 0 });
      else for (const cell of member.tile.visual.cels) cels.set(cell.id, { sample: cell.sample, slot: 0 });
      tiles.set(id, { member, cels });
    }
  }

  // A missing element is an unallocated number; null is an explicit reservation.
  const allocations: (Allocation | null | undefined)[] = Array(binding.slots.length);
  const rowIndices = new Map<number, number>();
  for (const [index, row] of binding.slots.entries()) {
    const path = `outputBinding.slots[${index}]`;
    if (!Number.isInteger(row.slot) || row.slot < 1 || row.slot > binding.slots.length) {
      problems.push({ path: `${path}.slot`, message: `Slot must be within 1..${binding.slots.length}; the table must cover every position.` });
      continue;
    }
    const first = rowIndices.get(row.slot);
    if (first !== undefined) {
      problems.push({ path: `${path}.slot`, message: `Slot ${row.slot} is already allocated by row ${first}.` });
      continue;
    }
    rowIndices.set(row.slot, index);
    if (row.reserved === true) { allocations[row.slot - 1] = null; continue; }
    const owner = tiles.get(fold(row.tile));
    if (owner === undefined) { problems.push({ path: `${path}.tile`, message: `${row.tile} is not in this tileset.` }); continue; }
    const cel = row.cel ?? "";
    const allocation = owner.cels.get(cel);
    if (allocation === undefined) { problems.push({ path, message: `Slot ${row.slot} does not name a still tile or an existing cel of ${row.tile}.` }); continue; }
    if (allocation.slot !== 0) { problems.push({ path, message: `${row.tile}${cel === "" ? "" : ` cel ${cel}`} already has a slot.` }); continue; }
    allocation.slot = row.slot;
    allocations[row.slot - 1] = { path: `${owner.member.path}${cel === "" ? ".visual.sample" : ` cel ${cel}`}`, tile: owner.member.tile, sample: allocation.sample };
  }
  if (rowIndices.size !== allocations.length) problems.push({ path: "outputBinding.slots", message: "Every slot from 1 through the last slot must have exactly one row." });
  for (const { member, cels } of tiles.values()) {
    for (const [id, { slot }] of cels) if (slot === 0) {
      problems.push({ path: member.path, message: id === "" ? "Still tile has no output slot." : `Cel ${id} has no output slot.` });
    }
    const timeline = member.tile.visual.timeline;
    if (timeline !== undefined) {
      if ((timeline.phaseMs ?? 0) !== 0) problems.push({ path: `${member.path}.visual.timeline.phaseMs`, message: "A nonzero phase cannot be lowered to .tan." });
      const ms = timeline.frames[0]!.ms;
      if (!EXACT_MS.has(ms) || timeline.frames.some((frame) => frame.ms !== ms)) {
        problems.push({ path: `${member.path}.visual.timeline.frames`, message: "A .tan needs equal frame durations of 50, 100, 200, 250, 500 or 1000 ms for exact playback." });
      }
    }
  }
  if (problems.length > 0) return { ok: false, problems };
  const pixels = detail.size * detail.size;
  let tombstone: TilesetTile | undefined;
  const encoded: TilesetTile[] = [];
  for (const allocation of allocations) {
    if (allocation === null) {
      if (tombstone === undefined) {
        const bytes = new Uint8Array(pixels * detail.bytesPerPixel);
        if (detail.bytesPerPixel === 1) bytes.fill(255);
        else for (let pos = 0; pos < bytes.length; pos += 3) { bytes[pos + 1] = 1; bytes[pos + 2] = 2; }
        tombstone = { pixels: bytes };
      }
      encoded.push(tombstone);
      continue;
    }
    if (allocation === undefined) throw new Error("validated tile slot table has a hole");
    const crop = await resolveCrop(allocation.sample);
    if (crop === null) { problems.push({ path: allocation.path, message: "Cannot resolve this tile's source pixels." }); continue; }
    const result = encodeSceneTileCrop(detail.code, crop.image, crop.rect, allocation.tile.visual.transparent, allocation.tile.kitbash);
    if (!result.ok) {
      const where = result.error.x === undefined ? "" : ` (pixel ${result.error.x}, ${result.error.y})`;
      problems.push({ path: allocation.path, message: result.error.message + where });
    } else encoded.push(result.tile);
  }
  if (problems.length > 0) return { ok: false, problems };
  const tst = writeTileset({ version: 20, detail, tiles: encoded, residue: new Uint8Array() });
  if (!tst.ok) return { ok: false, problems: [{ path: "outputBinding", message: tst.error.message }] };

  const outputs: Output[] = [{ path: target, bytes: tst.value }];
  const references = new Map<string, string>();
  const tstRef = legacyReference(target);
  // File order is deterministic even when display order changes. Name allocation does not depend on cel order.
  for (const id of [...tiles.keys()].sort()) {
    const { member, cels } = tiles.get(id)!;
    const timeline = member.tile.visual.timeline;
    if (timeline === undefined) { references.set(id, `${tstRef}${cels.get("")!.slot}`); continue; }
    const hash = await sha256Hex(utf8Encode(id));
    const path = `${target.slice(0, -4)}.tile-${hash}.tan`;
    const frames = timeline.frames.map(({ cel }) => `${tstRef}${cels.get(cel)!.slot}`);
    const tan = writeTileAnimation({
      magic: TILE_ANIMATION_MAGIC, major: TILE_ANIMATION_MAJOR, minor: TILE_ANIMATION_MINOR,
      speed: 1000 / timeline.frames[0]!.ms, frameCount: frames.length, frames,
    });
    if (!tan.ok) return { ok: false, problems: [{ path, message: tan.error.message }] };
    outputs.push({ path, bytes: tan.value });
    references.set(id, legacyReference(path));
  }
  return { ok: true, outputs, references };
}
