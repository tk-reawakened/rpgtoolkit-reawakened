import type { expect as playwrightExpect, Frame, Page } from "@playwright/test";
import { encodeScenePng } from "@tk-reawakened/editor-model";

export const GEOMETRY_SCENE = "Boards/garden-geometry.tkrscn";
export const GEOMETRY_TILE = "Tiles/rail-geometry.tkrtle";
export const GEOMETRY_PACK = "Packs/garden-geometry.tkrpack";
export const geometryTileText = `contract: tile
version: 1.0.0-pre.1
# Keep this authored tile comment when the fence is edited.
name: Rail geometry
projection: 2d
role: wall
visual: {transparent: {mode: alpha}, sample: {file: Bitmap/rail-geometry.png, rect: [0, 0, 32, 32]}}
`;
export const geometryPackText = `contract: asset-pack
version: 1.0.0-pre.1
# Keep this authored pack comment when the arch is edited.
name: Garden geometry
projection: 2d
grid: {tileWidth: 32, tileHeight: 32}
sources:
  - {id: atlas, file: Bitmap/rail-geometry.png}
assets:
  - id: arch
    name: Garden arch
    kind: prop
    anchor: {x: 16, y: 32, snap: bottom-center}
    visuals: [{source: atlas, rect: [0, 0, 32, 32]}]
  - id: second
    name: Another prop
    kind: prop
    anchor: {x: 16, y: 32, snap: bottom-center}
    visuals: [{source: atlas, rect: [0, 0, 32, 32]}]
`;

export function geometryProofFiles(): readonly { readonly path: string; readonly bytes: Uint8Array }[] {
  const text = (path: string, value: string) => ({ path, bytes: new TextEncoder().encode(value) });
  const rgba = new Uint8Array(32 * 32 * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    const x = (offset / 4) % 32;
    const y = Math.floor(offset / (32 * 4));
    if (x < 3 || x > 28 || (y >= 5 && y <= 12)) rgba.set([27, 159, 55, 255], offset);
  }
  return [
    text(GEOMETRY_SCENE, `contract: scene
version: 1.0.0-pre.2
# Authored source survives placement edits.
projection: 2d
pixelCoordinates: true
size: {width: 4, height: 4}
floors: [{id: yard}]
start: {x: 48, y: 88, floor: yard}
`),
    text(GEOMETRY_TILE, geometryTileText),
    text(GEOMETRY_PACK, geometryPackText),
    text("Tiles/garden-geometry.tkrtst", `contract: tileset
version: 1.0.0-pre.2
name: Garden geometry
expects: {projection: 2d, cellSize: [32, 32]}
tiles: [{tile: ${GEOMETRY_TILE}}]
outputBinding: {target: Tiles/garden-geometry.tst, detail: 1, slots: [{slot: 1, tile: ${GEOMETRY_TILE}}]}
`),
    { path: "Bitmap/rail-geometry.png", bytes: encodeScenePng({ w: 32, h: 32, rgba }) },
  ];
}

type Expect = typeof playwrightExpect;

export async function drawNativeShape(surface: Page | Frame, expect: Expect, kind: "solid" | "under", label: string, points: readonly (readonly [number, number])[]): Promise<void> {
  const editor = surface.getByRole("region", { name: "Collision and walk-behind" });
  const addShape = editor.getByRole("button", { name: kind === "solid" ? "New solid barrier" : "New walk-behind region", exact: true });
  await addShape.click();
  await editor.getByLabel("Shape label", { exact: true }).fill("Discard this draft");
  await editor.getByRole("button", { name: "Cancel draft", exact: true }).click();
  await expect(editor.getByLabel("Shape label", { exact: true })).toHaveCount(0);
  await addShape.click();
  await editor.getByLabel("Shape label", { exact: true }).fill(label);
  if (kind === "under") await editor.getByLabel("Intersects the frame", { exact: true }).check();
  for (const [index, [x, y]] of points.entries()) {
    const xLabel = editor.getByLabel(`Point ${index + 1} X`, { exact: true });
    if (await xLabel.count() === 0) await editor.getByRole("button", { name: "Add point", exact: true }).click();
    await xLabel.fill(String(x));
    await editor.getByLabel(`Point ${index + 1} Y`, { exact: true }).fill(String(y));
  }
  await editor.getByRole("button", { name: "Apply shape", exact: true }).click();
  await expect(editor.locator(`[data-tkr-shape="${kind}:0"]`)).toContainText(label);
}
