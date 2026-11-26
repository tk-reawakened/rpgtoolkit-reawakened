import { placeScenePackAsset, placementPointForCell, type BoardPicture, type Scene, type SceneTerrainCellTile, type TerrainScenePack, type TerrainSceneTileset } from "@tk-reawakened/editor-model";
import { useEffect, useRef, useState } from "preact/hooks";
import { ScenePackPlacementEditor } from "./scene-pack-placement.tsx";
import type { TerrainSceneAssetSource } from "./terrain-assets.ts";
import { useDocumentSnapshot } from "./use-document.ts";
type SceneTerrainRegion = NonNullable<Scene["terrainRegions"]>[number];

export interface TerrainSceneViewProps {
  readonly scene: Scene;
  /** The tilesets, terrains and packs, re-read by the host after a recipe changes; the view keeps its selection on a no-op. */
  readonly assets: TerrainSceneAssetSource;
  /** Ask the host to re-read its tilesets; the panel reports what it shows, so a stale recipe is never presented as current. */
  readonly onRefreshAssets?: () => void;
  /** Open a native owner document by its canonical inventory path; the picker never invents a path. */
  readonly onOpenAsset?: (path: string) => void;
  readonly onChange: (scene: Scene) => void;
  readonly onSave?: () => void;
  readonly onPreview?: () => Promise<BoardPicture>;
  readonly onRun?: () => void;
  readonly disabled?: boolean;
}

type Point = readonly [number, number];
type Tool = "select" | "paint" | "reshape" | "tile" | "empty" | "clear" | "pack";

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

export function TerrainSceneView({ scene, assets, onRefreshAssets, onOpenAsset, onChange, onSave, onPreview, onRun, disabled = false }: TerrainSceneViewProps) {
  const { tilesets, assetTiles, packs } = useDocumentSnapshot(assets);
  const compatiblePacks = packs.filter((entry) => entry.external !== true && entry.projection === scene.projection);
  const [floorId, setFloorId] = useState(scene.floors[0]?.id ?? "");
  const [tilesetPath, setTilesetPath] = useState(tilesets[0]?.path ?? "");
  const [terrainId, setTerrainId] = useState(tilesets[0]?.terrains[0]?.id ?? "");
  const [selectedId, setSelectedId] = useState("");
  const [tileIndex, setTileIndex] = useState(0);
  const [tool, setTool] = useState<Tool>("select");
  const [anchor, setAnchor] = useState<Point | null>(null);
  const [placementId, setPlacementId] = useState("");
  const [packPath, setPackPath] = useState(compatiblePacks[0]?.path ?? "");
  const [packAsset, setPackAsset] = useState(compatiblePacks[0]?.assets[0]?.id ?? "");
  const [preview, setPreview] = useState<{ readonly scene: Scene; readonly picture: BoardPicture } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const previewCanvas = useRef<HTMLCanvasElement>(null);
  const picture = preview?.scene === scene ? preview.picture : null;
  useEffect(() => {
    if (picture?.ok !== true || typeof ImageData === "undefined") return;
    const context = previewCanvas.current?.getContext("2d");
    context?.putImageData(new ImageData(new Uint8ClampedArray(picture.rgba), picture.width, picture.height), 0, 0);
  }, [picture]);
  const showPreview = async (): Promise<void> => {
    if (previewBusy || onPreview === undefined) return;
    setPreviewBusy(true);
    setPreview(null);
    try { setPreview({ scene, picture: await onPreview() }); }
    catch (error) { setPreview({ scene, picture: { ok: false, message: `Could not preview the scene: ${String(error)}` } }); }
    finally { setPreviewBusy(false); }
  };
  const regions = scene.terrainRegions ?? [];
  const overrides = scene.tileOverrides ?? [];
  const floor = scene.floors.find((entry) => entry.id === floorId) ?? scene.floors[0];
  const activeFloor = floor?.id ?? "";
  const selected = regions.find((region) => region.id === selectedId && region.floor === activeFloor);
  const tileset = tilesets.find((entry) => entry.path === tilesetPath);
  useEffect(() => {
    if (tilesets.length === 0) return;
    const chosen = tilesets.find((entry) => entry.path === tilesetPath) ?? tilesets[0]!;
    if (chosen.path !== tilesetPath) { setTilesetPath(chosen.path); setSelectedId(""); setAnchor(null); }
    if (!chosen.terrains.some((entry) => entry.id === terrainId)) { setTerrainId(chosen.terrains[0]?.id ?? ""); setAnchor(null); }
    if (tileIndex >= assetTiles.length) setTileIndex(0);
  }, [tilesets, assetTiles, tilesetPath, terrainId, tileIndex]);
  const terrain = tileset?.terrains.find((entry) => entry.id === terrainId);
  const rotated = scene.projection === "iso-rotated";
  const width = rotated ? scene.size.width + scene.size.height : scene.size.width;
  const height = rotated ? width : scene.size.height;

  const chooseTool = (next: Tool): void => { setTool(next); setAnchor(null); };
  const choosePack = (path: string): void => {
    setPackPath(path);
    setPackAsset(packs.find((entry) => entry.path === path)?.assets[0]?.id ?? "");
  };
  const clickCell = (x: number, y: number): void => {
    if (disabled || floor === undefined) return;
    if (tool === "pack") {
      const chosen = compatiblePacks.find((entry) => entry.path === packPath);
      const asset = chosen?.assets.find((entry) => entry.id === packAsset);
      if (asset === undefined) return;
      const at = placementPointForCell(scene, asset.anchor.snap, x, y);
      if (at === null) return;
      const placed = placeScenePackAsset(scene, { pack: packPath, asset: asset.id, floor: activeFloor }, at.x, at.y);
      onChange(placed.scene);
      setPlacementId(placed.instanceId);
      return;
    }
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

  return <section class="tkr-board-properties" aria-label="Scene terrain editor" data-tkr-editor="Scene terrain">
    <h2>Scene terrain</h2>
    <div>
      {onSave !== undefined && <button type="button" data-editor-save="true" disabled={disabled} onClick={onSave}>Save</button>}
      {onPreview !== undefined && <button type="button" aria-disabled={previewBusy} onClick={() => void showPreview()}>Preview build</button>}
      {onRun !== undefined && <button type="button" disabled={disabled} onClick={onRun}>Play</button>}
    </div>
    {previewBusy && <progress aria-label="Building scene preview" />}
    {picture?.ok === true && <figure class="tkr-scene-preview">
      <canvas ref={previewCanvas} width={picture.width} height={picture.height} role="img" aria-label="Compiled scene preview">The preview canvas is unavailable.</canvas>
      <figcaption>Current scene as it would appear in the game. Previewing does not save it.</figcaption>
      {picture.warnings.length > 0 && <ul aria-label="Preview warnings">{picture.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
    </figure>}
    <div role="status">{picture?.ok === false ? picture.message : ""}</div>
    <label>Floor <select value={activeFloor} disabled={disabled} onChange={(event) => { setFloorId(event.currentTarget.value); setSelectedId(""); setAnchor(null); }}>
      {scene.floors.map((entry) => <option key={entry.id} value={entry.id}>{entry.id}</option>)}
    </select></label>
    <label>Tileset <select value={tilesetPath} disabled={disabled} onChange={(event) => {
      const path = event.currentTarget.value;
      setTilesetPath(path);
      setTerrainId(tilesets.find((entry) => entry.path === path)?.terrains[0]?.id ?? "");
      setAnchor(null);
    }}>
      <option value="">Choose tileset</option>{tilesets.map((entry) => <option key={entry.path} value={entry.path}>{entry.path}</option>)}
    </select></label>
    <label>Terrain <select value={terrainId} disabled={disabled || tileset === undefined} onChange={(event) => { setTerrainId(event.currentTarget.value); setAnchor(null); }}>
      <option value="">Choose terrain</option>{tileset?.terrains.map((entry) => <option key={entry.id} value={entry.id}>{entry.label ?? entry.id}</option>)}
    </select></label>
    {terrain !== undefined ? <section aria-label="Native terrain roles" data-tkr-terrain-roles={terrain.id}>
      <h3>Native terrain rules: {terrain.label}</h3>
      {onRefreshAssets === undefined ? null : <button type="button" data-tkr-terrain-rules-refresh="true" disabled={disabled} onClick={onRefreshAssets}>Refresh terrain rules</button>}
      <p>{terrain.roles.neighbours === "blob-8" ? "Eight neighbours" : "Four neighbours"}, {terrain.roles.coverage} coverage: {terrain.roles.situations - terrain.roles.missing.length} of {terrain.roles.situations} neighbourhoods have a tile. Native roles are these rules; they are not the legacy 52-slot order, and this terrain is not an original-format set.</p>
      <ul aria-label="Terrain rules">{terrain.roles.rules.map((rule) => <li key={rule.id}>
        {rule.id}: {rule.when} uses {rule.tiles.join(", ")} ({rule.situations} {rule.situations === 1 ? "neighbourhood" : "neighbourhoods"})
      </li>)}</ul>
      {terrain.roles.problems.length > 0
        ? <ul role="alert" aria-label="Terrain rule problems">{terrain.roles.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
        : null}
      {terrain.roles.missing.length > 0
        ? <p role="note">Missing role assignments: {terrain.roles.missing.join("; ")}. Painting these neighbourhoods is reported when the scene is built; nothing is replaced.</p>
        : <p>Every neighbourhood has a tile.</p>}
    </section> : null}
    <label>Region <select value={selected?.id ?? ""} disabled={disabled} onChange={(event) => { setSelectedId(event.currentTarget.value); setAnchor(null); }}>
      <option value="">No region selected</option>{regions.filter((region) => region.floor === activeFloor).map((region) => <option key={region.id} value={region.id}>{region.label ?? region.id}</option>)}
    </select></label>
    <label>Manual tile <select value={String(tileIndex)} disabled={disabled || assetTiles.length === 0} onChange={(event) => setTileIndex(Number(event.currentTarget.value))}>
      {assetTiles.map((entry, index) => <option key={index} value={String(index)}>{entry.label}</option>)}
    </select></label>
    {onOpenAsset !== undefined && <button type="button" data-tkr-tile-open="true" disabled={disabled || assetTiles[tileIndex] === undefined || !("tile" in (assetTiles[tileIndex]?.tile ?? {}))} onClick={() => {
      const tile = assetTiles[tileIndex]?.tile;
      if (tile !== undefined && "tile" in tile) onOpenAsset(tile.tile);
    }}>Open tile source</button>}
    <fieldset disabled={disabled}><legend>Terrain tool</legend>
      {([
        ["select", "Select region"], ["paint", "Paint rectangle"], ["reshape", "Reshape region"],
        ["tile", "Manual tile"], ["empty", "Manual empty"], ["clear", "Clear override"], ["pack", "Place pack asset"],
      ] as const).map(([value, label]) => <label key={value}><input type="radio" name="scene-terrain-tool" data-tkr-tool={value} checked={tool === value} onChange={() => chooseTool(value)} />{label}</label>)}
    </fieldset>
    <ScenePackPlacementEditor
      scene={scene}
      packs={packs}
      activeFloor={activeFloor}
      placementId={placementId}
      onSelect={setPlacementId}
      packPath={packPath}
      assetId={packAsset}
      onPackChange={choosePack}
      onAssetChange={setPackAsset}
      onChange={onChange}
      disabled={disabled}
      {...(onOpenAsset === undefined ? {} : { onOpenAsset })}
    />
    <p role="status">{anchor === null
      ? (tool === "paint" || tool === "reshape" ? "Choose the first corner of a rectangle." : tool === "pack" ? "Choose a cell to place the chosen pack asset." : "Choose a cell.")
      : `First corner: ${anchor[0]}, ${anchor[1]}. Choose the opposite corner.`}</p>
    <div class="tkr-terrain-grid">
      <table role="grid" aria-label="Scene cells"><tbody>
        {Array.from({ length: height }, (_, y) => <tr key={y}>
          {Array.from({ length: width }, (_, x) => {
            const owner = [...regions].reverse().find((region) => region.floor === activeFloor && contains(region, x, y));
            const override = overrides.find((entry) => entry.floor === activeFloor && entry.cell[0] === x && entry.cell[1] === y);
            const description = override !== undefined ? ("tile" in override.tile ? `tile ${override.tile.tile}` : "legacy" in override.tile ? `tile ${override.tile.legacy}` : "empty override") : owner === undefined ? "base" : `terrain ${owner.terrain.terrain}, region ${owner.id}`;
            return <td key={x} role="gridcell"><button type="button" disabled={disabled} aria-label={`Cell ${x}, ${y}: ${description}`} aria-pressed={selected !== undefined && owner?.id === selected.id} title={description} onClick={() => clickCell(x, y)}>{override !== undefined ? ("tile" in override.tile || "legacy" in override.tile ? "T" : "∅") : owner === undefined ? "·" : owner.id === selected?.id ? "■" : "▧"}</button></td>;
          })}
        </tr>)}
      </tbody></table>
    </div>
  </section>;
}
