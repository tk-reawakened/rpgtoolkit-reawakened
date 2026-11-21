import { documentId, type Scene } from "@tk-reawakened/native-data";
import { compileTerrainMatcher, type TerrainMatcher, type TerrainRecipe } from "./terrain-matcher.ts";

const DX = [0, 1, 0, -1, -1, 1, 1, -1] as const;
const DY = [-1, 0, 1, 0, -1, -1, 1, 1] as const;

type TerrainReference = { readonly tileset: string; readonly terrain: string };
type CellTile = { readonly tile: string; readonly legacy?: never }
  | { readonly tile?: never; readonly legacy: string }
  | { readonly tile?: never; readonly legacy?: never };
type ResolvedCell = { readonly tile: CellTile; readonly path: string };
export type TerrainScene = Pick<Scene, "projection" | "size" | "floors"> & {
  readonly terrainRegions?: readonly {
    readonly floor: string;
    readonly terrain: TerrainReference;
    readonly coverage: { readonly shape: "tile-grid"; readonly spans: readonly (readonly [number, number, number])[] };
  }[];
  readonly tileOverrides?: readonly { readonly floor: string; readonly cell: readonly [number, number]; readonly tile: CellTile }[];
};

type ResolvedRecipe = TerrainRecipe & { readonly outside?: "same" | "other" };
type ActiveTerrain = { readonly outsideIsSame: boolean; readonly matcher: TerrainMatcher };
type Owner = { readonly terrain: ActiveTerrain; readonly path: string };
type Floor = { readonly owners: Map<number, Owner>; readonly cells: Map<number, ResolvedCell> };
type Problem = { readonly code: string; readonly path: string; readonly message: string };
type TerrainResolution =
  | { readonly ok: true; readonly floors: ReadonlyMap<string, ReadonlyMap<number, ResolvedCell>>; readonly notes: readonly Problem[] }
  | { readonly ok: false; readonly problems: readonly Problem[] };

/** Resolve a validated scene's terrain as row-major cell replacements, leaving its base and coverage untouched. */
export function resolveSceneTerrain(
  scene: TerrainScene,
  resolveRecipe: (reference: TerrainReference) => ResolvedRecipe | null,
): TerrainResolution {
  // docs/spec/formats/native-scene.md#resolving-painted-terrain
  const rotated = scene.projection === "iso-rotated";
  const width = rotated ? scene.size.width + scene.size.height : scene.size.width;
  const height = rotated ? width : scene.size.height;
  const floors = new Map<string, Floor>();
  const terrains = new Map<string, ActiveTerrain | null>();
  const problems: Problem[] = [];
  const notes: Problem[] = [];
  const floorAt = (id: string): Floor => {
    let floor = floors.get(id);
    if (floor === undefined) {
      floor = { owners: new Map(), cells: new Map() };
      floors.set(id, floor);
    }
    return floor;
  };

  for (const [index, region] of (scene.terrainRegions ?? []).entries()) {
    const key = `${documentId(region.terrain.tileset).replace(/[A-Z]/g, (letter) => letter.toLowerCase())}\0${region.terrain.terrain}`;
    let terrain = terrains.get(key);
    if (terrain === undefined) {
      const recipe = resolveRecipe(region.terrain);
      const path = `terrainRegions[${index}].terrain`;
      if (recipe === null) {
        problems.push({ code: "terrain-reference-unavailable", path, message: "No matching terrain recipe was found." });
        terrain = null;
      } else {
        const matcher = compileTerrainMatcher(recipe);
        if (!matcher.ok) {
          for (const problem of matcher.problems) {
            const message = "mask" in problem ? `Rules ${problem.rules.join(" and ")} both match mask ${problem.mask}.`
              : "count" in problem ? `${problem.count} neighbourhood patterns have no rule.`
              : problem.code === "terrain-rule-unsatisfiable" ? `Rule ${problem.rule} cannot match any neighbourhood.`
              : `Rule ${problem.rule} must have positive integer weights whose total fits in an unsigned 32-bit integer.`;
            problems.push({ code: problem.code, path, message });
          }
          terrain = null;
        } else {
          if (matcher.uncovered > 0) notes.push({ code: "terrain-pattern-uncovered", path, message: `${matcher.uncovered} neighbourhood patterns have no rule.` });
          terrain = { outsideIsSame: recipe.outside === "same", matcher };
        }
      }
      terrains.set(key, terrain);
    }
    if (terrain === null || region.coverage.spans.length === 0) continue;
    const { owners } = floorAt(region.floor);
    const owner = { terrain, path: `terrainRegions[${index}]` };
    for (const [x, y, length] of region.coverage.spans) {
      const start = y * width + x;
      const end = start + length;
      for (let cell = start; cell < end; cell += 1) owners.set(cell, owner);
    }
  }
  if (problems.length > 0) return { ok: false, problems };
  for (const [index, override] of (scene.tileOverrides ?? []).entries()) {
    const [x, y] = override.cell;
    floorAt(override.floor).cells.set(y * width + x, { tile: override.tile, path: `tileOverrides[${index}]` });
  }
  for (const [id, { owners, cells }] of floors) {
    for (const [cell, owner] of owners) {
      if (cells.has(cell)) continue;
      const x = cell % width;
      const y = Math.floor(cell / width);
      let mask = 0;
      for (let i = 0; i < 8; i += 1) {
        const nx = x + DX[i]!;
        const ny = y + DY[i]!;
        const same = nx < 0 || ny < 0 || nx >= width || ny >= height
          ? owner.terrain.outsideIsSame
          : owners.get(ny * width + nx)?.terrain === owner.terrain;
        if (same) mask |= 1 << i;
      }
      const tile = owner.terrain.matcher.choose(mask, id, x, y);
      if (tile === null) problems.push({ code: "terrain-pattern-uncovered", path: owner.path, message: `No tile rule matches ${id} at (${x}, ${y}).` });
      else cells.set(cell, { tile: { tile }, path: owner.path });
    }
  }
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, floors: new Map(Array.from(floors, ([id, { cells }]) => [id, cells])), notes };
}
