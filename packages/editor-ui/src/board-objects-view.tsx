import { createEditTracker, sameStoredValue } from "@tk-reawakened/editor-model";
import type { BoardDocumentSnapshot, BoardObjectKind, BoardObjectSelection, PendingEdits, SetBoardFieldsCommand } from "@tk-reawakened/editor-model";
import { coordLayout, pixelToTile, tileToPixel } from "@tk-reawakened/core";
import type { BoardImage, BoardPoint, BoardProgram, BoardSprite, BoardVector } from "@tk-reawakened/core";
import type { Colorref } from "@tk-reawakened/core";
import type { DocumentEdited } from "@tk-reawakened/platform-services";
import { useEffect, useRef, useState } from "preact/hooks";
import type { BoardViewDocument } from "./mount.ts";

let inspectorsMade = 0;

export interface BoardObjectsNavigation {
  open(path: string): Promise<string | null>;
  pickAsset(kind: "program" | "sprite" | "image", current: string): Promise<string | null>;
}

export interface BoardObjectsViewProps {
  readonly doc: BoardViewDocument;
  readonly snapshot: BoardDocumentSnapshot;
  readonly mode: BoardObjectKind;
  readonly selection: BoardObjectSelection | null;
  readonly pointSelection: readonly number[];
  readonly disabled: boolean;
  readonly pendingEdits: PendingEdits;
  readonly onEdited: (event: DocumentEdited) => void;
  readonly onSelect: (index: number | null) => void;
  readonly onReturnToDraft: (selection: BoardObjectSelection) => void;
  readonly onSelectPoints: (indices: readonly number[]) => void;
  readonly onCreate: () => Promise<boolean>;
  readonly onDelete: () => Promise<boolean>;
  readonly onReorder: (index: number) => Promise<boolean>;
  readonly onPickTransparent: (accept: (colour: Colorref) => void) => void;
  readonly navigation?: BoardObjectsNavigation;
}

type RecordValue = BoardVector | BoardProgram | BoardSprite | BoardImage;
type RecordFields = BoardVector & BoardProgram & BoardSprite & BoardImage;
const arrays = (snapshot: BoardDocumentSnapshot, mode: BoardObjectKind): readonly RecordValue[] => snapshot[mode];
const labels: Record<BoardObjectKind, string> = { vectors: "Vector", programs: "Program", sprites: "Sprite", images: "Image" };
const flag = (value: number, bit: number): boolean => (value & bit) !== 0;
const withFlag = (value: number, bit: number, enabled: boolean): number => enabled ? value | bit : value & ~bit;
const asInt = (value: string): number => value.trim() === "" ? Number.NaN : Number(value);

export function BoardObjectsView(props: BoardObjectsViewProps) {
  const { doc, snapshot, mode, selection, pointSelection, disabled, pendingEdits, onEdited, onSelect, onReturnToDraft, onSelectPoints, onCreate, onDelete, onReorder, onPickTransparent, navigation } = props;
  const submitted = useRef(createEditTracker());
  useEffect(() => pendingEdits.register(submitted.current), [pendingEdits]);
  const records = arrays(snapshot, mode);
  const selectedIndex = selection?.kind === mode ? selection.index : null;
  const source = selectedIndex === null ? undefined : records[selectedIndex];
  const [titleId] = useState(() => `tkr-board-object-remove-${++inspectorsMade}`);
  const [draft, setDraft] = useState<RecordValue | null>(source ?? null);
  const [draftOwner, setDraftOwner] = useState({ kind: mode, index: selectedIndex });
  const sourceBaseline = useRef<RecordValue | null>(source ?? null);
  const [dirty, setDirty] = useState(false);
  const [positionUnits, setPositionUnits] = useState<"pixels" | "tiles">("pixels");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!dirty) {
      sourceBaseline.current = source ?? null;
      setDraft(source ?? null);
      setDraftOwner({ kind: mode, index: selectedIndex });
    }
  }, [source, selectedIndex, mode, dirty]);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (confirm && !element.open) element.showModal();
    else if (!confirm && element.open) element.close();
  }, [confirm]);
  const update = <K extends keyof RecordFields>(key: K, value: RecordFields[K]): void => {
    setDirty(true);
    setDraft((current) => current === null ? current : { ...current, [key]: value } as RecordValue);
  };
  const apply = async (): Promise<void> => {
    if (draft === null || selectedIndex === null || disabled) return;
    if (draftOwner.kind !== mode || draftOwner.index !== selectedIndex) { setMessage("Selection changed while this draft was open. Re-select its original object before applying."); return; }
    const latest = doc.getSnapshot();
    const currentSource = latest[mode][selectedIndex];
    if (sourceBaseline.current === null || currentSource === undefined || !sameStoredValue(currentSource, sourceBaseline.current)) {
      setMessage("This object changed while the draft was open. Discard the draft or refresh the selection before applying.");
      return;
    }
    if ("layer" in sourceBaseline.current && "layer" in draft && draft.layer !== sourceBaseline.current.layer
      && (!Number.isInteger(draft.layer) || draft.layer < 1 || draft.layer > latest.layers)) {
      setMessage(`Layer must be between 1 and ${latest.layers}.`);
      return;
    }
    if ("type" in draft && draft.type === 8 && "attributes" in sourceBaseline.current && "attributes" in draft
      && (sourceBaseline.current.type !== 8 || draft.attributes !== sourceBaseline.current.attributes)
      && (!Number.isInteger(draft.attributes) || draft.attributes < 1 || draft.attributes > latest.layers)) {
      setMessage(`Stairs target layer must be between 1 and ${latest.layers}.`);
      return;
    }
    const finish = submitted.current.begin();
    setSaving(true); setMessage(null);
    try {
      const result = await doc.apply({ type: "set-board-fields", fields: { [mode]: latest[mode].map((record, index) => index === selectedIndex ? draft : record) } as SetBoardFieldsCommand["fields"] });
      if (!result.ok) { setMessage(result.rejection.message); return; }
      const edit = doc.getSnapshot().edits.find((entry) => entry.editId === result.editId);
      onEdited({ document: doc.identity.key, editId: result.editId, label: edit?.label ?? `Edit ${labels[mode].toLowerCase()}` });
      sourceBaseline.current = draft;
      setDirty(false);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { finish(); setSaving(false); }
  };
  const input = (label: string, value: string | number, change: (value: string) => void, numeric = false) => <label class="tkr-board-object-field">{label}{numeric ? <input aria-label={label} type="number" value={String(value)} disabled={disabled || saving} onInput={(event) => { setDirty(true); change(event.currentTarget.value); }} /> : <input aria-label={label} type="text" value={String(value)} disabled={disabled || saving} onInput={(event) => { setDirty(true); change(event.currentTarget.value); }} />}</label>;
  const pointTable = (points: readonly BoardPoint[]) => <fieldset class="tkr-board-object-points"><legend>Points (board pixels)</legend>{points.map((point, index) => <fieldset key={index}><legend>Point {index + 1}</legend><label><input type="checkbox" aria-label={`Select point ${index + 1}`} checked={pointSelection.includes(index)} disabled={disabled} onChange={(event) => onSelectPoints(event.currentTarget.checked ? [...pointSelection, index] : pointSelection.filter((selected) => selected !== index))} />Select</label>{(["x", "y"] as const).map((axis) => <label>{axis.toUpperCase()}<input aria-label={`Point ${index + 1} ${axis.toUpperCase()}`} type="number" value={point[axis]} disabled={disabled || saving} onInput={(event) => { const value = asInt(event.currentTarget.value); setDirty(true); setDraft((current) => { if (current === null || !("points" in current)) return current; const next = current.points.map((p, i) => i === index ? { ...p, [axis]: value } : p); return { ...current, points: next } as RecordValue; }); }} /></label>)}</fieldset>)}</fieldset>;
  const check = (label: string, checked: boolean, change: (checked: boolean) => void) => <label><input type="checkbox" aria-label={label} checked={checked} disabled={disabled || saving} onChange={(event) => { setDirty(true); change(event.currentTarget.checked); }} />{label}</label>;
  const linkedInput = async (kind: "program" | "sprite" | "image", value: string, set: (value: string) => void) => {
    const picked = await navigation?.pickAsset(kind, value);
    if (picked !== null && picked !== undefined) { setDirty(true); set(picked); }
  };
  const openLink = async (value: string): Promise<void> => {
    if (value === "" || navigation === undefined) return;
    try { setMessage(await navigation.open(value)); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  const conditional = (record: BoardProgram | BoardSprite) => <fieldset><legend>Conditional activation</legend>{input("Run if variable", record.initialVar, (v) => update("initialVar", v as never))}{input("Run if value", record.initialValue, (v) => update("initialValue", v as never))}{input("Then set variable", record.finalVar, (v) => update("finalVar", v as never))}{input("Then set value", record.finalValue, (v) => update("finalValue", v as never))}{check("Conditional", record.activate !== 0, (on) => update("activate", on ? 1 : 0))}{mode === "programs" && <button type="button" disabled={disabled || saving} onClick={() => { const id = globalThis.crypto.randomUUID().replaceAll("-", ""); setDirty(true); setDraft((current) => current && "initialVar" in current ? { ...current, initialVar: id, initialValue: "", finalVar: id, finalValue: "_guid", activate: 1 } : current); }}>Run once</button>}</fieldset>;
  const render = () => {
    if (draft === null || draftOwner.kind !== mode || draftOwner.index !== selectedIndex) return null;
    if (mode === "vectors") {
      const v = draft as BoardVector;
      return <>{input("Handle", v.handle, (x) => update("handle", x))}<label>Type<select aria-label="Type" value={v.type} disabled={disabled || saving} onChange={(e) => { setDirty(true); update("type", Number(e.currentTarget.value)); }}><option value="0">None</option><option value="1">Solid</option><option value="2">Under</option><option value="8">Stairs</option><option value="16">Waypoint</option>{v.type === 4 && <option value="4" disabled>Deprecated unidirectional (loaded)</option>}</select></label>{check("Closed", v.closed !== 0, (on) => update("closed", on ? (v.closed || -1) : 0))}{input("Layer", v.layer, (x) => update("layer", asInt(x)), true)}{v.type === 2 && <fieldset><legend>Under options</legend>{([1, 2, 4] as const).map((bit, i) => check(["Include background", "All lower layers", "Frame intersection trigger"][i]!, flag(v.attributes, bit), (on) => update("attributes", withFlag(v.attributes, bit, on))))}</fieldset>}{v.type === 8 && input("Stairs target layer", v.attributes, (x) => update("attributes", asInt(x)), true)}{pointTable(v.points)}</>;
    }
    if (mode === "programs") {
      const p = draft as BoardProgram;
      const inline = !/\.prg$/i.test(p.program);
      return <>{inline ? <label class="tkr-board-object-field">Inline RPGCode<textarea aria-label="Inline RPGCode" value={p.program} disabled={disabled || saving} onInput={(event) => { setDirty(true); update("program", event.currentTarget.value as never); }} /></label> : input("Program file", p.program, (x) => update("program", x as never))}<button type="button" disabled={disabled || saving || !navigation} onClick={() => void linkedInput("program", p.program, (x) => update("program", x as never))}>Choose program</button><button type="button" disabled={disabled || saving || !navigation || inline} onClick={() => void openLink(p.program)}>Open program</button>{input("Layer", p.layer, (x) => update("layer", asInt(x) as never), true)}<label>Trigger<select aria-label="Trigger" value={p.activationType & 1} disabled={disabled || saving} onChange={(e) => { setDirty(true); update("activationType", (p.activationType & ~1) | Number(e.currentTarget.value) as never); }}><option value="0">Step on</option><option value="1">Key press</option></select></label>{check("Repeat while inside", flag(p.activationType, 2), (on) => update("activationType", withFlag(p.activationType, 2, on) as never))}{check("Stop movement", flag(p.activationType, 4), (on) => update("activationType", withFlag(p.activationType, 4, on) as never))}{input("Repeat distance (pixels)", p.repeatDistance, (x) => update("repeatDistance", asInt(x) as never), true)}{conditional(p)}{pointTable(p.points)}</>;
    }
    if (mode === "sprites") {
      const s = draft as BoardSprite;
      const layout = coordLayout(snapshot.coordType);
      const tile = pixelToTile(layout, snapshot.sizeX, s.x, s.y);
      const setTilePosition = (column: number, row: number): void => {
        if (!Number.isInteger(column) || !Number.isInteger(row)) {
          setMessage("Tile positions use whole columns and rows. Choose Pixels for free positioning.");
          return;
        }
        const point = tileToPixel(layout, snapshot.sizeX, column, row);
        setDirty(true);
        setDraft({ ...s, x: point.x, y: point.y });
      };
      const positionInputs = positionUnits === "tiles"
        ? <>{input("X tile", tile.x, (x) => setTilePosition(asInt(x), tile.y), true)}{input("Y tile", tile.y, (y) => setTilePosition(tile.x, asInt(y)), true)}</>
        : <>{input("X pixel (bottom-centre)", s.x, (x) => update("x", asInt(x)), true)}{input("Y pixel (bottom-centre)", s.y, (x) => update("y", asInt(x)), true)}</>;
      return <><p>This placement owns its program overrides. Item graphics are shared; other uses may be unknown.</p>{input("Item definition", s.itemFile, (x) => update("itemFile", x))}<button type="button" disabled={disabled || saving || !navigation} onClick={() => void linkedInput("sprite", s.itemFile, (x) => update("itemFile", x))}>Choose item</button><button type="button" disabled={disabled || saving || !navigation || !s.itemFile} onClick={() => void openLink(s.itemFile)}>Open item</button><label>Position units<select aria-label="Position units" value={positionUnits} disabled={disabled || saving} onChange={(event) => setPositionUnits(event.currentTarget.value as "pixels" | "tiles")}><option value="pixels">Pixels</option><option value="tiles">Tiles</option></select></label>{positionInputs}{input("Layer", s.layer, (x) => update("layer", asInt(x)), true)}
        <fieldset><legend>Local placement programs</legend>
          {input("Activation program override", s.activationPrg, (x) => update("activationPrg", x))}<button type="button" disabled={disabled || saving || !navigation} onClick={() => void linkedInput("program", s.activationPrg, (x) => update("activationPrg", x))}>Choose activation program</button><button type="button" disabled={disabled || saving || !navigation || !s.activationPrg} onClick={() => void openLink(s.activationPrg)}>Open activation program</button>
          {input("Multitask program override", s.multitaskPrg, (x) => update("multitaskPrg", x))}<button type="button" disabled={disabled || saving || !navigation} onClick={() => void linkedInput("program", s.multitaskPrg, (x) => update("multitaskPrg", x))}>Choose parallel program</button><button type="button" disabled={disabled || saving || !navigation || !s.multitaskPrg} onClick={() => void openLink(s.multitaskPrg)}>Open parallel program</button>
        </fieldset>
        <label>Trigger<select aria-label="Trigger" value={s.activationType & 1} disabled={disabled || saving} onChange={(e) => { setDirty(true); update("activationType", (s.activationType & ~1) | Number(e.currentTarget.value)); }}><option value="0">Step on</option><option value="1">Key press</option></select></label>{input("Show when board loads if variable", s.loadingVar, (x) => update("loadingVar", x))}{input("Show when board loads if value", s.loadingValue, (x) => update("loadingValue", x))}{conditional(s)}</>;
    }
    const image = draft as BoardImage;
    return <>{input("Image file", image.file, (x) => update("file", x as never))}<button type="button" disabled={disabled || saving || !navigation} onClick={() => void linkedInput("image", image.file, (x) => update("file", x as never))}>Choose image</button><button type="button" disabled={disabled || saving || !navigation || !/\.tbm$/i.test(image.file)} onClick={() => void openLink(image.file)}>Open image</button>{image.file !== "" && !/\.tbm$/i.test(image.file) ? <p>Only tile-bitmap (.tbm) images can be opened here. Other picture formats can be replaced with Choose image.</p> : null}{input("Left (pixels)", image.left, (x) => update("left", asInt(x as never)), true)}{input("Top (pixels)", image.top, (x) => update("top", asInt(x as never)), true)}{input("Layer", image.layer, (x) => update("layer", asInt(x as never)), true)}<fieldset><legend>Transparent RGB</legend>{(["r", "g", "b"] as const).map((channel) => input(channel.toUpperCase(), image.transparent[channel], (x) => update("transparent", { ...image.transparent, [channel]: asInt(x) } as never)))}<button type="button" disabled={disabled || saving} onClick={() => onPickTransparent((colour) => { setDirty(true); update("transparent", colour as never); })}>Pick colour from canvas</button></fieldset></>;
  };
  const ownerMatches = draftOwner.kind === mode && draftOwner.index === selectedIndex;
  return (
    <section class="tkr-board-objects" aria-label={`${labels[mode]} inspector`}>
      <header>
        <h2>{labels[mode]}s</h2>
        <button type="button" disabled={disabled || saving || dirty} onClick={() => void onCreate()}>Add {labels[mode].toLowerCase()}</button>
      </header>
      <label>Stored slot
        <select aria-label="Stored slot" value={selectedIndex ?? ""} disabled={disabled || saving || dirty}
          onChange={(event) => onSelect(event.currentTarget.value === "" ? null : Number(event.currentTarget.value))}>
          <option value="">No selection</option>
          {records.map((_, index) => <option key={index} value={index}>{labels[mode]} slot {index}</option>)}
        </select>
      </label>
      {dirty && !ownerMatches ? <p role="status">An unapplied {labels[draftOwner.kind].toLowerCase()} draft belongs to stored slot {draftOwner.index}.
        {draftOwner.index === null ? null : <button type="button" disabled={disabled || saving} onClick={() => onReturnToDraft({ kind: draftOwner.kind, index: draftOwner.index! })}>Return to draft</button>}
        Or discard this draft.</p> : null}
      {selectedIndex !== null && source ? <>
        <div class="tkr-board-object-actions">
          <button type="button" disabled={disabled || saving || dirty || selectedIndex === 0} onClick={() => void onReorder(selectedIndex - 1)}>Move up</button>
          <button type="button" disabled={disabled || saving || dirty || selectedIndex === records.length - 1} onClick={() => void onReorder(selectedIndex + 1)}>Move down</button>
          <button type="button" disabled={disabled || saving || dirty} onClick={() => setConfirm(true)}>Remove slot and renumber</button>
        </div>
        <div class="tkr-board-object-form">
          {render()}
          <button type="button" disabled={disabled || saving || !dirty || !ownerMatches} onClick={() => void apply()}>Apply</button>
        </div>
      </> : null}
      {dirty ? <button type="button" disabled={saving} onClick={() => { sourceBaseline.current = source === undefined ? null : structuredClone(source); setDraft(source ?? null); setDirty(false); setMessage(null); }}>Discard draft</button> : null}
      {message === null ? null : <p role="status">{message}</p>}
      <dialog ref={dialog} aria-labelledby={titleId} onClose={() => setConfirm(false)}>
        <h2 id={titleId}>Remove {labels[mode].toLowerCase()} slot?</h2>
        <p>Removing this slot renumbers every later stored {labels[mode].toLowerCase()} index. Undo restores the removed slot and its order.</p>
        <form method="dialog">
          <button type="submit" value="cancel" autofocus>Cancel</button>
          <button type="button" disabled={disabled || saving} onClick={async () => {
            setConfirm(false);
            if (await onDelete()) { setDirty(false); setDraft(null); }
          }}>Remove and renumber</button>
        </form>
      </dialog>
    </section>
  );
}
