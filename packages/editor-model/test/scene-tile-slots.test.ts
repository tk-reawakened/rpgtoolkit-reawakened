import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { BinaryReader, expandTileToRgba, readTileAnimation, readTileset } from "@tk-reawakened/core";
import type { NativeTile, NativeTileSample } from "@tk-reawakened/native-data";
import { lowerSceneTileSlots, type SceneTileSlot } from "../src/scene-tile-slots.ts";

const transparent = { mode: "alpha" } as const;
const head = { contract: "tile", version: "1.0.0-pre.1", name: "Painted tile", projection: "2d", role: "floor" } as const;
const sample = (column: number): NativeTileSample => ({ file: "art/sheet.png", rect: [32 * column, 0, 32, 32] });
const still = (column: number): NativeTile => ({ ...head, visual: { transparent, sample: sample(column) } });
const frames = [{ cel: "first", ms: 200 }, { cel: "second", ms: 200 }, { cel: "first", ms: 200 }];
const cels = [{ id: "first", sample: sample(1) }, { id: "second", sample: sample(2) }];
const animated = (extra = false): NativeTile => ({
  ...head,
  visual: { transparent, cels: extra ? [...cels, { id: "third", sample: sample(4) }] : cels, timeline: { frames } },
});
const rgba = new Uint8Array(160 * 32 * 4);
for (let y = 0; y < 32; y += 1) for (let x = 0; x < 160; x += 1) rgba.set([16 + (x >> 5), 80, 90, 255], (y * 160 + x) * 4);
async function crop(value: NativeTileSample) {
  return "file" in value ? { image: { rgba, w: 160, h: 32 }, rect: value.rect } : null;
}
const ground = { path: "Tiles/Grass.tkrtle", tile: still(0) };
const pond = { path: "Tiles/Water.tkrtle", tile: animated() };
const bank = { path: "Tiles/Bank.tkrtle", tile: still(3) };
const rows: SceneTileSlot[] = [
  { slot: 1, tile: ground.path }, { slot: 2, tile: bank.path }, { slot: 3, tile: pond.path, cel: "first" },
  { slot: 4, tile: pond.path, cel: "second" }, { slot: 5, reserved: true }, { slot: 6, tile: "tiles/Last.tkrtle" },
];
const last = { path: "Tiles/Last.tkrtle", tile: still(4) };
const target = "Tiles/Village/pond.tst";

void test("reorder, retirement and cel append preserve other output slots and animation references", async () => {
  const initial = await lowerSceneTileSlots({ target, detail: 1, slots: rows }, [ground, pond, bank, last], crop);
  const reordered = await lowerSceneTileSlots({ target, detail: 1, slots: rows.slice().reverse() }, [last, bank, pond, ground], crop);
  ok(initial.ok);
  ok(reordered.ok);
  deepEqual(reordered.outputs, initial.outputs);
  equal(initial.references.get("tiles/grass.tkrtle"), "Village\\pond.tst1");
  const retired: SceneTileSlot[] = rows.map((row) => row.slot === 2 || row.slot === 6 ? { slot: row.slot, reserved: true } : row);
  const second = await lowerSceneTileSlots({ target, detail: 1, slots: retired }, [ground, pond], crop);
  const appended = await lowerSceneTileSlots({ target, detail: 1, slots: [...retired, { slot: 7, tile: pond.path, cel: "third" }] }, [ground, { ...pond, tile: animated(true) }], crop);
  ok(second.ok);
  ok(appended.ok);
  const read = readTileset(second.outputs[0]!.bytes);
  ok(read.ok);
  deepEqual(read.value.tiles.map((_, index) => {
    const expanded = expandTileToRgba(read.value, index);
    ok(expanded.ok);
    return [...expanded.value.subarray(0, 4)];
  }), [
    [16, 80, 90, 255], [0, 1, 2, 0], [17, 80, 90, 255], [18, 80, 90, 255], [0, 1, 2, 0], [0, 1, 2, 0],
  ]);
  deepEqual(appended.outputs[1], initial.outputs[1]);
  const tan = readTileAnimation(new BinaryReader(initial.outputs[1]!.bytes));
  ok(tan.ok);
  equal(tan.value.speed, 5);
  deepEqual(tan.value.frames, ["Village\\pond.tst3", "Village\\pond.tst4", "Village\\pond.tst3"]);
});

void test("invalid allocation or timing refuses before looking up source pixels", async () => {
  const invalid = await lowerSceneTileSlots({ target, detail: 1, slots: [{ slot: 1, tile: ground.path }, { slot: 1, reserved: true }] }, [ground], () => { throw new Error("read before validation"); });
  ok(!invalid.ok);
  ok(invalid.problems.some((problem) => problem.path === "outputBinding.slots[1].slot"));
  const late: NativeTile = { ...head, visual: { transparent, cels, timeline: { phaseMs: 1, frames: [{ cel: "first", ms: 25 }, { cel: "second", ms: 25 }] } } };
  const inexact = await lowerSceneTileSlots({ target, detail: 1, slots: [{ slot: 1, tile: pond.path, cel: "first" }, { slot: 2, tile: pond.path, cel: "second" }] }, [{ ...pond, tile: late }], () => { throw new Error("read before validation"); });
  ok(!inexact.ok);
  deepEqual(inexact.problems.map(({ path }) => path), ["Tiles/Water.tkrtle.visual.timeline.phaseMs", "Tiles/Water.tkrtle.visual.timeline.frames"]);
});
