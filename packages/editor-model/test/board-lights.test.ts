// Lights and shading on the board document (docs/spec/formats/board.md#lights): each edit is one command and one undo step.
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { BinaryReader, readBoard, type Board } from "@tk-reawakened/core";
import { addLight, convertLightToShading, createDocumentIdentity, moveLightNode, newLight, openBoardDocument, previewLightConversion, removeLight, setLightColour, setLightType } from "../src/index.ts";
import { exampleBoard } from "./fixtures.ts";

const PATH = "Boards/village.brd";
const identity = createDocumentIdentity("memory-project", PATH);

async function open() {
  const host = createMemoryPlatformServices({ files: { [PATH]: exampleBoard(4) } });
  const opened = await openBoardDocument(host.fs, identity);
  ok(opened.ok);
  return { host, doc: opened.document };
}

const modelOf = (doc: { serialize(): Uint8Array }): Board => {
  const read = readBoard(new BinaryReader(doc.serialize()));
  ok(read.ok);
  return read.value;
};

test("a board shows its lights and a new spotlight is a circle around its centre", async () => {
  const { doc } = await open();
  const board = doc.getSnapshot();
  equal(Array.isArray(board.lights), true);
  const light = newLight(0, { x: 200, y: 100 }, { r: 90, g: 80, b: 70 });
  deepEqual(light.nodes, [{ x: 200, y: 0 }, { x: 200, y: 100 }, { x: 40, y: 100 }]);
  deepEqual(light.colours, [{ r: 0, g: 0, b: 0 }, { r: 90, g: 80, b: 70 }]);
  deepEqual(newLight(0, { x: 50, y: 20 }, { r: 0, g: 0, b: 0 }).nodes, [{ x: 50, y: 0 }, { x: 50, y: 20 }, { x: 0, y: 20 }]);
});

test("adding, moving and recolouring a light is one undoable edit each, and it saves and reopens", async () => {
  const { host, doc } = await open();
  const base = doc.getSnapshot();
  const light = newLight(1, { x: 0, y: 0 }, { r: 60, g: 0, b: 0 });
  ok(doc.apply({ type: "set-board-fields", fields: { lights: addLight(base, light) } }).ok);
  const index = doc.getSnapshot().lights.length - 1;
  const moved = moveLightNode(doc.getSnapshot(), index, 1, { x: 96, y: 64 });
  ok(moved.ok);
  ok(doc.apply({ type: "set-board-fields", fields: { lights: moved.lights } }).ok);
  const tinted = setLightColour(doc.getSnapshot(), index, 0, { r: -300, g: 12, b: 0 });
  ok(tinted.ok);
  ok(doc.apply({ type: "set-board-fields", fields: { lights: tinted.lights } }).ok);
  deepEqual(doc.getSnapshot().lights[index]?.nodes[1], { x: 96, y: 64 });
  deepEqual(doc.getSnapshot().lights[index]?.colours[0], { r: -255, g: 12, b: 0 }, "channels clamp as they are typed");
  ok((await doc.save()).ok);
  const reopened = await openBoardDocument(host.fs, identity);
  ok(reopened.ok);
  deepEqual(modelOf(reopened.document).lights[index]?.nodes[1], { x: 96, y: 64 });
});

test("a light with the wrong node count or an out-of-range channel is refused and the document is unchanged", async () => {
  const { doc } = await open();
  const before = doc.getSnapshot().lights;
  const spotlight = newLight(0, { x: 64, y: 64 }, { r: 10, g: 10, b: 10 });
  equal(doc.apply({ type: "set-board-fields", fields: { lights: [{ ...spotlight, nodes: spotlight.nodes.slice(1) }] } }).ok, false);
  equal(doc.apply({ type: "set-board-fields", fields: { lights: [{ ...spotlight, colours: [{ r: 0, g: 0, b: 0 }, { r: 256, g: 0, b: 0 }] }] } }).ok, false);
  deepEqual(doc.getSnapshot().lights, before);
  equal(moveLightNode(doc.getSnapshot(), 0, 7, { x: 1, y: 1 }).ok, false);
  equal(moveLightNode(doc.getSnapshot(), 0, 0, { x: 1.5, y: 1 }).ok, false);
});

test("plain and clipped gradients keep their nodes; a spotlight starts afresh", async () => {
  const { doc } = await open();
  const gradient = newLight(1, { x: 32, y: 32 }, { r: 50, g: 50, b: 50 });
  const board = { ...doc.getSnapshot(), lights: [gradient] };
  const clipped = setLightType(board, 0, 2);
  ok(clipped.ok);
  deepEqual(clipped.lights[0]?.nodes, gradient.nodes);
  const spot = setLightType(board, 0, 0);
  ok(spot.ok);
  equal(spot.lights[0]?.nodes.length, 3);
});

test("Convert adds the light into the one shading layer, removes it, and one undo brings the light back", async () => {
  const { host, doc } = await open();
  const base = doc.getSnapshot();
  const light = newLight(1, { x: 0, y: 0 }, { r: 100, g: 100, b: 100 });
  const withLight = { ...base, lights: [light] };
  const converted = convertLightToShading(withLight, 0);
  ok(converted.ok);
  equal(converted.lights.length, 0);
  ok(converted.shadeLayers.length >= 1);
  ok(doc.apply({ type: "set-board-fields", fields: { lights: converted.lights, shadeLayers: converted.shadeLayers } }).ok);
  equal(doc.getSnapshot().lights.length, 0);
  ok((await doc.save()).ok);
  const reopened = await openBoardDocument(host.fs, identity);
  ok(reopened.ok);
  equal(modelOf(reopened.document).lights.length, 0);
  equal(removeLight(withLight, 3).ok, false);
});

test("Convert refuses a board with more than one shading layer", async () => {
  const { doc } = await open();
  const base = doc.getSnapshot();
  const two = { ...base, lights: [newLight(1, { x: 0, y: 0 }, { r: 1, g: 1, b: 1 })], shadeLayers: [{ castLayer: 1, records: [] }, { castLayer: 2, records: [] }] };
  equal(convertLightToShading(two, 0).ok, false);
});

test("painting shade cells is one edit; out-of-range channels and cells are refused; unchanged is refused", async () => {
  const { host, doc } = await open();
  ok(doc.apply({ type: "set-shade-cells", cells: [{ x: 1, y: 1, r: 64, g: 64, b: 64 }, { x: 2, y: 1, r: -10, g: 0, b: 255 }] }).ok);
  const model = modelOf(doc);
  equal(model.shadeLayers.length, 1);
  equal(doc.apply({ type: "set-shade-cells", cells: [{ x: 1, y: 1, r: 64, g: 64, b: 64 }] }).ok, false, "unchanged");
  equal(doc.apply({ type: "set-shade-cells", cells: [{ x: 1, y: 1, r: 256, g: 0, b: 0 }] }).ok, false);
  equal(doc.apply({ type: "set-shade-cells", cells: [{ x: 9, y: 9, r: 1, g: 1, b: 1 }] }).ok, false);
  ok((await doc.save()).ok);
  const reopened = await openBoardDocument(host.fs, identity);
  ok(reopened.ok);
  equal(modelOf(reopened.document).shadeLayers.length, 1);
});

test("previewLightConversion reports the cells a light changes without changing anything, and Apply's arrays match convert", async () => {
  const { doc } = await open();
  const base = doc.getSnapshot();
  const light = newLight(1, { x: 0, y: 0 }, { r: 100, g: 50, b: 0 });
  const withLight = { ...base, lights: [light], shadeLayers: [] };
  const before = JSON.stringify(withLight);
  const preview = previewLightConversion(withLight, 0);
  ok(preview.ok);
  equal(JSON.stringify(withLight), before, "the board is not touched by looking");
  equal(preview.width * preview.height * 3, preview.added.length);
  ok(preview.cellsChanged > 0);
  ok(preview.bounds !== null && preview.bounds.column0 >= 1 && preview.bounds.column1 <= preview.width && preview.bounds.row1 <= preview.height);
  equal(preview.createsShadingLayer, true);
  equal(preview.lights.length, 0);
  equal(preview.light, light, "the reviewed light is the stored one");
  const converted = convertLightToShading(withLight, 0);
  ok(converted.ok);
  deepEqual(converted.shadeLayers, preview.shadeLayers);
  deepEqual(converted.lights, preview.lights);
});

test("previewLightConversion counts cells past the draw range, a light that adds nothing, and refuses a stored overflow", async () => {
  const { doc } = await open();
  const base = doc.getSnapshot();
  const hot = newLight(1, { x: 0, y: 0 }, { r: 200, g: 0, b: 0 });
  const dims = previewLightConversion({ ...base, lights: [hot] }, 0);
  ok(dims.ok);
  const cells = dims.width * dims.height;
  const everywhere = (r: number) => [{ castLayer: base.layers, records: [{ runCount: cells, r, g: 0, b: 0 }] }];
  const past = previewLightConversion({ ...base, lights: [hot], shadeLayers: everywhere(250) }, 0);
  ok(past.ok);
  equal(past.cellsPastDrawRange, dims.cellsChanged, "every cell the light adds red to now totals more than 255");
  ok(past.cellsPastDrawRange > 0);
  equal(past.createsShadingLayer, false);
  const dark = newLight(1, { x: 0, y: 0 }, { r: 0, g: 0, b: 0 });
  const nothing = previewLightConversion({ ...base, lights: [dark] }, 0);
  ok(nothing.ok);
  equal(nothing.cellsChanged, 0);
  equal(nothing.bounds, null);
  // A stored channel at the i16 limit cannot take any more: the whole conversion is refused, naming a cell, and nothing changes.
  const full = { ...base, lights: [hot], shadeLayers: everywhere(32_767) };
  const before = JSON.stringify(full);
  const refused = previewLightConversion(full, 0);
  equal(refused.ok, false);
  ok(!refused.ok && /column \d+, row \d+ red/.test(refused.message) && /Nothing was changed/.test(refused.message));
  equal(JSON.stringify(full), before);
  equal(previewLightConversion(base, 4).ok, false);
});
