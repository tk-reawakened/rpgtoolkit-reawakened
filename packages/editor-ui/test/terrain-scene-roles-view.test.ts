// The native scene view shows each terrain's own rule coverage (story 8): which neighbourhoods have a tile, which do not,
// and why the matcher would refuse a recipe, labelled as native rules rather than the legacy 52-slot order.
import { after, before, test } from "node:test";
import { equal, match, ok } from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { inspectTerrainRoles, type Scene, type TerrainSceneTileset } from "@tk-reawakened/editor-model";
import { createTerrainSceneAssets, type MutableTerrainSceneAssets } from "../src/terrain-assets.ts";

let mountTerrainScene: typeof import("@tk-reawakened/editor-ui").mountTerrainScene;
let act: (callback: () => void | Promise<void>) => Promise<void> | void;

before(async () => {
  GlobalRegistrator.register();
  ({ act } = await import("preact/test-utils"));
  ({ mountTerrainScene } = await import("@tk-reawakened/editor-ui"));
});
after(() => GlobalRegistrator.unregister());

const scene = { contract: "scene", version: "1.0.0-pre.2", name: "Pond", projection: "2d", size: { width: 4, height: 3 }, floors: [{ id: "ground" }] } as unknown as Scene;

async function show(tilesets: readonly TerrainSceneTileset[], assets?: MutableTerrainSceneAssets): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.append(el);
  const source = assets ?? createTerrainSceneAssets({ tilesets, assetTiles: [], packs: [] });
  await act(() => {
    mountTerrainScene(el, {
      document: { getSnapshot: () => ({ scene }), subscribe: () => () => undefined },
      assets: source.source,
      onRefreshAssets: () => undefined,
      onChange: () => undefined,
    } as never);
  });
  return el;
}

const entry = (coverage: "complete" | "partial", rules: Parameters<typeof inspectTerrainRoles>[0]["rules"]): TerrainSceneTileset => ({
  path: "Tiles/Pond.tkrtst",
  terrains: [{ id: "water", label: "Water", roles: inspectTerrainRoles({ neighbours: "cardinal-4", coverage, rules }) }],
});

test("a partial terrain lists its rules and names the neighbourhoods that have no tile, without calling it a legacy set", async () => {
  const el = await show([entry("partial", [{ id: "east", when: { e: "same" }, use: { tile: "Tiles/water.tkrtle" } }])]);
  const roles = el.querySelector('[data-tkr-terrain-roles="water"]');
  ok(roles !== null, "the first tileset's first terrain is shown");
  const text = roles.textContent ?? "";
  match(text, /Native terrain rules: Water/);
  match(text, /Four neighbours, partial coverage: 8 of 16 neighbourhoods have a tile/);
  match(text, /east: e same uses Tiles\/water\.tkrtle \(8 neighbourhoods\)/);
  match(text, /Missing role assignments: isolated; n; s; n\+s; w; n\+w; s\+w; n\+s\+w/);
  match(text, /not the legacy 52-slot order/);
  equal(roles.querySelector('[role="alert"]'), null, "a partial recipe with gaps is not refused");
});

test("a complete terrain with a gap shows why the matcher refuses it", async () => {
  const el = await show([entry("complete", [{ id: "east", when: { e: "same" }, use: { tile: "Tiles/water.tkrtle" } }])]);
  const problems = el.querySelector('[data-tkr-terrain-roles="water"] [role="alert"]');
  ok(problems !== null);
  match(problems.textContent ?? "", /8 neighbourhood patterns have no rule, and the recipe says it is complete/);
});

test("a terrain with every neighbourhood covered says so", async () => {
  const el = await show([entry("complete", [{ id: "any", when: {}, use: { tile: "Tiles/water.tkrtle" } }])]);
  const text = el.querySelector('[data-tkr-terrain-roles="water"]')?.textContent ?? "";
  match(text, /16 of 16 neighbourhoods have a tile/);
  match(text, /Every neighbourhood has a tile/);
});

test("a refreshed recipe updates the rules in place, and an identical read is a no-op that keeps the chosen terrain and tool", async () => {
  const partial = entry("partial", [{ id: "east", when: { e: "same" }, use: { tile: "Tiles/water.tkrtle" } }]);
  const assets = createTerrainSceneAssets({ tilesets: [partial], assetTiles: [], packs: [] });
  let notified = 0;
  assets.source.subscribe(() => { notified += 1; });
  const el = await show([partial], assets);
  // The author's choice: the terrain stays selected and the paint tool stays checked across a refresh.
  const paint = el.querySelector<HTMLInputElement>('[data-tkr-tool="paint"]')!;
  await act(() => { paint.click(); });
  equal(paint.checked, true);

  equal(assets.set({ tilesets: [partial], assetTiles: [], packs: [] }), false, "the same recipes are a no-op");
  equal(notified, 0, "and notify nobody, so nothing is re-rendered or reset");

  const complete = entry("complete", [{ id: "any", when: {}, use: { tile: "Tiles/water.tkrtle" } }]);
  await act(async () => {
    equal(assets.set({ tilesets: [complete], assetTiles: [], packs: [] }), true);
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
  equal(notified, 1);
  const text = el.querySelector('[data-tkr-terrain-roles="water"]')?.textContent ?? "";
  match(text, /16 of 16 neighbourhoods have a tile/, "the panel shows the recipe as it is now");
  match(text, /Every neighbourhood has a tile/);
  equal(el.querySelector<HTMLInputElement>('[data-tkr-tool="paint"]')!.checked, true, "the open view kept its tool");
  equal(el.querySelector<HTMLSelectElement>("select")?.value ?? "", "ground", "and its floor");
});

test("a terrain that a refresh removes falls back to the first one instead of keeping a stale selection", async () => {
  const shore = entry("partial", [{ id: "east", when: { e: "same" }, use: { tile: "Tiles/water.tkrtle" } }]);
  const assets = createTerrainSceneAssets({ tilesets: [shore], assetTiles: [], packs: [] });
  const el = await show([shore], assets);
  const renamed: TerrainSceneTileset = { path: "Tiles/Pond.tkrtst", terrains: [{ id: "river", label: "River", roles: inspectTerrainRoles({ neighbours: "cardinal-4", coverage: "complete", rules: [{ id: "any", when: {}, use: { tile: "Tiles/water.tkrtle" } }] }) }] };
  await act(async () => { assets.set({ tilesets: [renamed], assetTiles: [], packs: [] }); await new Promise<void>((resolve) => setImmediate(resolve)); });
  match(el.textContent ?? "", /Native terrain rules: River/);
});
