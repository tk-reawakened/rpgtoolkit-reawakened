// The native scene view shows each terrain's own rule coverage (story 8): which neighbourhoods have a tile, which do not,
// and why the matcher would refuse a recipe, labelled as native rules rather than the legacy 52-slot order.
import { after, before, test } from "node:test";
import { equal, match, ok } from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { inspectTerrainRoles, type Scene, type TerrainScenePack, type TerrainSceneTileset } from "@tk-reawakened/editor-model";
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

async function show(tilesets: readonly TerrainSceneTileset[], assets?: MutableTerrainSceneAssets, extra: Record<string, unknown> = {}): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.append(el);
  const source = assets ?? createTerrainSceneAssets({ tilesets, assetTiles: [], packs: [] });
  await act(() => {
    mountTerrainScene(el, {
      document: { getSnapshot: () => ({ scene }), subscribe: () => () => undefined },
      assets: source.source,
      onRefreshAssets: () => undefined,
      onChange: () => undefined,
      ...extra,
    } as never);
  });
  return el;
}

const entry = (coverage: "complete" | "partial", rules: Parameters<typeof inspectTerrainRoles>[0]["rules"], revision = JSON.stringify([coverage, rules])): TerrainSceneTileset => ({
  path: "Tiles/Pond.tkrtst",
  revision,
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
  const renamed: TerrainSceneTileset = { path: "Tiles/Pond.tkrtst", revision: "renamed", terrains: [{ id: "river", label: "River", roles: inspectTerrainRoles({ neighbours: "cardinal-4", coverage: "complete", rules: [{ id: "any", when: {}, use: { tile: "Tiles/water.tkrtle" } }] }) }] };
  await act(async () => { assets.set({ tilesets: [renamed], assetTiles: [], packs: [] }); await new Promise<void>((resolve) => setImmediate(resolve)); });
  match(el.textContent ?? "", /Native terrain rules: River/);
});

test("a preview stops being shown as current when its recipes change, and a slow build of older inputs is discarded", async () => {
  const shore = entry("partial", [{ id: "east", when: { e: "same" }, use: { tile: "Tiles/water.tkrtle" } }]);
  const assets = createTerrainSceneAssets({ tilesets: [shore], assetTiles: [], packs: [] });
  let release: ((picture: unknown) => void) | undefined;
  const el = await show([shore], assets, { onPreview: () => new Promise((resolve) => { release = resolve; }) });
  await act(async () => { el.querySelector<HTMLButtonElement>("button")!.click(); await new Promise<void>((r) => setImmediate(r)); });
  equal(el.querySelector("canvas[aria-label='Compiled scene preview']"), null, "nothing is shown while the build runs");
  await act(async () => {
    release?.({ ok: false, message: "No tile rule matches ground at (1, 0)." });
    await new Promise<void>((r) => setImmediate(r));
  });
  match(el.textContent ?? "", /No tile rule matches ground at \(1, 0\)/);
  // The recipe changes: the error belongs to the old rules and must not stay beside the new ones.
  await act(async () => {
    assets.set({ tilesets: [entry("complete", [{ id: "any", when: {}, use: { tile: "Tiles/water.tkrtle" } }])], assetTiles: [], packs: [] });
    await new Promise<void>((r) => setImmediate(r));
  });
  ok(!(el.textContent ?? "").includes("No tile rule matches ground"), "the old build's message is gone");
  match(el.textContent ?? "", /16 of 16 neighbourhoods have a tile/);
});

test("the manual tile is kept by its reference when a refresh reorders the list", async () => {
  const shore = entry("partial", [{ id: "east", when: { e: "same" }, use: { tile: "Tiles/water.tkrtle" } }]);
  const water = { label: "Tiles/water.tkrtle", tile: { tile: "Tiles/water.tkrtle" } } as const;
  const bank = { label: "Tiles/bank.tkrtle", tile: { tile: "Tiles/bank.tkrtle" } } as const;
  const assets = createTerrainSceneAssets({ tilesets: [shore], assetTiles: [water, bank], packs: [] });
  let last: Scene | null = null;
  const el = await show([shore], assets, { onChange: (next: Scene) => { last = next; } });
  const select = (): HTMLSelectElement => el.querySelector<HTMLSelectElement>("select[data-tkr-manual-tile]")!;
  await act(() => { const control = select(); control.value = "1"; control.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(() => { el.querySelector<HTMLInputElement>('[data-tkr-tool="tile"]')!.click(); });
  const place = async (x: number, y: number): Promise<string> => {
    await act(() => { el.querySelector<HTMLButtonElement>(`button[aria-label^="Cell ${x}, ${y}:"]`)!.click(); });
    const tile = last?.tileOverrides?.[0]?.tile;
    return tile !== undefined && "tile" in tile && tile.tile !== undefined ? tile.tile : "";
  };
  equal(await place(0, 0), "Tiles/bank.tkrtle", "the picked tile is what a placement writes");
  // The next read lists the same tiles in another order: the chosen reference must not follow the new positions.
  await act(async () => { assets.set({ tilesets: [shore], assetTiles: [bank, water], packs: [] }); await new Promise<void>((r) => setImmediate(r)); });
  last = null;
  equal(await place(1, 0), "Tiles/bank.tkrtle", "still the same tile after the reorder");
});

test("a failed re-read is reported and no older rules are presented as current", async () => {
  const shore = entry("partial", [{ id: "east", when: { e: "same" }, use: { tile: "Tiles/water.tkrtle" } }]);
  const assets = createTerrainSceneAssets({ tilesets: [shore], assetTiles: [], packs: [] });
  const el = await show([shore], assets);
  await act(async () => {
    assets.set({ tilesets: [], assetTiles: [], packs: [], problems: ["Tiles/Pond.tkrtst: rules[0] must name a palette member"] });
    await new Promise<void>((r) => setImmediate(r));
  });
  const alert = el.querySelector('[aria-label="Terrain rules unavailable"]');
  ok(alert !== null);
  match(alert?.textContent ?? "", /could not be read, so none are shown as current.*rules\[0\] must name a palette member/);
  equal(el.querySelector('[data-tkr-terrain-roles]'), null, "no stale role panel is left behind");
});

test("a recipe change that leaves the roles the same still hides the preview built from the old one", async () => {
  const rules = [{ id: "any", when: {}, use: { tile: "Tiles/water.tkrtle" } }] as const;
  const before = entry("complete", rules, "seed 0");
  const assets = createTerrainSceneAssets({ tilesets: [before], assetTiles: [], packs: [] });
  const el = await show([before], assets, { onPreview: async () => ({ ok: false, message: "Built with seed 0." }) });
  await act(async () => { el.querySelector<HTMLButtonElement>("button")!.click(); await new Promise<void>((r) => setImmediate(r)); });
  match(el.textContent ?? "", /Built with seed 0\./);
  // Same rules, same coverage, same roles - only a seed (or outside policy, or a variant weight) differs.
  await act(async () => { assets.set({ tilesets: [entry("complete", rules, "seed 7")], assetTiles: [], packs: [] }); await new Promise<void>((r) => setImmediate(r)); });
  ok(!(el.textContent ?? "").includes("Built with seed 0."), "the build of the old seed is not shown as current");
});
test("asset recovery keeps refresh available and restores manual tile selection", async () => {
  const assets = createTerrainSceneAssets({ tilesets: [], assetTiles: [], packs: [], problems: ["Tiles/Pond.tkrtst: invalid recipe"] });
  let refreshes = 0;
  const recorded: { scene: Scene | null } = { scene: null };
  const el = await show([], assets, { onRefreshAssets: () => { refreshes += 1; }, onChange: (next: Scene) => { recorded.scene = next; } });
  const refresh = el.querySelector<HTMLButtonElement>("[data-tkr-terrain-rules-refresh]")!;
  ok(refresh !== null, "retry is reachable when no terrain inventory loaded");
  const alert = el.querySelector('[aria-label="Terrain rules unavailable"]');
  ok(alert !== null);
  match(alert.textContent ?? "", /invalid recipe/);
  const manual = el.querySelector<HTMLSelectElement>("[data-tkr-manual-tile]")!;
  equal(manual.disabled, true);
  await act(() => { refresh.click(); });
  equal(refreshes, 1);

  const water = { label: "Tiles/water.tkrtle", tile: { tile: "Tiles/water.tkrtle" } } as const;
  await act(async () => { assets.set({ tilesets: [], assetTiles: [water], packs: [] }); await new Promise<void>((resolve) => setImmediate(resolve)); });
  equal(manual.disabled, false, "the recovered first tile becomes selectable");
  await act(() => { el.querySelector<HTMLInputElement>('[data-tkr-tool="tile"]')!.click(); });
  await act(() => { el.querySelector<HTMLButtonElement>('button[aria-label^="Cell 0, 0:"]')!.click(); });
  const override = recorded.scene?.tileOverrides?.[0];
  ok(override !== undefined && "tile" in override.tile);
  equal(override.tile.tile, water.tile.tile);
});

test("a changed pack source revision expires the scene preview", async () => {
  const pack: TerrainScenePack = { path: "Packs/props.tkrpack", name: "Props", projection: "2d", revision: "source-v1", assets: [] };
  const assets = createTerrainSceneAssets({ tilesets: [], assetTiles: [], packs: [pack] });
  const el = await show([], assets, { onPreview: async () => ({ ok: false, message: "Preview from old pack art." }) });
  await act(async () => { el.querySelector<HTMLButtonElement>('button[aria-disabled]')!.click(); await new Promise<void>((resolve) => setImmediate(resolve)); });
  match(el.textContent ?? "", /Preview from old pack art/);
  await act(async () => { assets.set({ tilesets: [], assetTiles: [], packs: [{ ...pack, revision: "source-v2" }] }); await new Promise<void>((resolve) => setImmediate(resolve)); });
  ok(!(el.textContent ?? "").includes("Preview from old pack art"), "the previous preview no longer matches current pack bytes");
});
