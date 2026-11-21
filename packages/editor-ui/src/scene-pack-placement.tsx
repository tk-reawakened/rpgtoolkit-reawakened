import { copyScenePackPlacement, findTerrainScenePack, moveScenePackPlacement, placeScenePackAsset, removeScenePackPlacement, scenePackPlacementMissing, type Scene, type TerrainScenePack } from "@tk-reawakened/editor-model";
import { useState } from "preact/hooks";

/**
 * The native asset picker's pack placements: choose a compatible pack and one of its local assets,
 * then place it, and select a placement to view its floor and anchor, move it, copy it under a fresh
 * instance ID, or remove it. A placement whose pack or asset is missing stays listed as a reference
 * and can still be moved or deleted; it is never silently dropped.
 */
export interface ScenePackPlacementEditorProps {
  readonly scene: Scene;
  readonly packs: readonly TerrainScenePack[];
  readonly activeFloor: string;
  readonly placementId: string;
  readonly onSelect: (instanceId: string) => void;
  readonly packPath: string;
  readonly assetId: string;
  readonly onPackChange: (path: string) => void;
  readonly onAssetChange: (asset: string) => void;
  readonly onChange: (scene: Scene) => void;
  readonly disabled?: boolean;
  readonly onOpenAsset?: (path: string) => void;
}

const wholeNumber = (text: string): number | null => {
  const value = Number(text);
  return text.trim() !== "" && Number.isInteger(value) ? value : null;
};

type PlacementFields = { readonly floor: string; readonly x: string; readonly y: string };

export function ScenePackPlacementEditor(props: ScenePackPlacementEditorProps) {
  const { scene, packs, activeFloor, placementId, onSelect, packPath, assetId, onPackChange, onAssetChange, onChange, disabled = false, onOpenAsset } = props;
  const placements = scene.placedPacks ?? [];
  const selected = placements.find((placement) => placement.instanceId === placementId);
  const chosenPack = packs.find((pack) => pack.path === packPath);
  const chosenAsset = chosenPack?.assets.find((asset) => asset.id === assetId);
  const selectedPack = selected === undefined ? null : findTerrainScenePack(packs, selected.pack);
  const missing = selected === undefined ? null : scenePackPlacementMissing(packs, selected);
  const authoringPacks = packs.filter((pack) => pack.external !== true);
  const source = { instanceId: selected?.instanceId ?? "", floor: selected?.floor ?? activeFloor, x: String(selected?.x ?? 0), y: String(selected?.y ?? 0) };
  const [draft, setDraft] = useState<{ readonly source: typeof source; readonly fields: PlacementFields } | null>(null);
  const [message, setMessage] = useState("");
  // Select/copy starts a new draft immediately. An effect after render could otherwise overwrite
  // the first keystroke while the new selection is already visible.
  const fields = draft !== null && draft.source.instanceId === source.instanceId && draft.source.floor === source.floor
    && draft.source.x === source.x && draft.source.y === source.y ? draft.fields : source;
  const { floor, x, y } = fields;
  const setField = (field: keyof PlacementFields, value: string) => setDraft({ source, fields: { ...fields, [field]: value } });

  const point = { x: wholeNumber(x), y: wholeNumber(y) };
  const floorKnown = scene.floors.some((entry) => entry.id === floor);
  const canPlace = !disabled && chosenPack !== undefined && chosenAsset !== undefined
    && chosenPack.projection === scene.projection && floorKnown && point.x !== null && point.y !== null;
  const changed = selected !== undefined && floorKnown && point.x !== null && point.y !== null
    && (selected.floor !== floor || selected.x !== point.x || selected.y !== point.y);
  const canMove = !disabled && changed;
  const description = (placement: (typeof placements)[number]): string => {
    const state = scenePackPlacementMissing(packs, placement);
    return `${placement.instanceId} — ${placement.pack}#${placement.asset}${state === "pack" ? " (missing pack)" : state === "asset" ? " (missing asset)" : ""}`;
  };

  return <section class="tkr-board-properties" aria-label="Pack placements" data-tkr-pack-placements="true">
    <h3>Pack placements</h3>
    <label>Pack source <select data-tkr-pack-source="true" aria-label="Pack source" value={packPath} disabled={disabled} onChange={(event) => onPackChange(event.currentTarget.value)}>
      <option value="">Choose pack</option>
      {authoringPacks.map((pack) => <option key={pack.path} value={pack.path} disabled={pack.projection !== scene.projection}>{pack.projection === scene.projection ? pack.path : `${pack.path} (${pack.projection} pack)`}</option>)}
    </select></label>
    <label>Pack asset <select data-tkr-pack-asset="true" aria-label="Pack asset" value={assetId} disabled={disabled || chosenPack === undefined} onChange={(event) => onAssetChange(event.currentTarget.value)}>
      <option value="">Choose asset</option>
      {(chosenPack?.assets ?? []).map((asset) => <option key={asset.id} value={asset.id}>{asset.name === asset.id ? asset.id : `${asset.name} (${asset.id})`}</option>)}
    </select></label>
    {onOpenAsset !== undefined && <button type="button" data-tkr-pack-open="true" disabled={disabled || chosenPack === undefined} onClick={() => { if (chosenPack !== undefined) onOpenAsset(chosenPack.path); }}>Open pack source</button>}
    <label>Pack placement <select data-tkr-placement-select="true" aria-label="Pack placement" value={selected?.instanceId ?? ""} disabled={disabled} onChange={(event) => { onSelect(event.currentTarget.value); setMessage(""); }}>
      <option value="">No placement selected</option>
      {placements.map((placement) => <option key={placement.instanceId} value={placement.instanceId}>{description(placement)}</option>)}
    </select></label>
    <label>Placement floor <select data-tkr-placement-floor="true" aria-label="Placement floor" value={floor} disabled={disabled} onChange={(event) => setField("floor", event.currentTarget.value)}>
      {scene.floors.map((entry) => <option key={entry.id} value={entry.id}>{entry.id}</option>)}
    </select></label>
    <label>Placement X <input data-tkr-placement-x="true" aria-label="Placement X" type="number" step="1" value={x} disabled={disabled} onInput={(event) => setField("x", event.currentTarget.value)} /></label>
    <label>Placement Y <input data-tkr-placement-y="true" aria-label="Placement Y" type="number" step="1" value={y} disabled={disabled} onInput={(event) => setField("y", event.currentTarget.value)} /></label>
    <div>
      <button type="button" data-tkr-placement-add="true" disabled={!canPlace} onClick={() => {
        if (chosenPack === undefined || chosenAsset === undefined || point.x === null || point.y === null) return;
        const placed = placeScenePackAsset(scene, { pack: chosenPack.path, asset: chosenAsset.id, floor }, point.x, point.y);
        onChange(placed.scene);
        onSelect(placed.instanceId);
        setMessage(`Placed ${chosenPack.path}#${chosenAsset.id} as ${placed.instanceId}.`);
      }}>Place asset</button>
      <button type="button" data-tkr-placement-move="true" disabled={!canMove} onClick={() => {
        if (selected === undefined || point.x === null || point.y === null) return;
        const moved = moveScenePackPlacement(scene, selected.instanceId, { floor, x: point.x, y: point.y });
        if (moved === null) { setMessage(`Placement ${selected.instanceId} is no longer in the scene.`); return; }
        onChange(moved);
        setMessage(`Moved ${selected.instanceId} to ${floor} at ${point.x}, ${point.y}.`);
      }}>Apply placement</button>
      <button type="button" data-tkr-placement-copy="true" disabled={disabled || selected === undefined} onClick={() => {
        if (selected === undefined) return;
        const copied = copyScenePackPlacement(scene, selected.instanceId);
        if (copied === null) { setMessage(`Placement ${selected.instanceId} is no longer in the scene.`); return; }
        onChange(copied.scene);
        onSelect(copied.instanceId);
        setMessage(`Copied ${selected.instanceId} to ${copied.instanceId}.`);
      }}>Copy placement</button>
      <button type="button" data-tkr-placement-delete="true" disabled={disabled || selected === undefined} onClick={() => {
        if (selected === undefined) return;
        const removed = selected.instanceId;
        onChange(removeScenePackPlacement(scene, removed));
        onSelect("");
        setMessage(`Removed placement ${removed}. Its generated image stays with the scene's build history and the board no longer lists it.`);
      }}>Delete placement</button>
      {onOpenAsset !== undefined && <button type="button" data-tkr-placement-open="true" disabled={disabled || selected === undefined || selectedPack === null} onClick={() => {
        if (selectedPack === null) return;
        onOpenAsset(selectedPack.path);
      }}>Open placement source</button>}
    </div>
    {missing !== null && selected !== undefined && <p role="status" data-tkr-placement-missing="true">
      Placement {selected.instanceId} references a missing {missing}: {missing === "pack" ? selected.pack : `${selected.pack}#${selected.asset}`}. It stays visible and can be moved or deleted.
    </p>}
    <p role="status">{message}</p>
  </section>;
}
