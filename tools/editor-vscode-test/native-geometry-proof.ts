import { deepEqual, equal, match, ok } from "node:assert/strict";
import { BinaryReader, readBoard } from "@tk-reawakened/core";
import { readScene } from "@tk-reawakened/editor-model";
import type { expect as playwrightExpect, Frame, Page } from "@playwright/test";
import { drawNativeShape, GEOMETRY_PACK, GEOMETRY_SCENE, GEOMETRY_TILE, geometryPackText, geometryTileText } from "./native-geometry-fixture.ts";

export { GEOMETRY_SCENE, geometryProofFiles } from "./native-geometry-fixture.ts";

type Surface = Frame | Page;
type Expect = typeof playwrightExpect;
const boardPath = "Boards/garden-geometry.brd";
const terrain = (surface: Surface) => surface.getByRole("region", { name: "Scene terrain editor" });

export async function proveNativeGeometry(expect: Expect, host: {
  readonly read: (path: string) => Promise<Uint8Array>;
  readonly openScene: () => Promise<Surface>;
  readonly openedOwner: (path: string) => Promise<Surface>;
  readonly closeOwner: (path: string) => Promise<void>;
  readonly verifyOwnerHistory: (surface: Surface) => Promise<Surface>;
  readonly save: (surface: Surface, pane: "geometry" | "scene") => Promise<void>;
}): Promise<void> {
  const text = async (path: string) => new TextDecoder().decode(await host.read(path));
  const originalScene = await text(GEOMETRY_SCENE);
  let scene = await host.openScene();
  const chooseFence = async () => {
    const editable = terrain(scene);
    await editable.getByRole("combobox", { name: "Manual tile", exact: true }).selectOption({ label: GEOMETRY_TILE });
    return editable;
  };
  await (await chooseFence()).getByRole("button", { name: "Open tile source", exact: true }).click();
  let tile = await host.openedOwner(GEOMETRY_TILE);
  await drawNativeShape(tile, expect, "solid", "Fence rails", [[16, 5], [16, 12]]);
  equal(await text(GEOMETRY_TILE), geometryTileText, "applying the shape does not implicitly save the owner");
  tile = await host.verifyOwnerHistory(tile);
  await host.save(tile, "geometry");
  await expect.poll(() => text(GEOMETRY_TILE)).toContain("Fence rails");
  match(await text(GEOMETRY_TILE), /# Keep this authored tile comment/);
  equal(await text(GEOMETRY_SCENE), originalScene, "the fence was edited in its source, not this scene");
  await host.closeOwner(GEOMETRY_TILE);
  scene = await host.openScene();
  await (await chooseFence()).getByRole("button", { name: "Open tile source", exact: true }).click();
  tile = await host.openedOwner(GEOMETRY_TILE);
  await expect(tile.locator('[data-tkr-shape="solid:0"]')).toContainText("Fence rails (open, 2 points)");

  scene = await host.openScene();
  const palette = terrain(scene);
  await palette.getByLabel("Pack source", { exact: true }).selectOption(GEOMETRY_PACK);
  await palette.getByLabel("Pack asset", { exact: true }).selectOption("arch");
  await palette.getByRole("button", { name: "Open pack source", exact: true }).click();
  const pack = await host.openedOwner(GEOMETRY_PACK);
  await pack.getByRole("region", { name: "Collision and walk-behind", exact: true }).getByLabel("Pack asset", { exact: true }).selectOption("arch");
  await drawNativeShape(pack, expect, "under", "Lintel", [[-12, -27], [12, -27], [12, -20], [-12, -20]]);
  equal(await text(GEOMETRY_PACK), geometryPackText);
  await host.save(pack, "geometry");
  await expect.poll(() => text(GEOMETRY_PACK)).toContain("Lintel");
  match(await text(GEOMETRY_PACK), /# Keep this authored pack comment/);
  match(await text(GEOMETRY_PACK), /id: second\n    name: Another prop/);
  equal(await text(GEOMETRY_SCENE), originalScene);

  scene = await host.openScene();
  const editor = await chooseFence();
  await editor.getByRole("radio", { name: "Manual tile", exact: true }).check();
  const cell = editor.getByRole("button", { name: /^Cell 2, 1:/ });
  await cell.click();
  await expect(cell).toHaveAccessibleName(new RegExp(GEOMETRY_TILE));
  await editor.getByLabel("Pack source", { exact: true }).selectOption(GEOMETRY_PACK);
  await editor.getByLabel("Pack asset", { exact: true }).selectOption("arch");
  await editor.getByLabel("Placement X", { exact: true }).fill("48");
  await editor.getByLabel("Placement Y", { exact: true }).fill("88");
  await editor.getByRole("button", { name: "Place asset", exact: true }).click();
  const selection = editor.getByLabel("Pack placement", { exact: true });
  await expect(selection).not.toHaveValue("");
  const selectedId = await selection.inputValue();
  ok(selectedId);
  await editor.getByLabel("Placement X", { exact: true }).fill("56");
  await editor.getByRole("button", { name: "Apply placement", exact: true }).click();
  await editor.getByRole("button", { name: "Copy placement", exact: true }).click();
  await expect(selection.locator("option")).toHaveCount(3);
  await expect(selection).not.toHaveValue(selectedId);
  const copiedId = await selection.inputValue();
  ok(copiedId);
  await editor.getByLabel("Placement X", { exact: true }).fill("88");
  await editor.getByRole("button", { name: "Apply placement", exact: true }).click();
  await expect(editor.getByRole("button", { name: "Apply placement", exact: true })).toBeDisabled();
  await host.save(scene, "scene");
  const readOutput = async () => {
    try {
      const decoded = readBoard(new BinaryReader(await host.read(boardPath)));
      return decoded.ok ? decoded.value : null;
    } catch (error) {
      if (error instanceof Error && (error.name === "NotFoundError" || ("code" in error && error.code === "ENOENT"))) return null;
      throw error;
    }
  };
  await expect.poll(async () => (await readOutput())?.images.length).toBe(2);
  const saved = readScene(await text(GEOMETRY_SCENE));
  ok(saved.ok);
  const placements = saved.scene.placedPacks ?? [];
  deepEqual(placements.map(({ instanceId }) => instanceId), [selectedId, copiedId]);
  deepEqual(placements.map(({ pack: path, asset, floor }) => [path, asset, floor]), [[GEOMETRY_PACK, "arch", "yard"], [GEOMETRY_PACK, "arch", "yard"]]);
  deepEqual(placements.map(({ x, y }) => [x, y]), [[56, 88], [88, 88]]);
  const built = (await readOutput())!;
  deepEqual(built.images.map(({ left, top }) => [left, top]), placements.map(({ x, y }) => [x - 16, y - 32]));
  deepEqual(built.vectors.filter(({ type }) => type === 1).map(({ points }) => points), [[{ x: 80, y: 37 }, { x: 80, y: 44 }]]);
  deepEqual(built.vectors.filter(({ type }) => type === 2).map(({ points }) => points[0]), placements.map(({ x, y }) => ({ x: x - 12, y: y - 27 })));
  match(await text(GEOMETRY_SCENE), /# Authored source survives placement edits/);

  const savedSceneText = await text(GEOMETRY_SCENE);
  await editor.getByRole("button", { name: "Open placement source", exact: true }).click();
  const linkedPack = await host.openedOwner(GEOMETRY_PACK);
  await linkedPack.getByRole("region", { name: "Collision and walk-behind", exact: true }).getByLabel("Pack asset", { exact: true }).selectOption("arch");
  await linkedPack.locator('[data-tkr-shape="under:0"]').click();
  await linkedPack.getByLabel("Shape label", { exact: true }).fill("Revised lintel");
  await linkedPack.getByLabel("Point 1 Y", { exact: true }).fill("-25");
  await linkedPack.getByLabel("Point 2 Y", { exact: true }).fill("-25");
  await linkedPack.getByRole("button", { name: "Apply shape", exact: true }).click();
  await expect(linkedPack.locator('[data-tkr-shape="under:0"]')).toContainText("Revised lintel");
  await host.save(linkedPack, "geometry");
  await expect.poll(() => text(GEOMETRY_PACK)).toContain("Revised lintel");
  scene = await host.openScene();
  await host.save(scene, "scene");
  await expect.poll(async () => (await readOutput())?.vectors.filter(({ type }) => type === 2).map(({ points }) => points[0]))
    .toEqual(placements.map(({ x, y }) => ({ x: x - 12, y: y - 25 })));
  equal(await text(GEOMETRY_SCENE), savedSceneText, "a source-only change rebuilds both linked placements without rewriting the scene");

  const liveEditor = terrain(scene);
  const liveSelection = liveEditor.getByLabel("Pack placement", { exact: true });
  await liveSelection.selectOption(copiedId);
  await liveEditor.getByRole("button", { name: "Delete placement", exact: true }).click();
  await expect(liveSelection.locator(`option[value="${copiedId}"]`)).toHaveCount(0);
  await host.save(scene, "scene");
  await expect.poll(async () => (await readOutput())?.images.length).toBe(1);
  const afterDelete = readScene(await text(GEOMETRY_SCENE));
  ok(afterDelete.ok);
  deepEqual(afterDelete.scene.placedPacks, [placements[0]]);
  equal((await readOutput())!.vectors.filter(({ type }) => type === 2).length, 1);
}
