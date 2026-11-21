import type { Scene, SceneTerrainCellTile } from "@tk-reawakened/editor-model";
import { useState } from "preact/hooks";
type SceneTerrainRegion = NonNullable<Scene["terrainRegions"]>[number];

export interface TerrainSceneViewProps {
  readonly scene: Scene;
  readonly tilesets: readonly { readonly path: string; readonly terrains: readonly { readonly id: string; readonly label?: string }[] }[];
  readonly assetTiles: readonly { readonly label: string; readonly tile: SceneTerrainCellTile }[];
  readonly onChange: (scene: Scene) => void;
  readonly onSave?: () => void;
  readonly onRun?: () => void;
  readonly disabled?: boolean;
}

type Point = readonly [number, number];
type Tool = "select" | "paint" | "reshape" | "tile" | "empty" | "clear";

/** Native terrain coverage is stored as horizontal spans; the base floor runs remain untouched.
 * See docs/spec/formats/native-scene.md#resolving-painted-terrain. */
function rectangle(a: Point, b: Point): SceneTerrainRegion["coverage"] {
  const left = Math.min(a[0], b[0]);
  const right = Math.max(a[0], b[0]);
  const top = Math.min(a[1], b[1]);
  const bottom = Math.max(a[1], b[1]);
  const spans: [number, number, number][] = [];
  for (let y = top; y <= bottom; y += 1) spans.push([left, y, right - left + 1]);
  return { shape: "tile-grid", spans };
}

function contains(region: SceneTerrainRegion, x: number, y: number): boolean {
  return region.coverage.spans.some(([start, row, length]) => row === y && x >= start && x < start + length);
}

function newRegionId(regions: readonly SceneTerrainRegion[]): string {
  const used = new Set(regions.map((region) => region.id.toLowerCase()));
  let n = 1;
  while (used.has(`region-${n}`)) n += 1;
  return `region-${n}`;
}

export function TerrainSceneView({ scene, tilesets, assetTiles, onChange, onSave, onRun, disabled = false }: TerrainSceneViewProps) {
  const [floorId, setFloorId] = useState(scene.floors[0]?.id ?? "");
  const [tilesetPath, setTilesetPath] = useState(tilesets[0]?.path ?? "");
  const [terrainId, setTerrainId] = useState(tilesets[0]?.terrains[0]?.id ?? "");
  const [selectedId, setSelectedId] = useState("");
  const [tileIndex, setTileIndex] = useState(0);
  const [tool, setTool] = useState<Tool>("select");
  const [anchor, setAnchor] = useState<Point | null>(null);
  const regions = scene.terrainRegions ?? [];
  const overrides = scene.tileOverrides ?? [];
  const floor = scene.floors.find((entry) => entry.id === floorId) ?? scene.floors[0];
  const activeFloor = floor?.id ?? "";
  const selected = regions.find((region) => region.id === selectedId && region.floor === activeFloor);
  const tileset = tilesets.find((entry) => entry.path === tilesetPath);
  const terrain = tileset?.terrains.find((entry) => entry.id === terrainId);
  const rotated = scene.projection === "iso-rotated";
  const width = rotated ? scene.size.width + scene.size.height : scene.size.width;
  const height = rotated ? width : scene.size.height;

  const chooseTool = (next: Tool): void => { setTool(next); setAnchor(null); };
  const clickCell = (x: number, y: number): void => {
    if (disabled || floor === undefined) return;
    if (tool === "select") {
      const hit = [...regions].reverse().find((region) => region.floor === activeFloor && contains(region, x, y));
      setSelectedId(hit?.id ?? "");
      return;
    }
    if (tool === "tile" || tool === "empty" || tool === "clear") {
      const choice = assetTiles[tileIndex];
      if (tool === "tile" && choice === undefined) return;
      const existing = overrides.find((entry) => entry.floor === activeFloor && entry.cell[0] === x && entry.cell[1] === y);
      const rest = overrides.filter((entry) => entry.floor !== activeFloor || entry.cell[0] !== x || entry.cell[1] !== y);
      const tile = tool === "empty" ? {} : choice?.tile;
      onChange({ ...scene, tileOverrides: tool === "clear" || tile === undefined ? rest : [...rest, { ...existing, floor: activeFloor, cell: [x, y], tile }] });
      return;
    }
    if (tool === "paint" && terrain === undefined) return;
    if (tool === "reshape" && selected === undefined) return;
    if (anchor === null) { setAnchor([x, y]); return; }
    const coverage = rectangle(anchor, [x, y]);
    setAnchor(null);
    if (tool === "reshape" && selected !== undefined) {
      onChange({ ...scene, terrainRegions: regions.map((region) => region === selected ? { ...region, coverage } : region) });
    } else if (terrain !== undefined && tileset !== undefined) {
      const id = newRegionId(regions);
      const region: SceneTerrainRegion = { id, floor: activeFloor, terrain: { tileset: tileset.path, terrain: terrain.id }, coverage };
      onChange({ ...scene, terrainRegions: [...regions, region] });
      setSelectedId(id);
    }
  };

  return <section class="tkr-board-properties" aria-label="Scene terrain editor">
    <h2>Scene terrain</h2>
    <div>
      {onSave !== undefined && <button type="button" disabled={disabled} onClick={onSave}>Save</button>}
      {onRun !== undefined && <button type="button" disabled={disabled} onClick={onRun}>Play</button>}
    </div>
    <label>Floor <select value={activeFloor} disabled={disabled} onChange={(event) => { setFloorId(event.currentTarget.value); setSelectedId(""); setAnchor(null); }}>
      {scene.floors.map((entry) => <option key={entry.id} value={entry.id}>{entry.id}</option>)}
    </select></label>
    <label>Tileset <select value={tilesetPath} disabled={disabled} onChange={(event) => {
      const path = event.currentTarget.value;
      setTilesetPath(path);
      setTerrainId(tilesets.find((entry) => entry.path === path)?.terrains[0]?.id ?? "");
      setAnchor(null);
    }}><option value="">Choose tileset</option>{tilesets.map((entry) => <option key={entry.path} value={entry.path}>{entry.path}</option>)}</select></label>
    <label>Terrain <select value={terrainId} disabled={disabled || tileset === undefined} onChange={(event) => { setTerrainId(event.currentTarget.value); setAnchor(null); }}>
      <option value="">Choose terrain</option>{tileset?.terrains.map((entry) => <option key={entry.id} value={entry.id}>{entry.label ?? entry.id}</option>)}
    </select></label>
    <label>Region <select value={selected?.id ?? ""} disabled={disabled} onChange={(event) => { setSelectedId(event.currentTarget.value); setAnchor(null); }}>
      <option value="">No region selected</option>{regions.filter((region) => region.floor === activeFloor).map((region) => <option key={region.id} value={region.id}>{region.label ?? region.id}</option>)}
    </select></label>
    <label>Manual tile <select value={String(tileIndex)} disabled={disabled || assetTiles.length === 0} onChange={(event) => setTileIndex(Number(event.currentTarget.value))}>
      {assetTiles.map((entry, index) => <option key={index} value={String(index)}>{entry.label}</option>)}
    </select></label>
    <fieldset disabled={disabled}><legend>Terrain tool</legend>
      {([
        ["select", "Select region"], ["paint", "Paint rectangle"], ["reshape", "Reshape region"],
        ["tile", "Manual tile"], ["empty", "Manual empty"], ["clear", "Clear override"],
      ] as const).map(([value, label]) => <label key={value}><input type="radio" name="scene-terrain-tool" checked={tool === value} onChange={() => chooseTool(value)} />{label}</label>)}
    </fieldset>
    <p role="status">{anchor === null ? (tool === "paint" || tool === "reshape" ? "Choose the first corner of a rectangle." : "Choose a cell.") : `First corner: ${anchor[0]}, ${anchor[1]}. Choose the opposite corner.`}</p>
    <div style={{ overflow: "auto", maxHeight: "60vh" }}>
      <table role="grid" aria-label="Scene cells"><tbody>
        {Array.from({ length: height }, (_, y) => <tr key={y}>
          {Array.from({ length: width }, (_, x) => {
            const owner = [...regions].reverse().find((region) => region.floor === activeFloor && contains(region, x, y));
            const override = overrides.find((entry) => entry.floor === activeFloor && entry.cell[0] === x && entry.cell[1] === y);
            const description = override !== undefined ? ("tile" in override.tile ? `tile ${override.tile.tile}` : "legacy" in override.tile ? `tile ${override.tile.legacy}` : "empty override") : owner === undefined ? "base" : `terrain ${owner.terrain.terrain}, region ${owner.id}`;
            return <td key={x} role="gridcell"><button type="button" disabled={disabled} aria-label={`Cell ${x}, ${y}: ${description}`} aria-pressed={selected !== undefined && owner?.id === selected.id} title={description} onClick={() => clickCell(x, y)} style={{ minWidth: "2em", minHeight: "2em" }}>{override !== undefined ? ("tile" in override.tile || "legacy" in override.tile ? "T" : "∅") : owner === undefined ? "·" : owner.id === selected?.id ? "■" : "▧"}</button></td>;
          })}
        </tr>)}
      </tbody></table>
    </div>
  </section>;
}
