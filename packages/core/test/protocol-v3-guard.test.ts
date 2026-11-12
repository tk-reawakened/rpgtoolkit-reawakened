import { test } from "node:test";
import { equal, match } from "node:assert/strict";
import { rasterize, rasterizePresentation, type DrawList } from "../src/index.ts";

const geometry = {
  content: { width: 1, height: 1 },
  game: { x: 0, y: 0, width: 1, height: 1 },
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
};

test("CPU replay refuses unversioned and unsupported draw lists before painting", () => {
  const frame = { tick: 0, width: 1, height: 1, commands: [{ kind: "fill", rgb: { r: 255, g: 0, b: 0 } }], marginCommands: [] };
  for (const invalid of [frame, { ...frame, protocolVersion: 2 }, { ...frame, protocolVersion: 4 }]) {
    const list = invalid as unknown as DrawList;
    const raster = rasterize(list, new Map());
    match(raster.error ?? "", /unsupported draw-list protocol version/);
    equal(raster.rgba.length, 0);
    const presentation = rasterizePresentation(list, geometry, new Map());
    match(presentation.error ?? "", /unsupported draw-list protocol version/);
    equal(presentation.rgba.every((value) => value === 0), true);
  }
});
