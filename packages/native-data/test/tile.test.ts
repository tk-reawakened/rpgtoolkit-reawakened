import { deepEqual, equal, ok } from "node:assert/strict";
import test from "node:test";
import { checkTile, readTile, TILE_CONTRACT, TILE_VERSION, writeTile, type NativeTile } from "../src/tile.ts";

const SAMPLE = `contract: tile
version: 1.0.0-pre.1
name: Gate
projection: 2d
role: wall
visual:
  transparent: {mode: alpha}
  cels:
    - id: closed
      sample: {file: art/gate.png, rect: [0, 0, 32, 32]}
    - id: open
      sample: {source: art/gate.tkrart, frame: frame-1, region: gate}
  timeline:
    frames: [{cel: closed, ms: 100}, {cel: open, ms: 200}]
  `;

void test("a standalone tile reads and keeps its source", () => {
  const result = readTile(SAMPLE);
  ok(result.ok);
  equal(result.source, SAMPLE);
  equal(result.tile.contract, TILE_CONTRACT);
  equal(result.tile.version, TILE_VERSION);
  deepEqual(writeTile(result.tile, result.source), { ok: true, text: SAMPLE });
  const written = writeTile(result.tile);
  ok(written.ok);
  const reread = readTile(written.text);
  ok(reread.ok);
  deepEqual(reread.tile.visual, result.tile.visual);
});

void test("tile validation rejects duplicate IDs, bad references and unsafe or inexact numbers", () => {
  for (const [from, to] of [
    ["id: open", "id: closed"],
    ["cel: open", "cel: missing"],
    ["art/gate.png", "../gate.png"],
    ["ms: 100", "ms: 9007199254740992"],
  ] as const) {
    const result = readTile(SAMPLE.replace(from, to));
    ok(!result.ok, `${from} -> ${to} must be refused`);
  }
});

void test("tile timeline phase is within the exact safe cycle", () => {
  const withPhase = SAMPLE.replace("frames: [{cel: closed, ms: 100}, {cel: open, ms: 200}]", "phaseMs: 300\n    frames: [{cel: closed, ms: 100}, {cel: open, ms: 200}]");
  ok(!readTile(withPhase).ok);
  const model = readTile(SAMPLE);
  ok(model.ok);
  ok(model.tile.visual.timeline !== undefined);
  const cycle: NativeTile = {
    ...model.tile,
    visual: {
      ...model.tile.visual,
      timeline: { ...model.tile.visual.timeline, frames: [{ cel: "closed", ms: Number.MAX_SAFE_INTEGER }, { cel: "open", ms: 1 }] },
    },
  };
  ok(checkTile(cycle).some((problem) => problem.path.includes("frames")));
});

void test("an unresolvable YAML value is reported rather than thrown", () => {
  const invalid = readTile(SAMPLE.replace("name: Gate", "name: *missing"));
  ok(!invalid.ok);
  ok(invalid.problems.some(({ message }) => /alias/i.test(message)));
});
