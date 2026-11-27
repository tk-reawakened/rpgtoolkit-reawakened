import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { BinaryReader, readBoard } from "@tk-reawakened/core";
import type { AssetPack, Scene } from "@tk-reawakened/native-data";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { buildScene } from "../src/scene-build.ts";
import { createSceneBuildOwnership, createSceneBuildOwnershipStorage } from "../src/scene-build-ownership.ts";
import { encodeScenePng } from "../src/scene-png.ts";
import { copyScenePackPlacement, findTerrainScenePack, removeScenePackPlacement } from "../src/scene-pack-placements.ts";
import { compileSceneProject, loadTerrainSceneProjectInventory } from "../src/terrain-scene-project.ts";

const pack: AssetPack = {
  contract: "asset-pack", version: "1.0.0-pre.1", name: "Props", projection: "2d", grid: { tileWidth: 32, tileHeight: 32 },
  sources: [{ id: "sheet", file: "Bitmap/prop.png", transparent: { mode: "alpha" } }],
  assets: [{
    id: "lantern", name: "Lantern", kind: "prop", anchor: { x: 0, y: 0, snap: "bottom-center" },
    visuals: [{ source: "sheet", rect: [0, 0, 2, 2] }],
    under: [{ label: "glow", closed: true, attributes: 1, points: [[-1, -1], [1, -1], [1, 1], [-1, 1]] }],
  }],
};
const source = encodeScenePng({ w: 2, h: 2, rgba: new Uint8Array([0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255]) });
const scene: Scene = {
  contract: "scene", version: "1.0.0-pre.2", projection: "2d", size: { width: 1, height: 1 },
  floors: [{ id: "ground", tiles: [[1, 1]] }],
  tilePalette: [{}, { legacy: "grass.tst1" }],
  placedPacks: [{ instanceId: "lantern-1", pack: "Packs/props.tkrpack", asset: "lantern", floor: "ground", x: 20, y: 40 }],
};
const inputs = {
  scenePath: "Boards/pond.tkrscn",
  resolvePack: async (path: string) => (path === "Packs/props.tkrpack" ? pack : null),
  readSource: async (path: string) => (path === "Bitmap/prop.png" ? source : null),
  terrain: {
    tilesets: new Map(), loadTile: async () => null,
    resolveCrop: async () => null,
  },
};

void test("a copy builds its own ordered board records and a removed placement's records leave the board", async () => {
  const copied = copyScenePackPlacement(scene, "lantern-1");
  ok(copied !== null);
  const first = await buildScene({ ...inputs, scene: copied.scene });
  ok(first.ok, first.ok ? "" : first.problems.map((problem) => problem.message).join("; "));
  equal(first.board.images.length, 2);
  equal(first.board.vectors.length, 2);
  deepEqual(first.board.images.map((image) => image.left), [20, 20]);
  const pngs = first.outputs.filter((output) => output.path.startsWith("Bitmap/.tkr-generated/"));
  equal(pngs.length, 2);
  ok(pngs.some((output) => output.path.endsWith("/lantern-1-0.png")));
  ok(pngs.some((output) => output.path.endsWith("/lantern-2-0.png")));

  const second = await buildScene({ ...inputs, scene: removeScenePackPlacement(copied.scene, "lantern-1") });
  ok(second.ok, second.ok ? "" : second.problems.map((problem) => problem.message).join("; "));
  equal(second.board.images.length, 1);
  equal(second.board.vectors.length, 1);
  ok(!second.outputs.some((output) => output.path.endsWith("/lantern-1-0.png")));
  ok(second.outputs.some((output) => output.path.endsWith("/lantern-2-0.png")));
  const board = second.outputs.find((output) => output.path === "Boards/pond.brd");
  ok(board !== undefined);
  const decoded = readBoard(new BinaryReader(board.bytes, board.path));
  ok(decoded.ok);
  equal(decoded.value.images.length, 1);
  equal(decoded.value.vectors.length, 1);
});

void test("the stale generated PNG stays owned, while the rebuilt board and unrelated art are left as they were", async () => {
  const host = createMemoryPlatformServices({ files: { "Bitmap/other.png": Uint8Array.of(1, 2, 3) } });
  const history: string[] = [];
  const ownership = createSceneBuildOwnership({
    fs: host.fs,
    storage: createSceneBuildOwnershipStorage(host.fs),
    projectId: "memory-project",
    history: { async keep(path, bytes) { history.push(`${path}:${bytes.byteLength}`); return { outcome: "held" as const }; } },
  });
  const copied = copyScenePackPlacement(scene, "lantern-1");
  ok(copied !== null);
  const first = await buildScene({ ...inputs, scene: copied.scene });
  ok(first.ok);
  const firstCheck = await ownership.check(inputs.scenePath, first.outputs);
  ok(firstCheck.ok);
  const firstWrite = await ownership.write(firstCheck.check, first.outputs);
  ok(firstWrite.ok, firstWrite.ok ? "" : firstWrite.message);
  const withheld = first.outputs.find((output) => output.path.endsWith("/lantern-1-0.png"));
  ok(withheld !== undefined);
  const withheldBytes = host.bytesOf(withheld.path);
  ok(withheldBytes !== undefined);

  const second = await buildScene({ ...inputs, scene: removeScenePackPlacement(copied.scene, "lantern-1") });
  ok(second.ok);
  ok(!second.outputs.some((output) => output.path === withheld.path));
  const secondCheck = await ownership.check(inputs.scenePath, second.outputs);
  ok(secondCheck.ok);
  equal(secondCheck.check.conflicts.length, 0);
  const secondWrite = await ownership.write(secondCheck.check, second.outputs);
  ok(secondWrite.ok, secondWrite.ok ? "" : secondWrite.message);

  deepEqual(host.bytesOf(withheld.path), withheldBytes);
  deepEqual(host.bytesOf("Bitmap/other.png"), Uint8Array.of(1, 2, 3));
  ok(history.some((entry) => entry.startsWith("Boards/pond.brd:")));
  ok(!history.some((entry) => entry.includes("lantern-1")));
  const board = host.bytesOf("Boards/pond.brd");
  ok(board);
  const decoded = readBoard(new BinaryReader(board, "Boards/pond.brd"));
  ok(decoded.ok);
  equal(decoded.value.images.length, 1);
  equal(decoded.value.vectors.length, 1);
});

void test("an unrelated malformed pack is reported by the picker but only breaks a build that uses it", async () => {
  const broken = "Packs/unpublished.tkrpack";
  const encode = (value: string) => new TextEncoder().encode(value);
  const intact = { ...scene, floors: [{ id: "ground" }], tilePalette: [{}] };
  const { fs } = createMemoryPlatformServices({ files: {
    [inputs.scenePath]: encode(JSON.stringify(intact)),
    "Packs/props.tkrpack": encode(JSON.stringify(pack)),
    [broken]: encode("contract: asset-pack\nversion: oops\n"),
    "Bitmap/prop.png": source,
  } });

  const inventory = await loadTerrainSceneProjectInventory(fs, inputs.scenePath);
  ok(inventory.ok);
  deepEqual(inventory.packs.map(({ path }) => path), ["Packs/props.tkrpack"]);
  ok(inventory.packProblems.some(({ path }) => path === broken));
  const built = await compileSceneProject({ fs, scenePath: inputs.scenePath });
  ok(built.ok, built.ok ? "" : built.problems.map(({ message }) => message).join("; "));
  equal(built.built.board.images.length, 1);
  ok(!built.inputs.has(broken));
  const placed = { ...scene.placedPacks![0], pack: broken };
  const refused = await compileSceneProject({ fs, scenePath: inputs.scenePath, sceneText: JSON.stringify({ ...intact, placedPacks: [placed] }) });
  ok(!refused.ok);
  ok(refused.problems.some(({ message }) => message.includes(broken)));
});

void test("the picker resolves cross-game placement refs by identity and offers only own-game packs for new placements", async () => {
  const encode = (value: string) => new TextEncoder().encode(value);
  const scenePath = "Game/First/Boards/pond.tkrscn";
  const local = "Game/First/Packs/local.tkrpack";
  const remote = "Game/Second/Packs/Remote.tkrpack";
  const unrelated = "Game/Third/Packs/Unrelated.tkrpack";
  const intact = { ...scene, floors: [{ id: "ground" }], tilePalette: [{}], placedPacks: undefined };
  const draft = {
    ...intact,
    placedPacks: [{ instanceId: "remote-1", pack: "game/second/packs/REMOTE.tkrpack", asset: "lantern", floor: "ground", x: 4, y: 8 }],
  };
  const files = {
    [scenePath]: encode(JSON.stringify(intact)),
    [local]: encode(JSON.stringify({ ...pack, name: "Local" })),
    [remote]: encode(JSON.stringify(pack)),
    [unrelated]: encode(JSON.stringify({ ...pack, name: "Unrelated" })),
  };

  const savedOnly = await loadTerrainSceneProjectInventory(createMemoryPlatformServices({ files }).fs, scenePath);
  ok(savedOnly.ok);
  deepEqual(savedOnly.packs.map(({ path }) => path), [local], "another game's pack is not a new authoring choice");

  const withDraft = await loadTerrainSceneProjectInventory(createMemoryPlatformServices({ files }).fs, scenePath, JSON.stringify(draft));
  ok(withDraft.ok);
  deepEqual(withDraft.packs.map(({ path, external }) => [path, external === true]), [[local, false], [remote, true]]);
  equal(findTerrainScenePack(withDraft.packs, "GAME/SECOND/PACKS/remote.tkrpack")?.path, remote, "the opener receives the canonical inventory path");

  const brokenFiles = { ...files, [remote]: encode("contract: asset-pack\nversion: oops\n") };
  const broken = await loadTerrainSceneProjectInventory(createMemoryPlatformServices({ files: brokenFiles }).fs, scenePath, JSON.stringify(draft));
  ok(broken.ok);
  deepEqual(broken.packs.map(({ path }) => path), [local]);
  ok(broken.packProblems.some(({ path }) => path === remote), "a referenced broken pack is catalogued without failing the picker");
});
void test("a pack's image bytes change its scene inventory revision at the same path", async () => {
  const encode = (value: string) => new TextEncoder().encode(value);
  const sceneText = JSON.stringify(scene);
  const files = {
    [inputs.scenePath]: encode(sceneText),
    "Packs/props.tkrpack": encode(JSON.stringify(pack)),
    "Bitmap/prop.png": source,
  };
  const first = await loadTerrainSceneProjectInventory(createMemoryPlatformServices({ files }).fs, inputs.scenePath);
  ok(first.ok);
  const base = first.packs[0]?.revision;
  ok(base !== undefined);
  const changedSource = encodeScenePng({ w: 2, h: 2, rgba: new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]) });
  const second = await loadTerrainSceneProjectInventory(createMemoryPlatformServices({ files: { ...files, "Bitmap/prop.png": changedSource } }).fs, inputs.scenePath);
  ok(second.ok);
  ok(second.packs[0]!.revision !== base, "same-path pack artwork bytes invalidate the inventory");
});
