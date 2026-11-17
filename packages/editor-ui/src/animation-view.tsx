import { createEditTracker, animationTileBitmapBytes, type PendingEdits, type AnimationFrame, type AnimationAuthoring } from "@tk-reawakened/editor-model";
import { CheckpointView } from "./checkpoint-view.tsx";
import { ANIMATION_FRAME_LIMIT, listCandidates, reservedFolder, spriteAnimationCanvasPreview, spriteGifPreview, spritePicturePreview, spriteProjectAssetPath, spriteTileBitmapPreviewFromAssets, spriteTileFrameFromReference, unusableName, type AnimationCommand, type AnimationDocumentSnapshot, type AssetCandidate } from "@tk-reawakened/editor-model";
import type { DocumentEdited, FileSystemService } from "@tk-reawakened/platform-services";
import { useEffect, useRef, useState } from "preact/hooks";
import type { BrowserSelection } from "./brush.ts";
import type { ViewDocument } from "./mount.ts";
import { TilesetBrowser, type TilesetBrowserContext } from "./tileset-browser.tsx";
import { useDocumentSnapshot } from "./use-document.ts";

export interface AnimationViewDocument extends ViewDocument<AnimationDocumentSnapshot, AnimationCommand> {}

export interface AnimationViewProps {
  readonly doc: AnimationViewDocument;
  readonly pendingEdits: PendingEdits;
  readonly fs: Pick<FileSystemService, "readProject">;
  readonly authoring?: AnimationAuthoring;
  readonly onEdited: (event: DocumentEdited) => void;
  readonly browser?: TilesetBrowserContext;
}

const EMPTY_FRAME: AnimationFrame = { image: "", transparent: { r: 255, g: 0, b: 255 }, sound: "" };
const GIF = /\.gif$/i;
const BITMAP = /\.(?:bmp|gif|jpe?g|png|tbm)$/i;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function frameFrom(candidate: AssetCandidate): AnimationFrame {
  return { image: candidate.reference, transparent: { ...EMPTY_FRAME.transparent }, sound: "" };
}
function topLeftKey(picture: { readonly rgba: Uint8Array }): { readonly r: number; readonly g: number; readonly b: number } {
  return { r: picture.rgba[0] ?? 0, g: picture.rgba[1] ?? 0, b: picture.rgba[2] ?? 0 };
}

/** Story 12.7: author a binary animation in the shared view, with staged image and 4×4 TBM wizards. */
export function AnimationView({ doc, fs, authoring, onEdited, browser, pendingEdits }: AnimationViewProps) {
  const snapshot = useDocumentSnapshot(doc);
  const submitted = useRef(createEditTracker());
  const queue = useRef(Promise.resolve());
  // Cancelling or replacing preparation invalidates its outstanding asset reads (#2817).
  const imagePreparation = useRef(0);
  const tilePreparation = useRef(0);
  useEffect(() => () => { imagePreparation.current++; tilePreparation.current++; }, []);
  useEffect(() => pendingEdits.register(submitted.current), [pendingEdits]);
  const [busy, setBusy] = useState(false);
  const [recoveryVersion, setRecoveryVersion] = useState(0);
  const [imageOrder, setImageOrder] = useState<readonly AssetCandidate[]>([]);
  const [selected, setSelected] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [typed, setTyped] = useState<Readonly<Partial<Record<"image" | "sound" | "red" | "green" | "blue" | "width" | "height" | "delay", string>>>>({});
  const [preview, setPreview] = useState<{ readonly width: number; readonly height: number; readonly rgba: Uint8Array } | null>(null);
  const [imageCandidates, setImageCandidates] = useState<readonly AssetCandidate[]>([]);
  const [imageSelection, setImageSelection] = useState<ReadonlySet<string>>(new Set());
  const [imagesOpen, setImagesOpen] = useState(false);
  const [tileOpen, setTileOpen] = useState(false);
  const [tileName, setTileName] = useState("");
  const [tileCell, setTileCell] = useState(0);
  const [tileCells, setTileCells] = useState<readonly string[]>(new Array<string>(16).fill(""));
  const [stagedTile, setStagedTile] = useState<{ readonly name: string; readonly path: string; readonly bytes: Uint8Array; readonly picture: { readonly width: number; readonly height: number; readonly rgba: Uint8Array } } | null>(null);
  const [tileFrames, setTileFrames] = useState<readonly NonNullable<typeof stagedTile>[]>([]);
  const [brush, setBrush] = useState<BrowserSelection | null>(browser?.session.getSnapshot().selection ?? null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tileCanvas = useRef<HTMLCanvasElement>(null);
  const currentIndex = Math.max(0, Math.min(selected, Math.max(0, snapshot.frames.length - 1)));
  const current = snapshot.frames[currentIndex] ?? EMPTY_FRAME;
  const readOnly = snapshot.readOnly !== null;
  const identity = doc.identity;
  const folder = browser === undefined ? "Bitmap" : reservedFolder(browser.layout, "bitmaps");

  useEffect(() => browser?.session.subscribe(() => setBrush(browser.session.getSnapshot().selection)) ?? undefined, [browser]);
  useEffect(() => {
    if (!playing) return;
    const populated = snapshot.frames.map((frame, index) => frame.image === "" ? -1 : index).filter((index) => index >= 0);
    if (populated.length === 0) { setPlaying(false); return; }
    const timer = globalThis.setInterval(() => setSelected((index) => {
      const at = populated.indexOf(index);
      return populated[(at + 1 + populated.length) % populated.length] ?? populated[0] ?? 0;
    }), Math.max(16, snapshot.delay * 1000));
    return () => globalThis.clearInterval(timer);
  }, [playing, snapshot.frames, snapshot.delay]);

  useEffect(() => {
    let active = true;
    const reference = current.image.trim();
    if (reference === "") { setPreview(null); return () => { active = false; }; }
    const load = async (path: string): Promise<Uint8Array | null> => {
      const read = await fs.readProject(identity.projectId, path);
      return read.ok ? read.value : null;
    };
    void (async () => {
      let source: { readonly width: number; readonly height: number; readonly rgba: Uint8Array } | null = null;
      if (BITMAP.test(reference)) {
        const path = spriteProjectAssetPath(folder, reference);
        const bytes = await load(path);
        if (bytes !== null && reference.toLowerCase().endsWith(".tbm")) source = await spriteTileBitmapPreviewFromAssets(bytes, path, load);
        else if (bytes !== null && GIF.test(reference)) source = spriteGifPreview(bytes, path)?.frames[0] ?? null;
        else if (bytes !== null) source = spritePicturePreview(bytes, path);
      } else source = await spriteTileFrameFromReference(reference, load);
      if (active) setPreview(source === null ? null : spriteAnimationCanvasPreview(source, snapshot.width, snapshot.height, current.transparent, BITMAP.test(reference)));
    })().catch((error: unknown) => { if (active) setMessage(`Frame preview unavailable: ${errorMessage(error)}`); });
    return () => { active = false; };
  }, [current.image, current.transparent, folder, fs, identity.projectId, snapshot.width, snapshot.height]);

  useEffect(() => {
    const target = canvas.current;
    if (target === null || preview === null || typeof ImageData === "undefined") return;
    const context = target.getContext("2d");
    if (context === null) return;
    target.width = preview.width;
    target.height = preview.height;
    context.putImageData(new ImageData(new Uint8ClampedArray(preview.rgba), preview.width, preview.height), 0, 0);
  }, [preview]);
  useEffect(() => {
    const target = tileCanvas.current;
    if (target === null || stagedTile === null || typeof ImageData === "undefined") return;
    const context = target.getContext("2d");
    if (context === null) return;
    target.width = stagedTile.picture.width;
    target.height = stagedTile.picture.height;
    context.putImageData(new ImageData(new Uint8ClampedArray(stagedTile.picture.rgba), target.width, target.height), 0, 0);
  }, [stagedTile]);

  useEffect(() => {
    if (!imagesOpen || browser === undefined) return;
    let active = true;
    void listCandidates(browser.fs, browser.layout, "bitmaps", [".bmp", ".gif", ".jpeg", ".jpg", ".png"]).then(({ candidates, failures }) => {
      if (!active) return;
      setImageCandidates(candidates);
      if (failures.length > 0) setMessage(`Some image folders could not be read: ${failures.map(({ path }) => path).join(", ")}`);
    }).catch((error: unknown) => { if (active) setMessage(errorMessage(error)); });
    return () => { active = false; };
  }, [imagesOpen, browser]);

  const run = (command: AnimationCommand | (() => AnimationCommand)): Promise<boolean> => {
    const finish = submitted.current.begin();
    const operation = queue.current.then(async () => {
      try {
        const result = await doc.apply(typeof command === "function" ? command() : command);
        if (!result.ok) { setMessage(result.rejection.message); return false; }
        const edit = doc.getSnapshot().edits.find((entry) => entry.editId === result.editId);
        onEdited({ document: doc.identity.key, editId: result.editId, label: edit?.label ?? "Edit the animation" });
        setMessage(null); return true;
      } catch (error) { setMessage(errorMessage(error)); return false; }
      finally { finish(); }
    });
    queue.current = operation.then(() => undefined);
    return operation;
  };
  const save = async (): Promise<boolean> => {
    try {
      await pendingEdits.settle();
      const result = await doc.save();
      if (!result.ok) { setMessage(result.failure.message); return false; }
      setMessage("Animation saved.");
      return true;
    } catch (error) { setMessage(errorMessage(error)); return false; }
  };
  const updateFrame = async (field: "image" | "sound" | "red" | "green" | "blue", text: string): Promise<void> => {
    if (["red", "green", "blue"].includes(field)) {
      const value = Number(text);
      if (!Number.isInteger(value) || value < 0 || value > 255) { setMessage("Transparency key channels must be whole numbers from 0 to 255."); return; }
      const channel = field === "red" ? "r" : field === "green" ? "g" : "b";
      await run(() => { const frame = doc.getSnapshot().frames[currentIndex] ?? EMPTY_FRAME; return { type: "set-animation-frame", index: currentIndex, frame: { ...frame, transparent: { ...frame.transparent, [channel]: value } } }; });
    } else await run(() => ({ type: "set-animation-frame", index: currentIndex, frame: { ...(doc.getSnapshot().frames[currentIndex] ?? EMPTY_FRAME), [field]: text } }));
    setTyped((previous) => { const next = { ...previous }; if (next[field] === text) delete next[field]; return next; });
  };
  const scalar = async (field: "width" | "height" | "delay", text: string): Promise<void> => {
    const value = Number(text);
    if (!Number.isFinite(value)) { setMessage(`${field} must be a number.`); return; }
    const success = field === "delay"
      ? await run({ type: "set-animation-delay", delay: value })
      : await run(() => ({ type: "set-animation-canvas", width: field === "width" ? value : doc.getSnapshot().width, height: field === "height" ? value : doc.getSnapshot().height }));
    if (success) setTyped((previous) => { const next = { ...previous }; if (next[field] === text) delete next[field]; return next; });
  };
  const typeValue = (field: keyof typeof typed): string => typed[field] ?? String(field === "red" ? current.transparent.r : field === "green" ? current.transparent.g : field === "blue" ? current.transparent.b : field === "image" || field === "sound" ? current[field] : snapshot[field]);
  const stageImages = async (): Promise<void> => {
    const preparation = ++imagePreparation.current;
    const selectedCandidates = imageOrder;
    if (selectedCandidates.length === 0) { setMessage("Select at least one image frame."); return; }
    if (snapshot.frames.length + selectedCandidates.length > ANIMATION_FRAME_LIMIT) { setMessage(`The selected images would exceed the ${ANIMATION_FRAME_LIMIT}-frame animation limit.`); return; }
    const staged: { readonly frame: AnimationFrame; readonly picture: { readonly width: number; readonly height: number } }[] = [];
    for (const candidate of selectedCandidates) {
      const read = await fs.readProject(identity.projectId, candidate.path);
      if (preparation !== imagePreparation.current) return;
      if (!read.ok) { setMessage(`Could not read ${candidate.path}: ${read.error.message}`); return; }
      const gif = GIF.test(candidate.path) ? spriteGifPreview(read.value, candidate.path) : null;
      const picture = gif?.frames[0] ?? (gif === null ? spritePicturePreview(read.value, candidate.path) : null);
      if (picture === null) { setMessage(`Could not decode image frame: ${candidate.path}`); return; }
      staged.push({ frame: { ...frameFrom(candidate), transparent: topLeftKey(picture) }, picture });
    }
    const frames = [...snapshot.frames.slice(0, currentIndex), ...staged.map(({ frame }) => frame), ...snapshot.frames.slice(currentIndex)];
    const firstAdded = staged[0]!;
    const empty = snapshot.frames.length === 0;
    if (authoring === undefined) { setMessage("This host does not provide persistent animation creation."); return; }
    setBusy(true);
    try {
      const result = await authoring.commitAnimation({ type: "replace-animation", frames, width: empty ? firstAdded.picture.width : snapshot.width, height: empty ? firstAdded.picture.height : snapshot.height, delay: snapshot.delay }, []);
      if (!result.ok) { setMessage(result.error.message); return; }
      setRecoveryVersion((value) => value + 1);
      if (result.value.files.some((file) => file.status !== "written")) { setMessage("Creation stopped. Review project recovery and retry remaining files."); return; }
      setSelected(currentIndex); setImagesOpen(false); setImageSelection(new Set()); setImageOrder([]);
      setMessage("Animation created and saved.");
    } finally { setBusy(false); }
  };
  const stageTileBitmap = async (): Promise<void> => {
    const preparation = ++tilePreparation.current;
    if (browser === undefined || authoring === undefined) { setMessage("This host cannot create project tile bitmaps."); return; }
    if (snapshot.frames.length + tileFrames.length >= ANIMATION_FRAME_LIMIT) { setMessage(`The animation already has ${ANIMATION_FRAME_LIMIT} frames.`); return; }
    if (tileCells.some((tile) => tile === "")) { setMessage("Choose a tile for each of the 16 cells."); return; }
    const invalidName = unusableName(/\.tbm$/i.test(tileName) ? tileName : `${tileName}.tbm`);
    if (tileName.trim() === "" || invalidName !== null) { setMessage(invalidName ?? "Give the tile bitmap a name."); return; }
    const name = /\.tbm$/i.test(tileName) ? tileName.trim() : `${tileName.trim()}.tbm`;
    const path = `${folder}/${name}`;
    const bytes = animationTileBitmapBytes(tileCells);
    if (bytes === null) { setMessage("The 4×4 tile bitmap could not be encoded."); return; }
    const load = async (assetPath: string): Promise<Uint8Array | null> => {
      const result = await fs.readProject(identity.projectId, assetPath);
      return result.ok ? result.value : null;
    };
    const picture = await spriteTileBitmapPreviewFromAssets(bytes, path, load);
    if (preparation !== tilePreparation.current) return;
    if (picture === null) { setMessage("Could not resolve all tiles in the staged 4×4 bitmap."); return; }
    setStagedTile({ name, path, bytes, picture });
    setMessage(`Staged ${path} (${picture.width} × ${picture.height} pixels). Confirm to create and insert it.`);
  };
  const confirmTileBitmap = async (): Promise<void> => {
    if (authoring === undefined) return;
    const staged = [...tileFrames, ...(stagedTile === null ? [] : [stagedTile])];
    if (staged.length === 0) { setMessage("Stage at least one tile composition."); return; }
    const empty = snapshot.frames.length === 0;
    const frames = [...snapshot.frames.slice(0, currentIndex), ...staged.map((tile) => ({ image: tile.name, transparent: topLeftKey(tile.picture), sound: "" })), ...snapshot.frames.slice(currentIndex)];
    setBusy(true);
    try {
      const result = await authoring.commitAnimation({ type: "replace-animation", frames, width: empty ? staged[0]!.picture.width : snapshot.width, height: empty ? staged[0]!.picture.height : snapshot.height, delay: snapshot.delay }, staged);
      if (!result.ok) { setMessage(result.error.message); return; }
      setRecoveryVersion((value) => value + 1);
      if (result.value.files.some((file) => file.status !== "written")) { setMessage("Creation stopped. Review project recovery and retry remaining files."); return; }
      setSelected(currentIndex); setStagedTile(null); setTileFrames([]); setTileOpen(false);
      setMessage("Tile frames and animation saved.");
    } finally { setBusy(false); }
  };

  const disabled = busy || readOnly || snapshot.conflict !== null || snapshot.saving;
  return <main class="tkr-animation-editor" aria-label="Animation editor">
    <header class="tkr-animation-toolbar">
      <h1>Animation</h1>
      <button type="button" data-editor-save="true" disabled={disabled} onClick={() => void save()}>Save</button>
      <label>Canvas width <input type="number" min="1" step="1" value={typeValue("width")} disabled={disabled} onInput={(event) => { const value = event.currentTarget.value; setTyped((state) => ({ ...state, width: value })); void scalar("width", value); }} /></label>
      <label>Canvas height <input type="number" min="1" step="1" value={typeValue("height")} disabled={disabled} onInput={(event) => { const value = event.currentTarget.value; setTyped((state) => ({ ...state, height: value })); void scalar("height", value); }} /></label>
      <label>Global delay (seconds) <input type="number" min="0" step="0.001" value={typeValue("delay")} disabled={disabled} onInput={(event) => { const value = event.currentTarget.value; setTyped((state) => ({ ...state, delay: value })); void scalar("delay", value); }} /></label>
      <button type="button" disabled={disabled || snapshot.frames.length === 0} onClick={() => setPlaying((value) => !value)}>{playing ? "Stop playback" : "Play"}</button>
    </header>
    {snapshot.readOnly !== null && <p role="status">Read only: {snapshot.readOnly.message}</p>}
    {snapshot.conflict !== null && <p role="alert">Resolve the file conflict before editing this animation.</p>}
    <section class="tkr-animation-timeline" aria-label="Animation frames">
      <button type="button" disabled={disabled || currentIndex === 0} onClick={() => setSelected((index) => Math.max(0, index - 1))}>Previous frame</button>
      <output aria-live="polite">Frame {snapshot.frames.length === 0 ? 0 : currentIndex + 1} of {snapshot.frames.length}</output>
      <button type="button" disabled={disabled || currentIndex + 1 >= snapshot.frames.length} onClick={() => setSelected((index) => Math.min(snapshot.frames.length - 1, index + 1))}>Next frame</button>
      <button type="button" disabled={disabled || snapshot.frames.length >= ANIMATION_FRAME_LIMIT} onClick={() => void run({ type: "insert-animation-frame", index: snapshot.frames.length, frame: { ...EMPTY_FRAME, transparent: { ...EMPTY_FRAME.transparent } } }).then((added) => { if (added) setSelected(snapshot.frames.length); })}>Append frame</button>
      <button type="button" disabled={disabled || snapshot.frames.length >= ANIMATION_FRAME_LIMIT} onClick={() => void run({ type: "insert-animation-frame", index: currentIndex, frame: { ...current, transparent: { ...current.transparent } } })}>Insert before</button>
      <button type="button" disabled={disabled || snapshot.frames.length === 0} onClick={() => void run({ type: "delete-animation-frame", index: currentIndex }).then((deleted) => { if (deleted) setSelected((index) => Math.max(0, index - 1)); })}>Delete frame</button>
      <button type="button" disabled={disabled || currentIndex === 0} onClick={() => void run({ type: "move-animation-frame", from: currentIndex, to: currentIndex - 1 }).then((moved) => { if (moved) setSelected(currentIndex - 1); })}>Move earlier</button>
      <button type="button" disabled={disabled || currentIndex + 1 >= snapshot.frames.length} onClick={() => void run({ type: "move-animation-frame", from: currentIndex, to: currentIndex + 1 }).then((moved) => { if (moved) setSelected(currentIndex + 1); })}>Move later</button>
      {snapshot.frames.map((frame, index) => <button type="button" key={index} aria-current={index === currentIndex ? "true" : undefined} onClick={() => setSelected(index)}>Frame {index + 1}: {frame.image || "empty"}</button>)}
    </section>
    <section class="tkr-animation-frame-editor" aria-label={`Frame ${currentIndex + 1} properties`}>
      <label>Image reference <input value={typeValue("image")} disabled={disabled} onInput={(event) => { const value = event.currentTarget.value; setTyped((state) => ({ ...state, image: value })); void updateFrame("image", value); }} /></label>
      <label>Sound reference <input value={typeValue("sound")} disabled={disabled} onInput={(event) => { const value = event.currentTarget.value; setTyped((state) => ({ ...state, sound: value })); void updateFrame("sound", value); }} /></label>
      <fieldset><legend>Transparency key (RGB)</legend>
        {(["red", "green", "blue"] as const).map((channel) => <label key={channel}>{channel} <input type="number" min="0" max="255" value={typeValue(channel)} disabled={disabled} onInput={(event) => { const value = event.currentTarget.value; setTyped((state) => ({ ...state, [channel]: value })); void updateFrame(channel, value); }} /></label>)}
      </fieldset>
      <div class="tkr-animation-preview">{preview === null ? <p role="status">No frame preview is available.</p> : <canvas ref={canvas} role="img" aria-label={`Animation frame ${currentIndex + 1} preview`} />}</div>
    </section>
    {browser !== undefined && <section class="tkr-animation-wizards" aria-label="Frame creation wizards">
      <details open={imagesOpen} onToggle={(event) => setImagesOpen(event.currentTarget.open)}>
        <summary>Build from sorted Bitmap images</summary>
        <p>Sorted project images are inserted at the current frame. The first inserted image initializes canvas size and transparency key only when the animation is empty.</p>
        <div role="group" aria-label="Sorted project images">
          {imageCandidates.map((candidate) => <label key={candidate.reference}><input type="checkbox" checked={imageSelection.has(candidate.reference)} onChange={(event) => setImageSelection((currentSet) => {
            const next = new Set(currentSet);
            if (event.currentTarget.checked) next.add(candidate.reference); else next.delete(candidate.reference);
            setImageOrder(imageCandidates.filter((entry) => next.has(entry.reference)));
            return next;
          })} />{candidate.reference}</label>)}
        </div>
        <ol aria-label="Staged image order">{imageOrder.map((candidate, index) => <li key={candidate.path}>{candidate.reference}
          <button type="button" disabled={disabled || index === 0} onClick={() => setImageOrder((previous) => { const next = [...previous]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; return next; })}>Move image earlier</button>
          <button type="button" disabled={disabled || index + 1 === imageOrder.length} onClick={() => setImageOrder((previous) => { const next = [...previous]; [next[index], next[index + 1]] = [next[index + 1]!, next[index]!]; return next; })}>Move image later</button>
        </li>)}</ol>
        <p>Destination: {identity.path}</p>
        <button type="button" disabled={disabled || imageCandidates.length === 0} onClick={() => void stageImages()}>Insert selected sorted images</button>
        <button type="button" disabled={busy} onClick={() => { imagePreparation.current++; setImagesOpen(false); setImageSelection(new Set()); setImageOrder([]); }}>Cancel image wizard</button>
      </details>
      <details open={tileOpen} onToggle={(event) => setTileOpen(event.currentTarget.open)}>
        <summary>Compose 4×4 tile bitmap frames</summary>
        <label>New tile bitmap name <input value={tileName} onInput={(event) => setTileName(event.currentTarget.value)} disabled={disabled} /></label>
        <div role="group" aria-label="4 by 4 tile cells">
          {tileCells.map((tile, index) => <button type="button" key={index} aria-pressed={tileCell === index} onClick={() => setTileCell(index)}>Cell {index + 1}: {tile || "empty"}</button>)}
        </div>
        <p>Selected tile: {brush?.boardTile ?? "Choose a complete tile from the shared browser"}</p>
        <button type="button" disabled={disabled || brush?.boardTile === null || brush === null} onClick={() => setTileCells((cells) => cells.map((tile, index) => index === tileCell ? brush?.boardTile ?? "" : tile))}>Put selected tile in cell</button>
        <button type="button" disabled={disabled || authoring === undefined} onClick={() => void stageTileBitmap()}>Stage TBM frame</button>
        {stagedTile !== null && <div role="group" aria-label="Staged tile bitmap frame">
          <p>{stagedTile.path} — {stagedTile.picture.width} × {stagedTile.picture.height} pixels</p>
          <canvas ref={tileCanvas} role="img" aria-label={`Preview of ${stagedTile.path}`} />
          <button type="button" disabled={disabled} onClick={() => { setTileFrames((frames) => [...frames, stagedTile]); setStagedTile(null); setTileName(""); }}>Add composition to sequence and reuse template</button>
          <button type="button" disabled={disabled} onClick={() => void confirmTileBitmap()}>{tileFrames.length === 0 ? "Create TBM and insert frame" : "Create tile sequence including staged frame"}</button>
          <button type="button" disabled={busy} onClick={() => { tilePreparation.current++; setStagedTile(null); setMessage("Staged tile bitmap discarded; no project files were written."); }}>Cancel staged frame</button>
        </div>}
        <ol aria-label="Staged tile frame order">{tileFrames.map((frame, index) => <li key={index}>{frame.path}
          <button type="button" disabled={disabled || index === 0} onClick={() => setTileFrames((previous) => { const next = [...previous]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; return next; })}>Move tile frame earlier</button>
          <button type="button" disabled={disabled} onClick={() => setTileFrames((previous) => previous.filter((_, at) => at !== index))}>Remove staged frame</button>
        </li>)}</ol>
        <p>Animation written last: {identity.path}</p>
        {tileFrames.length > 0 && stagedTile === null && <button type="button" disabled={disabled} onClick={() => void confirmTileBitmap()}>Create tile sequence</button>}
        <button type="button" disabled={busy} onClick={() => { tilePreparation.current++; setTileFrames([]); setTileOpen(false); setTileCells(new Array<string>(16).fill("")); setTileName(""); setStagedTile(null); setMessage(null); }}>Cancel tile wizard</button>
        {browser !== undefined && <TilesetBrowser context={browser} />}
      </details>
    </section>}
    {authoring !== undefined && <CheckpointView groups={authoring} version={recoveryVersion} />}
    {message !== null && <p role="status">{message}</p>}
  </main>;
}
