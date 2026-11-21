import { decodeTexture } from "@tk-reawakened/core";
import {
  createEditTracker,
  type GeometrySolid,
  type GeometryUnder,
  type NativeGeometryCommand,
  type NativeGeometrySnapshot,
  type NativeGeometrySource,
  type PendingEdits,
} from "@tk-reawakened/editor-model";
import type { Capability, DocumentEdited } from "@tk-reawakened/platform-services";
import { useContext, useEffect, useId, useRef, useState } from "preact/hooks";
import { AssetRefreshContext } from "./asset-refresh.ts";
import type { ViewDocument } from "./mount.ts";
import { useDocumentSnapshot } from "./use-document.ts";

export type NativeGeometryViewDocument = ViewDocument<NativeGeometrySnapshot, NativeGeometryCommand>;

export interface NativeGeometryViewProps {
  readonly doc: NativeGeometryViewDocument;
  readonly capabilities: ReadonlySet<Capability>;
  readonly pendingEdits: PendingEdits;
  readonly onEdited: (event: DocumentEdited) => void;
  /** Reads a project file so the owner's picture can sit behind the grid; without it the grid stands alone. */
  readonly readFile?: (path: string) => Promise<Uint8Array | null>;
}

type Point = readonly [number, number];
type Kind = "solid" | "under";
type Frame = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
type ArtLayer = {
  readonly file: string;
  readonly rect: readonly [number, number, number, number];
  /** Where the crop's top-left sits in authored pixels. */
  readonly x: number;
  readonly y: number;
  readonly colorKey?: readonly [number, number, number];
};
type Picture = { readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly rgba: Uint8ClampedArray };
type Owner = {
  readonly id: string | undefined;
  readonly name: string;
  readonly solid: readonly GeometrySolid[];
  readonly under: readonly GeometryUnder[];
  readonly frame: Frame;
  readonly layers: readonly ArtLayer[];
  readonly origin: string;
};
type DraftPoint = { readonly x: string; readonly y: string };
type Draft = {
  /** The pack asset the draft belongs to; empty for a tile. */
  readonly ownerId: string;
  readonly kind: Kind;
  /** The index of the shape being edited, or `null` for a new shape. */
  readonly index: number | null;
  readonly label: string;
  readonly closed: boolean;
  readonly attributes: number;
  readonly points: readonly DraftPoint[];
};

/** Mask bits of a walk-behind region (docs/spec/formats/native-asset-pack.md#fields). */
const ATTRIBUTES = [[1, "Covers background"], [2, "Covers lower layers"], [4, "Intersects the frame"]] as const;
const COORDINATE = /^-?\d+$/;
const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;
/** Points far outside the picture do not stretch the drawing; the fields still accept them. */
const VIEW_LIMIT = 4096;
const DRAWING_PIXELS = 640;
const KIND_NAME: Readonly<Record<Kind, string>> = { solid: "solid barrier", under: "walk-behind region" };

const problem = (error: unknown): string => error instanceof Error ? error.message : String(error);
const clamp = (value: number): number => Math.max(-VIEW_LIMIT, Math.min(VIEW_LIMIT, value));

/** The shapes, the picture frame and the picture crops of whatever the document edits right now. */
function ownerOf(source: NativeGeometrySource, assetId: string): Owner | null {
  if (source.kind === "tile") {
    const { tile } = source;
    const sample = tile.visual.sample ?? tile.visual.cels?.[0]?.sample;
    const key = tile.visual.transparent.mode === "colorKey" ? { colorKey: tile.visual.transparent.color } : {};
    const layers: ArtLayer[] = sample !== undefined && "file" in sample ? [{ file: sample.file, rect: sample.rect, x: 0, y: 0, ...key }] : [];
    const size = layers[0] === undefined ? [32, 32] : [layers[0].rect[2], layers[0].rect[3]];
    return {
      id: undefined, name: tile.name, solid: tile.solid ?? [], under: tile.under ?? [],
      frame: { x: 0, y: 0, width: size[0]!, height: size[1]! }, layers, origin: "the tile's top-left corner",
    };
  }
  const { pack } = source;
  const asset = pack.assets.find((candidate) => candidate.id === assetId) ?? pack.assets[0];
  if (asset === undefined) return null;
  const layers: ArtLayer[] = [];
  for (const visual of asset.visuals) {
    const art = pack.sources.find((candidate) => candidate.id === visual.source);
    if (art === undefined) continue;
    layers.push({ file: art.file, rect: visual.rect, x: -asset.anchor.x, y: -asset.anchor.y, ...(art.transparent?.mode === "colorKey" ? { colorKey: art.transparent.color } : {}) });
  }
  return {
    id: asset.id, name: asset.name, solid: asset.solid ?? [], under: asset.under ?? [],
    frame: {
      x: -asset.anchor.x, y: -asset.anchor.y,
      width: Math.max(0, ...asset.visuals.map((visual) => visual.rect[2])), height: Math.max(0, ...asset.visuals.map((visual) => visual.rect[3])),
    },
    layers, origin: "the asset's anchor",
  };
}

function draftFor(kind: Kind, index: number | null, owner: Owner): Draft {
  const ownerId = owner.id ?? "";
  if (index === null) return { ownerId, kind, index, label: "", closed: kind === "under", attributes: 0, points: [] };
  const shape = owner[kind][index]!;
  return {
    ownerId, kind, index, label: shape.label, closed: shape.closed, attributes: "attributes" in shape ? shape.attributes : 0,
    points: shape.points.map(([x, y]) => ({ x: String(x), y: String(y) })),
  };
}

/** The whole-number points of a draft, or the sentence that says why Apply is not offered yet. */
function checkDraft(draft: Draft): { readonly points: readonly Point[]; readonly problem: string | null } {
  const points: Point[] = [];
  for (const [index, point] of draft.points.entries()) {
    for (const [axis, text] of [["X", point.x], ["Y", point.y]] as const) {
      const value = Number(text);
      if (!COORDINATE.test(text.trim()) || value < INT32_MIN || value > INT32_MAX) {
        return { points, problem: `Point ${index + 1} ${axis} must be a whole number from ${INT32_MIN} to ${INT32_MAX}.` };
      }
    }
    points.push([Number(point.x), Number(point.y)]);
  }
  const needed = draft.kind === "under" || draft.closed ? 3 : 2;
  if (draft.label.trim() === "") return { points, problem: "Give the shape a label." };
  if (points.length < needed) return { points, problem: `A ${draft.kind === "under" || draft.closed ? "closed shape needs at least three points" : "barrier needs at least two points"}; this one has ${points.length}.` };
  return { points, problem: null };
}

function describe(kind: Kind, shape: GeometrySolid | GeometryUnder): string {
  const covered = "attributes" in shape ? ATTRIBUTES.filter(([bit]) => (shape.attributes & bit) !== 0).map(([, name]) => name.toLowerCase()) : [];
  return `${shape.label} (${shape.closed ? "closed" : "open"}, ${shape.points.length} points${kind === "under" ? `; ${covered.length === 0 ? "no layers covered" : covered.join(", ")}` : ""})`;
}

function crop(texture: { readonly w: number; readonly h: number; readonly rgba: Uint8Array }, layer: ArtLayer): Picture | string {
  const [x, y, width, height] = layer.rect;
  if (x + width > texture.w || y + height > texture.h) return `${layer.file} is smaller than the crop [${x}, ${y}, ${width}, ${height}]`;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const from = ((y + row) * texture.w + x + column) * 4;
      const to = (row * width + column) * 4;
      const keyed = layer.colorKey !== undefined && texture.rgba[from] === layer.colorKey[0] && texture.rgba[from + 1] === layer.colorKey[1] && texture.rgba[from + 2] === layer.colorKey[2];
      rgba[to] = texture.rgba[from]!; rgba[to + 1] = texture.rgba[from + 1]!; rgba[to + 2] = texture.rgba[from + 2]!;
      rgba[to + 3] = keyed ? 0 : texture.rgba[from + 3]!;
    }
  }
  return { x: layer.x, y: layer.y, width, height, rgba };
}

/**
 * Collision and walk-behind of one tile or pack asset (docs/spec/formats/native-tile.md#geometry-and-program-activation,
 * docs/spec/formats/native-asset-pack.md#fields). Points are whole pixels from the owner's own origin and may be
 * negative. A draft is written nowhere until Apply; Cancel leaves the document untouched.
 */
export function NativeGeometryView({ doc, pendingEdits, capabilities, onEdited, readFile }: NativeGeometryViewProps) {
  const snapshot = useDocumentSnapshot(doc);
  const assetRevision = useContext(AssetRefreshContext);
  const submitted = useRef(createEditTracker());
  const queue = useRef(Promise.resolve());
  const canvas = useRef<HTMLCanvasElement>(null);
  const assetSelectId = useId();
  const [assetId, setAssetId] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pointer, setPointer] = useState<Point | null>(null);
  const [resolving, setResolving] = useState(false);
  const [pictures, setPictures] = useState<readonly Picture[]>([]);
  const [artNote, setArtNote] = useState("");
  useEffect(() => pendingEdits.register(submitted.current), [pendingEdits]);

  const owner = ownerOf(snapshot.geometry, assetId);
  const checked = draft === null ? null : checkDraft(draft);
  const stale = draft !== null && (draft.ownerId !== (owner?.id ?? "") || (draft.index !== null && owner?.[draft.kind][draft.index] === undefined));
  const disabled = snapshot.readOnly !== null || snapshot.conflict !== null || snapshot.saving;

  // The extent: the picture frame, the origin and every point, kept inside a sane range.
  const corners: Point[] = [[0, 0]];
  if (owner !== null) {
    corners.push([owner.frame.x, owner.frame.y], [owner.frame.x + owner.frame.width, owner.frame.y + owner.frame.height]);
    for (const shape of [...owner.solid, ...owner.under]) for (const point of shape.points) corners.push(point);
  }
  for (const point of checked?.points ?? []) corners.push(point);
  const xs = corners.map((point) => clamp(point[0]));
  const ys = corners.map((point) => clamp(point[1]));
  const x0 = Math.floor((Math.min(...xs) - 8) / 8) * 8;
  const y0 = Math.floor((Math.min(...ys) - 8) / 8) * 8;
  const view: Frame = { x: x0, y: y0, width: Math.ceil((Math.max(...xs) + 8) / 8) * 8 - x0, height: Math.ceil((Math.max(...ys) + 8) / 8) * 8 - y0 };
  const fit = DRAWING_PIXELS / Math.max(view.width, view.height);
  const scale = fit >= 1 ? Math.min(12, Math.floor(fit)) : fit;
  const step = [8, 32, 128, 512].find((candidate) => Math.max(view.width, view.height) / candidate <= 40) ?? 512;
  const lines = (from: number, length: number): number[] => {
    const found: number[] = [];
    for (let at = Math.ceil(from / step) * step; at <= from + length; at += step) found.push(at);
    return found;
  };

  const layersKey = JSON.stringify(owner?.layers ?? []);
  useEffect(() => {
    let cancelled = false;
    const layers = owner?.layers ?? [];
    setPictures([]);
    if (layers.length === 0 || readFile === undefined) { setArtNote(layers.length === 0 ? "This owner names no ordinary picture file, so only the grid is drawn." : "No picture is available here, so only the grid is drawn."); return; }
    setArtNote("");
    void (async () => {
      const made: Picture[] = [];
      for (const layer of layers) {
        try {
          const bytes = await readFile(layer.file);
          if (bytes === null) { if (!cancelled) setArtNote(`Could not read ${layer.file}; only the grid is drawn.`); continue; }
          const decoded = decodeTexture(bytes, layer.file);
          if (!decoded.ok) { if (!cancelled) setArtNote(`Could not decode ${layer.file}: ${decoded.error.message}`); continue; }
          const cropped = crop(decoded.value, layer);
          if (typeof cropped === "string") { if (!cancelled) setArtNote(cropped); continue; }
          made.push(cropped);
        } catch (error) { if (!cancelled) setArtNote(`Could not read ${layer.file}: ${problem(error)}`); }
      }
      if (!cancelled) setPictures(made);
    })();
    return () => { cancelled = true; };
  }, [layersKey, readFile, assetRevision]);

  useEffect(() => {
    const surface = canvas.current;
    if (surface === null || typeof document === "undefined" || typeof ImageData === "undefined") return;
    const context = surface.getContext("2d");
    if (context === null) return;
    context.clearRect(0, 0, surface.width, surface.height);
    context.imageSmoothingEnabled = false;
    for (const picture of pictures) {
      const staging = document.createElement("canvas");
      staging.width = picture.width;
      staging.height = picture.height;
      staging.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(picture.rgba), picture.width, picture.height), 0, 0);
      context.drawImage(staging, (picture.x - view.x) * scale, (picture.y - view.y) * scale, picture.width * scale, picture.height * scale);
    }
  }, [pictures, view.x, view.y, view.width, view.height, scale]);

  // A draft whose asset or shape the document no longer has cannot stay open (an undo or an outside edit took it away).
  useEffect(() => {
    if (stale) { setDraft(null); setMessage("The shape or asset being edited changed in the document, so the draft was discarded."); }
  }, [snapshot.geometry]);

  const run = (solid: readonly GeometrySolid[], under: readonly GeometryUnder[]): Promise<boolean> => {
    const finish = submitted.current.begin();
    const command: NativeGeometryCommand = { type: "set-native-geometry", ...(owner?.id === undefined ? {} : { asset: owner.id }), solid, under };
    const operation = queue.current.then(async () => {
      try {
        const result = await doc.apply(command);
        if (!result.ok) { setMessage(result.rejection.message); return false; }
        const edit = doc.getSnapshot().edits.find((entry) => entry.editId === result.editId);
        onEdited({ document: doc.identity.key, editId: result.editId, label: edit?.label ?? "Set collision and walk-behind" });
        return true;
      } catch (error) {
        setMessage(problem(error));
        return false;
      } finally { finish(); }
    });
    queue.current = operation.then(() => undefined);
    return operation;
  };
  const save = async (): Promise<void> => {
    try {
      await pendingEdits.settle();
      const result = await doc.save();
      setMessage(result.ok ? "Saved." : result.failure.message);
    } catch (error) { setMessage(problem(error)); }
  };
  const resolve = async (choice: "keep-local" | "reload"): Promise<void> => {
    setResolving(true);
    try {
      const result = await doc.resolveConflict(choice);
      if (!result.ok) setMessage(result.message);
      else if (choice === "keep-local" && capabilities.has("conflictAutoSave")) {
        const saved = await doc.save();
        setMessage(saved.ok ? "Saved." : saved.failure.message);
      } else { if (choice === "reload") setDraft(null); setMessage(null); }
    } catch (error) { setMessage(problem(error)); }
    finally { setResolving(false); }
  };

  const apply = async (): Promise<void> => {
    if (draft === null || checked === null || checked.problem !== null || owner === null || stale) return;
    const shape = draft.kind === "solid"
      ? { label: draft.label, closed: draft.closed, points: checked.points }
      : { label: draft.label, attributes: draft.attributes, closed: true, points: checked.points };
    const replace = <T,>(list: readonly T[], next: T): T[] => draft.index === null ? [...list, next] : list.map((entry, at) => at === draft.index ? next : entry);
    const accepted = draft.kind === "solid" ? await run(replace(owner.solid, shape), owner.under) : await run(owner.solid, replace(owner.under, shape as GeometryUnder));
    if (accepted) { setDraft(null); setMessage(`${draft.index === null ? "Added" : "Updated"} ${KIND_NAME[draft.kind]} "${draft.label}". Save to keep it.`); }
  };
  const removeShape = async (): Promise<void> => {
    if (draft === null || draft.index === null || owner === null || stale) return;
    const without = <T,>(list: readonly T[]): T[] => list.filter((_, at) => at !== draft.index);
    const accepted = draft.kind === "solid" ? await run(without(owner.solid), owner.under) : await run(owner.solid, without(owner.under));
    if (accepted) { setDraft(null); setMessage(`Removed ${KIND_NAME[draft.kind]} "${draft.label}". Save to keep it.`); }
  };
  const setPoint = (index: number, axis: "x" | "y", text: string): void => {
    if (draft !== null) setDraft({ ...draft, points: draft.points.map((point, at) => at === index ? { ...point, [axis]: text } : point) });
  };
  const authored = (event: { readonly clientX: number; readonly clientY: number; readonly currentTarget: Element }): Point | null => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return [Math.round(view.x + (event.clientX - rect.left) * view.width / rect.width), Math.round(view.y + (event.clientY - rect.top) * view.height / rect.height)];
  };

  const outline = (points: readonly Point[], closed: boolean, color: string, dashed: boolean, key: string) => {
    const list = points.map(([x, y]) => `${clamp(x)},${clamp(y)}`).join(" ");
    const dash = dashed ? "5 3" : "none";
    return closed
      ? <polygon key={key} points={list} fill={color} fill-opacity={0.22} stroke={color} stroke-width={2} stroke-dasharray={dash} vector-effect="non-scaling-stroke" />
      : <polyline key={key} points={list} fill="none" stroke={color} stroke-width={2} stroke-dasharray={dash} vector-effect="non-scaling-stroke" />;
  };
  const editing = (kind: Kind, index: number): boolean => draft !== null && draft.kind === kind && draft.index === index;

  if (owner === null) {
    return <main class="tkr-native-geometry-editor" aria-label="Collision and walk-behind"><p role="alert">This pack has no assets, so there is nothing to edit.</p></main>;
  }
  return <section class="tkr-native-geometry-editor" data-tkr-geometry="true" aria-label="Collision and walk-behind">
    <header>
      <h2>Collision and walk-behind</h2>
      <p>{owner.name}: shapes saved with {snapshot.geometry.kind === "tile" ? "this tile" : "this asset"}, wherever it is painted or placed.</p>
      <button type="button" data-editor-save="true" disabled={snapshot.saving || snapshot.readOnly !== null || draft !== null} onClick={() => void save()}>Save</button>
    </header>
    {snapshot.readOnly !== null && <p role="status">Read only: {snapshot.readOnly.message}</p>}
    {snapshot.conflict !== null && <section role="alert">
      <p>{snapshot.conflict.message} Nothing was saved.</p>
      <button type="button" disabled={resolving || snapshot.readOnly !== null} onClick={() => void resolve("keep-local")}>{capabilities.has("conflictAutoSave") ? "Save my version" : "Keep my version"}</button>
      {capabilities.has("conflictReload") && snapshot.conflict.externalTitle !== null && <button type="button" disabled={resolving} onClick={() => void resolve("reload")}>Use the version on disk</button>}
    </section>}
    {snapshot.geometry.kind === "asset-pack" && <div>
      <label htmlFor={assetSelectId}>Pack asset</label>{" "}
      <select id={assetSelectId} value={owner.id} disabled={disabled || draft !== null} onChange={(event) => { setAssetId(event.currentTarget.value); setMessage(null); }}>
        {snapshot.geometry.pack.assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name} ({asset.id})</option>)}
      </select>
    </div>}
    <p role="status" data-tkr-geometry-status="true">{message ?? (draft === null
      ? "Choose New solid barrier or New walk-behind region, or pick a shape to edit."
      : "Click the drawing to add a point, or use the point fields. Nothing is written until you choose Apply shape.")}</p>
    <div class="tkr-geometry-picture">
      <canvas ref={canvas} width={Math.round(view.width * scale)} height={Math.round(view.height * scale)} aria-hidden="true" />
      <svg data-tkr-geometry-canvas="true" role="img"
        aria-label={`Drawing of ${owner.name}'s shapes. Coordinates are whole pixels from ${owner.origin}. Click to add a point to the open shape.`}
        width={Math.round(view.width * scale)} height={Math.round(view.height * scale)} viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
        onClick={(event) => {
          if (draft === null || disabled) return;
          const point = authored(event);
          if (point !== null) setDraft({ ...draft, points: [...draft.points, { x: String(point[0]), y: String(point[1]) }] });
        }}
        onMouseMove={(event) => {
          const point = authored(event);
          if (point !== null && (pointer === null || pointer[0] !== point[0] || pointer[1] !== point[1])) setPointer(point);
        }}>
        {lines(view.x, view.width).map((at) => <line key={`x${at}`} x1={at} y1={view.y} x2={at} y2={view.y + view.height} stroke="currentColor" stroke-opacity={at === 0 ? 0.6 : 0.18} vector-effect="non-scaling-stroke" />)}
        {lines(view.y, view.height).map((at) => <line key={`y${at}`} x1={view.x} y1={at} x2={view.x + view.width} y2={at} stroke="currentColor" stroke-opacity={at === 0 ? 0.6 : 0.18} vector-effect="non-scaling-stroke" />)}
        <rect x={owner.frame.x} y={owner.frame.y} width={owner.frame.width} height={owner.frame.height} fill="none" stroke="currentColor" stroke-opacity={0.8} stroke-dasharray="4 3" vector-effect="non-scaling-stroke"><title>Picture frame</title></rect>
        {owner.under.map((shape, index) => editing("under", index) ? null : outline(shape.points, true, "#3366ff", false, `u${index}`))}
        {owner.solid.map((shape, index) => editing("solid", index) ? null : outline(shape.points, shape.closed, "#dd3333", false, `s${index}`))}
        {draft !== null && checked !== null && checked.points.length > 0 && outline(checked.points, (draft.kind === "under" || draft.closed) && checked.points.length > 2, draft.kind === "solid" ? "#ff8800" : "#00aaaa", true, "draft")}
        {draft !== null && checked !== null && checked.points.map(([x, y], index) => <circle key={`p${index}`} cx={clamp(x)} cy={clamp(y)} r={4 / scale} fill="#ffffff" stroke="#000000" vector-effect="non-scaling-stroke"><title>Point {index + 1}: {x}, {y}</title></circle>)}
        <path d={`M ${-6 / scale} 0 H ${6 / scale} M 0 ${-6 / scale} V ${6 / scale}`} stroke="currentColor" stroke-width={2} fill="none" vector-effect="non-scaling-stroke"><title>Origin (0, 0): {owner.origin}</title></path>
      </svg>
    </div>
    <p>Picture frame: x {owner.frame.x} to {owner.frame.x + owner.frame.width}, y {owner.frame.y} to {owner.frame.y + owner.frame.height}. The cross is (0, 0), {owner.origin}; negative values are left of or above it.{pointer === null ? "" : ` Pointer: ${pointer[0]}, ${pointer[1]}.`}</p>
    {artNote !== "" && <p>{artNote}</p>}
    {(["solid", "under"] as const).map((kind) => <section key={kind} aria-label={kind === "solid" ? "Solid barriers" : "Walk-behind regions"}>
      <h3>{kind === "solid" ? "Solid barriers" : "Walk-behind regions"}</h3>
      <ul aria-label={kind === "solid" ? "Solid barrier list" : "Walk-behind region list"}>
        {owner[kind].map((shape, index) => <li key={index}>
          <button type="button" data-tkr-shape={`${kind}:${index}`} disabled={disabled || draft !== null} aria-label={`Edit ${KIND_NAME[kind]} ${index + 1}: ${describe(kind, shape)}`} onClick={() => { setDraft(draftFor(kind, index, owner)); setMessage(null); }}>{describe(kind, shape)}</button>
        </li>)}
      </ul>
      {owner[kind].length === 0 && <p>{kind === "solid" ? "No collision: the player can walk through everything." : "No walk-behind regions."}</p>}
      <button type="button" disabled={disabled || draft !== null} onClick={() => { setDraft(draftFor(kind, null, owner)); setMessage(null); }}>{kind === "solid" ? "New solid barrier" : "New walk-behind region"}</button>
    </section>)}
    {draft !== null && checked !== null && <fieldset aria-label="Shape being drawn" disabled={disabled}>
      <legend>{draft.index === null ? "New" : "Edit"} {KIND_NAME[draft.kind]}</legend>
      <label>Shape label <input type="text" value={draft.label} onInput={(event) => setDraft({ ...draft, label: event.currentTarget.value })} /></label>
      {draft.kind === "solid"
        ? <label><input type="checkbox" checked={draft.closed} onChange={(event) => setDraft({ ...draft, closed: event.currentTarget.checked })} /> Closed</label>
        : <>
          <p>Walk-behind regions are always closed polygons.</p>
          {ATTRIBUTES.map(([bit, name]) => <label key={bit}><input type="checkbox" checked={(draft.attributes & bit) !== 0} onChange={(event) => setDraft({ ...draft, attributes: event.currentTarget.checked ? draft.attributes | bit : draft.attributes & ~bit })} /> {name}</label>)}
        </>}
      <ol aria-label="Points">
        {draft.points.map((point, index) => <li key={index}>
          <label>Point {index + 1} X <input type="number" step="1" value={point.x} onInput={(event) => setPoint(index, "x", event.currentTarget.value)} /></label>
          <label>Point {index + 1} Y <input type="number" step="1" value={point.y} onInput={(event) => setPoint(index, "y", event.currentTarget.value)} /></label>
          <button type="button" onClick={() => setDraft({ ...draft, points: draft.points.filter((_, at) => at !== index) })}>Remove point {index + 1}</button>
        </li>)}
      </ol>
      <button type="button" onClick={() => {
        const last = checked.points.at(-1);
        setDraft({ ...draft, points: [...draft.points, last === undefined ? { x: "0", y: "0" } : { x: String(Math.min(INT32_MAX, last[0] + 8)), y: String(last[1]) }] });
      }}>Add point</button>
      {checked.problem !== null && <p data-tkr-geometry-problem="true">{checked.problem}</p>}
      <button type="button" disabled={checked.problem !== null} onClick={() => void apply()}>Apply shape</button>
      <button type="button" onClick={() => { setDraft(null); setMessage("Draft cancelled. Nothing was written."); }}>Cancel draft</button>
      {draft.index !== null && <button type="button" onClick={() => void removeShape()}>Remove shape</button>}
    </fieldset>}
  </section>;
}
