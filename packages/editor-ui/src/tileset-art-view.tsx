import type { ApplyResult, ConflictChoice, TilesetArtCommand, TilesetArtSnapshot } from "@tk-reawakened/editor-model";
import type { Capabilities, DocumentEdited } from "@tk-reawakened/platform-services";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { ViewDocument } from "./mount.ts";
import { useDocumentSnapshot } from "./use-document.ts";

const CANVAS_SIZE = 512;

export interface TilesetArtViewProps {
  readonly doc: ViewDocument<TilesetArtSnapshot, TilesetArtCommand>;
  readonly capabilities: Capabilities;
  readonly onEdited: (event: DocumentEdited) => void;
}

interface Pixel {
  readonly x: number;
  readonly y: number;
  readonly rgba: readonly [number, number, number, number];
}

interface Gesture {
  readonly pointerId: number;
  readonly tile: number;
  readonly baseTiles: TilesetArtSnapshot["tiles"];
  readonly rgba: readonly [number, number, number, number];
  readonly changes: Set<number>;
  lastX: number;
  lastY: number;
}

interface RenderCache {
  readonly target: HTMLCanvasElement;
  readonly targetContext: CanvasRenderingContext2D;
  readonly source: HTMLCanvasElement;
  readonly sourceContext: CanvasRenderingContext2D;
  readonly imageData: ImageData;
  renderedTiles: TilesetArtSnapshot["tiles"] | null;
  renderedTile: number;
  renderedPreviewVersion: number;
  renderedPreviewAllowed: boolean;
}

function brushRgba(color: string, erase: boolean): readonly [number, number, number, number] {
  if (erase) return [0, 0, 0, 0];
  return [Number.parseInt(color.slice(1, 3), 16), Number.parseInt(color.slice(3, 5), 16), Number.parseInt(color.slice(5, 7), 16), 255];
}

let viewsMade = 0;

function pixelKey(x: number, y: number, width: number): number {
  return y * width + x;
}

function interpolate(x0: number, y0: number, x1: number, y1: number, visit: (x: number, y: number) => void): void {
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  while (true) {
    visit(x, y);
    if (x === x1 && y === y1) return;
    const twice = error * 2;
    if (twice >= dy) {
      error += dy;
      x += sx;
    }
    if (twice <= dx) {
      error += dx;
      y += sy;
    }
  }
}

function sameTiles(left: TilesetArtSnapshot["tiles"], right: TilesetArtSnapshot["tiles"]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const before = left[index]!;
    const after = right[index]!;
    if (before === after) continue;
    if (before.width !== after.width || before.height !== after.height || before.pixels.length !== after.pixels.length) return false;
    for (let pixel = 0; pixel < before.pixels.length; pixel += 1) {
      if (before.pixels[pixel] !== after.pixels[pixel]) return false;
    }
  }
  return true;
}

/** A tileset pixel editor whose only editable authority is the host's tileset document. */
export function TilesetArtView({ doc, capabilities, onEdited }: TilesetArtViewProps) {
  const snapshot = useDocumentSnapshot(doc);
  const [ids] = useState(() => {
    viewsMade += 1;
    return `tkr-tileset-art-${viewsMade}`;
  });
  const [tile, setTile] = useState(0);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const [color, setColor] = useState("#000000");
  const [erase, setErase] = useState(false);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [savePending, setSavePending] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [conflictDismissed, setConflictDismissed] = useState(false);
  const gesture = useRef<Gesture | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [canvasIssue, setCanvasIssue] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editNotice, setEditNotice] = useState<string | null>(null);
  const renderCache = useRef<RenderCache | null>(null);

  // A native webview receives cloned JSON on save-status changes. Preserve view identity only when pixel data is equal.
  const lastIncomingTiles = useRef(snapshot.tiles);
  const acceptedTiles = useRef(snapshot.tiles);
  if (lastIncomingTiles.current !== snapshot.tiles) {
    if (!sameTiles(acceptedTiles.current, snapshot.tiles)) acceptedTiles.current = snapshot.tiles;
    lastIncomingTiles.current = snapshot.tiles;
  }
  const tiles = acceptedTiles.current;
  const hasTiles = tiles.length > 0;
  const selectedTile = hasTiles ? Math.min(tile, tiles.length - 1) : -1;
  const active = selectedTile < 0 ? undefined : tiles[selectedTile];
  const readOnly = snapshot.readOnly !== null;
  const canPaint = hasTiles && !readOnly && snapshot.conflict === null && canvasIssue === null;

  const cancelGesture = (): void => {
    const current = gesture.current;
    gesture.current = null;
    if (current !== null) {
      const target = canvas.current;
      if (target?.hasPointerCapture(current.pointerId)) target.releasePointerCapture(current.pointerId);
      setPreviewVersion((version) => version + 1);
    }
  };

  useLayoutEffect(() => {
    // Equivalent transported tiles retain identity; changed pixels, document, conflict or read-only state cancel a stroke.
    cancelGesture();
    setCursor((current) => {
      const x = Math.min(current.x, (active?.width ?? 1) - 1);
      const y = Math.min(current.y, (active?.height ?? 1) - 1);
      return current.x === x && current.y === y ? current : { x, y };
    });
    setRefusal(null);
  }, [doc, tiles, snapshot.conflict, snapshot.readOnly]);

  useEffect(() => {
    const onWindowBlur = (): void => cancelGesture();
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("blur", onWindowBlur);
      cancelGesture();
      renderCache.current = null;
    };
  }, []);

  useEffect(() => {
    if (snapshot.conflict === null) setConflictDismissed(false);
  }, [snapshot.conflict]);

  useEffect(() => {
    setSaveError(snapshot.saveError?.message ?? null);
  }, [snapshot.saveError]);

  useLayoutEffect(() => {
    const element = canvas.current;
    if (active === undefined) {
      setCanvasIssue(null);
      return;
    }
    if (element === null) return;
    if (typeof ImageData === "undefined") {
      setCanvasIssue("Canvas pixel buffers are not available in this browser.");
      return;
    }
    let cache = renderCache.current;
    if (cache === null || cache.target !== element || cache.imageData.width !== active.width || cache.imageData.height !== active.height) {
      if (element.width !== CANVAS_SIZE) element.width = CANVAS_SIZE;
      if (element.height !== CANVAS_SIZE) element.height = CANVAS_SIZE;
      const targetContext = element.getContext("2d");
      const source = document.createElement("canvas");
      source.width = active.width;
      source.height = active.height;
      const sourceContext = source.getContext("2d");
      if (targetContext === null || sourceContext === null) {
        renderCache.current = null;
        setCanvasIssue("A 2D canvas context is unavailable in this browser.");
        return;
      }
      cache = {
        target: element,
        targetContext,
        source,
        sourceContext,
        imageData: new ImageData(active.width, active.height),
        renderedTiles: null,
        renderedTile: -1,
        renderedPreviewVersion: -1,
        renderedPreviewAllowed: false,
      };
      renderCache.current = cache;
    }
    const preview = gesture.current;
    const previewAllowed = preview !== null && preview.tile === selectedTile && preview.baseTiles === tiles
      && snapshot.conflict === null && snapshot.readOnly === null;
    const pixelsChanged = cache.renderedTiles !== tiles || cache.renderedTile !== selectedTile
      || cache.renderedPreviewVersion !== previewVersion || cache.renderedPreviewAllowed !== previewAllowed;
    if (pixelsChanged) {
      const data = cache.imageData.data;
      for (let index = 0; index < data.length; index += 1) data[index] = active.pixels[index] ?? 0;
      if (previewAllowed && preview !== null) {
        for (const key of preview.changes) {
          const offset = key * 4;
          data[offset] = preview.rgba[0];
          data[offset + 1] = preview.rgba[1];
          data[offset + 2] = preview.rgba[2];
          data[offset + 3] = preview.rgba[3];
        }
      }
      cache.sourceContext.putImageData(cache.imageData, 0, 0);
      cache.renderedTiles = tiles;
      cache.renderedTile = selectedTile;
      cache.renderedPreviewVersion = previewVersion;
      cache.renderedPreviewAllowed = previewAllowed;
    }
    cache.targetContext.imageSmoothingEnabled = false;
    cache.targetContext.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    cache.targetContext.drawImage(cache.source, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
    const cursorX = Math.floor(cursor.x * CANVAS_SIZE / active.width);
    const cursorY = Math.floor(cursor.y * CANVAS_SIZE / active.height);
    const cursorSize = CANVAS_SIZE / active.width;
    cache.targetContext.lineWidth = 3;
    cache.targetContext.strokeStyle = "#ffffff";
    cache.targetContext.strokeRect(cursorX + 1.5, cursorY + 1.5, cursorSize - 3, cursorSize - 3);
    cache.targetContext.lineWidth = 1;
    cache.targetContext.strokeStyle = "#000000";
    cache.targetContext.strokeRect(cursorX + 1.5, cursorY + 1.5, cursorSize - 3, cursorSize - 3);
    setCanvasIssue(null);
  }, [active, cursor, previewVersion, selectedTile, snapshot.conflict, snapshot.readOnly, tiles]);

  const submit = (changes: readonly Pixel[]): void => {
    if (changes.length === 0 || selectedTile < 0 || !canPaint || active === undefined) return;
    const effective = changes.filter(({ x, y, rgba }) => {
      const offset = (y * active.width + x) * 4;
      return active.pixels[offset + 3] !== rgba[3]
        || (rgba[3] !== 0 && (active.pixels[offset] !== rgba[0] || active.pixels[offset + 1] !== rgba[1] || active.pixels[offset + 2] !== rgba[2]));
    });
    if (effective.length === 0) return;
    const command: TilesetArtCommand = {
      type: "paint-tileset-pixels",
      tile: selectedTile,
      changes: effective,
    };
    const finish = (result: ApplyResult): void => {
      if (!result.ok) {
        setRefusal(result.rejection.message);
        return;
      }
      setRefusal(null);
      setEditNotice(null);
      try {
        const edit = doc.getSnapshot().edits.find((entry) => entry.editId === result.editId);
        onEdited({ document: doc.identity.key, editId: result.editId, label: edit?.label ?? "Paint tileset pixels" });
      } catch (error) {
        setEditNotice(`The document accepted this edit, but the host could not be notified: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    try {
      void Promise.resolve(doc.apply(command)).then(finish).catch((error: unknown) => {
        setRefusal(error instanceof Error ? error.message : String(error));
      });
    } catch (error) {
      setRefusal(error instanceof Error ? error.message : String(error));
    }
  };
  const conflict = snapshot.conflict;
  const saveDisabled = readOnly || savePending || snapshot.saving || conflict !== null || !snapshot.dirty;

  const coordinateAt = (clientX: number, clientY: number, width: number, height: number): { x: number; y: number } => {
    const bounds = canvas.current?.getBoundingClientRect();
    if (bounds === undefined || bounds.width === 0 || bounds.height === 0) return cursor;
    return {
      x: Math.max(0, Math.min(width - 1, Math.floor((clientX - bounds.left) * width / bounds.width))),
      y: Math.max(0, Math.min(height - 1, Math.floor((clientY - bounds.top) * height / bounds.height))),
    };
  };

  const stage = (current: Gesture, x: number, y: number): void => {
    const width = active?.width ?? 32;
    interpolate(current.lastX, current.lastY, x, y, (px, py) => {
      current.changes.add(pixelKey(px, py, width));
    });
    current.lastX = x;
    current.lastY = y;
    setCursor({ x, y });
    setPreviewVersion((version) => version + 1);
  };

  const resolve = (choice: ConflictChoice): void => {
    setResolving(true);
    setResolveError(null);
    void Promise.resolve().then(() => doc.resolveConflict(choice)).then(async (result) => {
      if (!result.ok) {
        setResolveError(result.message);
        return;
      }
      if (choice === "keep-local" && capabilities.has("conflictAutoSave")) {
        try {
          const saved = await doc.save();
          setSaveError(saved.ok ? null : saved.failure.message);
        } catch (error) {
          setSaveError(error instanceof Error ? error.message : String(error));
        }
      }
    }).catch((error: unknown) => setResolveError(error instanceof Error ? error.message : String(error))).finally(() => setResolving(false));
  };


  return (
    <section class="tkr-tileset-art" aria-label="Tileset artwork">
      <h2 class="tkr-tileset-art-heading">Tile artwork</h2>
      {readOnly ? <p class="tkr-tileset-art-note" role="note">Read only: {snapshot.readOnly?.message}</p> : null}
      {capabilities.has("fileWatch") ? null : <p class="tkr-tileset-art-note">This host cannot watch files, so external changes are checked when you save.</p>}
      {conflict === null ? null : (
        <div class="tkr-tileset-art-conflict" role="group" aria-label="Changed on disk">
          <p role="alert">{conflict.message}</p>
          {conflictDismissed ? <button type="button" onClick={() => setConflictDismissed(false)}>Review conflict</button> : <>
            <button type="button" disabled={resolving || readOnly} onClick={() => resolve("keep-local")}>
              {capabilities.has("conflictAutoSave") ? "Save my version" : "Keep my version"}
            </button>
            {capabilities.has("conflictReload") && conflict.externalTitle !== null ? <button type="button" disabled={resolving} onClick={() => resolve("reload")}>Use the version on disk</button> : null}
            {!capabilities.has("conflictReload") ? <p role="note">This host cannot safely reload the file in place. Both versions remain unchanged.</p> : null}
            <button type="button" disabled={resolving} onClick={() => setConflictDismissed(true)}>Cancel</button>
          </>}
          {resolveError === null ? null : <p role="alert">{resolveError}</p>}
        </div>
      )}
      {hasTiles ? <div class="tkr-tileset-art-controls">
        <label for={`${ids}-tile`}>Tile</label>
        <select id={`${ids}-tile`} aria-label="Tile" value={String(selectedTile)} disabled={readOnly} onChange={(event) => {
          cancelGesture();
          setTile(Number(event.currentTarget.value));
          setCursor({ x: 0, y: 0 });
          setRefusal(null);
        }}>
          {tiles.map((_, index) => <option key={index} value={String(index)}>{index + 1}</option>)}
        </select>
        <label for={`${ids}-color`}>Brush color</label>
        <input id={`${ids}-color`} aria-label="Brush color" type="color" value={color} disabled={!canPaint} onInput={(event) => setColor(event.currentTarget.value)} onChange={(event) => setColor(event.currentTarget.value)} />
        <button type="button" aria-pressed={erase} disabled={!canPaint} onClick={() => { cancelGesture(); setErase((value) => !value); }}>Transparent eraser</button>
      </div> : <p class="tkr-tileset-art-empty" role="status">This tileset contains no tiles.</p>}
      {active === undefined ? null : <div class="tkr-tileset-art-canvas-wrap">
        <canvas
          ref={canvas}
          class="tkr-tileset-art-canvas"
          aria-label="Pixel canvas"
          role="img"
          tabIndex={0}
          aria-disabled={!canPaint}
          aria-describedby={`${ids}-instructions`}
          onPointerDown={(event) => {
            if (!canPaint || event.button !== 0 || active === undefined || gesture.current !== null) return;
            event.currentTarget.focus({ preventScroll: true });
            const point = coordinateAt(event.clientX, event.clientY, active.width, active.height);
            const current: Gesture = { pointerId: event.pointerId, tile: selectedTile, baseTiles: tiles, rgba: brushRgba(color, erase), changes: new Set(), lastX: point.x, lastY: point.y };
            gesture.current = current;
            event.currentTarget.setPointerCapture(event.pointerId);
            stage(current, point.x, point.y);
          }}
          onPointerMove={(event) => {
            const current = gesture.current;
            if (current === null || current.pointerId !== event.pointerId) return;
            if (!canPaint || active === undefined || current.baseTiles !== tiles) {
              cancelGesture();
              return;
            }
            const point = coordinateAt(event.clientX, event.clientY, active.width, active.height);
            stage(current, point.x, point.y);
          }}
          onPointerUp={(event) => {
            const current = gesture.current;
            if (current === null || current.pointerId !== event.pointerId) return;
            if (!canPaint || active === undefined || current.baseTiles !== tiles) {
              cancelGesture();
              return;
            }
            const point = coordinateAt(event.clientX, event.clientY, active.width, active.height);
            stage(current, point.x, point.y);
            const changes: Pixel[] = Array.from(current.changes, (key) => ({
              x: key % active.width,
              y: Math.floor(key / active.width),
              rgba: current.rgba,
            }));
            gesture.current = null;
            setPreviewVersion((version) => version + 1);
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            submit(changes);
          }}
          onPointerCancel={cancelGesture}
          onLostPointerCapture={cancelGesture}
          onBlur={cancelGesture}
          onKeyDown={(event) => {
            if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || active === undefined) return;
            if (event.key === "Escape") {
              if (gesture.current !== null) { event.preventDefault(); cancelGesture(); }
              return;
            }
            const next = event.key === "ArrowLeft" ? { x: Math.max(0, cursor.x - 1), y: cursor.y }
              : event.key === "ArrowRight" ? { x: Math.min(active.width - 1, cursor.x + 1), y: cursor.y }
              : event.key === "ArrowUp" ? { x: cursor.x, y: Math.max(0, cursor.y - 1) }
              : event.key === "ArrowDown" ? { x: cursor.x, y: Math.min(active.height - 1, cursor.y + 1) }
              : null;
            if (next !== null) {
              event.preventDefault();
              setCursor(next);
              return;
            }
            if ((event.key === " " || event.key === "Enter") && canPaint && !event.repeat) {
              event.preventDefault();
              submit([{ x: cursor.x, y: cursor.y, rgba: brushRgba(color, erase) }]);
            }
          }}
        />
        <p id={`${ids}-instructions`} class="tkr-tileset-art-instructions">{active.width} × {active.height} pixels, enlarged for editing. Arrows move the cursor; Space or Enter paints; Escape cancels a stroke.</p>
      </div>}
      {canvasIssue === null ? null : <p class="tkr-tileset-art-error" role="alert">Pixel canvas unavailable: {canvasIssue}</p>}
      {editNotice === null ? null : <p class="tkr-tileset-art-error" role="alert">{editNotice}</p>}
      {refusal === null ? null : <p class="tkr-tileset-art-error" role="alert">The paint command was refused or failed: {refusal}</p>}
      <p class="tkr-tileset-art-state" role="status">{snapshot.saving || savePending ? "Saving…" : snapshot.dirty ? "Unsaved changes" : "All changes saved"}</p>
      <button type="button" disabled={saveDisabled} onClick={() => {
        setSavePending(true);
        void doc.save().then((result) => {
          setSaveError(result.ok ? null : result.failure.message);
        }).catch((error: unknown) => setSaveError(error instanceof Error ? error.message : String(error))).finally(() => setSavePending(false));
      }}>Save</button>
      {saveError === null ? null : <p class="tkr-tileset-art-error" role="alert">{saveError}</p>}
    </section>
  );
}
