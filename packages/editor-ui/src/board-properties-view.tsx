import { cellOnBoard, createEditTracker, pixelToCell } from "@tk-reawakened/editor-model";
import type { BoardDocumentSnapshot, PendingEdits, SetBoardFieldsCommand } from "@tk-reawakened/editor-model";
import type { DocumentEdited } from "@tk-reawakened/platform-services";
import { useEffect, useRef, useState } from "preact/hooks";
import type { BoardViewDocument } from "./mount.ts";

export interface BoardPropertiesNavigation {
  open?(path: string): Promise<string | null>;
  returnFromVisit?(): Promise<string | null>;
  setInitialBoard?(path: string): Promise<string | null>;
  readonly initialBoardPath?: string;
}

export interface BoardPropertiesViewProps {
  readonly doc: BoardViewDocument;
  readonly disabled: boolean;
  readonly onEdited: (event: DocumentEdited) => void;
  readonly navigation?: BoardPropertiesNavigation;
  readonly onChooseStart: () => void;
  readonly onSetStart: (column: number, row: number, layer: number) => Promise<boolean>;
  readonly pendingEdits: PendingEdits;
}

export function BoardPropertiesView({ doc, disabled, onEdited, navigation, onChooseStart, onSetStart, pendingEdits }: BoardPropertiesViewProps) {
  const submitted = useRef(createEditTracker());
  useEffect(() => pendingEdits.register(submitted.current), [pendingEdits]);
  const snapshot = doc.getSnapshot();
  const properties = snapshot.properties;
  const initialCell = pixelToCell(snapshot, properties.start.x, properties.start.y);
  const initialColumn = String(initialCell === null ? 1 : initialCell.x + 1);
  const initialRow = String(initialCell === null ? 1 : initialCell.y + 1);
  const [links, setLinks] = useState<BoardDocumentSnapshot["links"]>(snapshot.links);
  const [settings, setSettings] = useState<BoardDocumentSnapshot["properties"]>(properties);
  const [threads, setThreads] = useState(snapshot.threads.join("\n"));
  const [constants, setConstants] = useState(snapshot.constants.join("\n"));
  const [layerTitles, setLayerTitles] = useState(snapshot.layerTitles.join("\n"));
  const [column, setColumn] = useState(initialColumn);
  const [row, setRow] = useState(initialRow);
  const [layer, setLayer] = useState(String(Math.max(1, properties.start.layer)));
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmInitial, setConfirmInitial] = useState(false);
  const [dirtyDraft, setDirtyDraft] = useState(false);
  const initialDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (dirtyDraft) {
      setSettings((current) => ({ ...current, start: snapshot.properties.start }));
      return;
    }
    setLinks(snapshot.links);
    setSettings(snapshot.properties);
    setThreads(snapshot.threads.join("\n"));
    setConstants(snapshot.constants.join("\n"));
    setLayerTitles(snapshot.layerTitles.join("\n"));
    setColumn(initialColumn);
    setRow(initialRow);
    setLayer(String(Math.max(1, snapshot.properties.start.layer)));
  }, [snapshot, dirtyDraft, initialColumn, initialRow]);
  useEffect(() => {
    const dialog = initialDialog.current;
    if (dialog === null) return;
    if (confirmInitial && !dialog.open) dialog.showModal();
    else if (!confirmInitial && dialog.open) dialog.close();
  }, [confirmInitial]);
  const setProperty = <K extends keyof BoardDocumentSnapshot["properties"]>(key: K, value: BoardDocumentSnapshot["properties"][K]): void => {
    setDirtyDraft(true);
    setSettings((current) => ({ ...current, [key]: value }));
  };
  const submit = async (fields: SetBoardFieldsCommand["fields"]): Promise<boolean> => {
    const finish = submitted.current.begin();
    setSaving(true);
    setMessage(null);
    try {
      const result = await doc.apply({ type: "set-board-fields", fields });
      if (!result.ok) {
        setMessage(result.rejection.message);
        return false;
      }
      const edit = doc.getSnapshot().edits.find((entry) => entry.editId === result.editId);
      onEdited({ document: doc.identity.key, editId: result.editId, label: edit?.label ?? "Edit board properties" });
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      finish();
      setSaving(false);
    }
  };
  const input = (label: string, value: string | number, change: (value: string) => void, numeric = false, markDirtyDraft = true): preact.JSX.Element => (
    <label class="tkr-board-property">{label}{numeric
      ? <input aria-label={label} type="number" value={String(value)} disabled={disabled || saving} onInput={(event) => { if (markDirtyDraft) setDirtyDraft(true); change(event.currentTarget.value === "" ? String(Number.NaN) : event.currentTarget.value); }} />
      : <input aria-label={label} type="text" value={String(value)} disabled={disabled || saving} onInput={(event) => { if (markDirtyDraft) setDirtyDraft(true); change(event.currentTarget.value); }} />}</label>
  );
  const colour = (label: string, value: BoardDocumentSnapshot["properties"]["ambient"], apply: (next: BoardDocumentSnapshot["properties"]["ambient"]) => void): preact.JSX.Element => (
    <fieldset class="tkr-board-color"><legend>{label}</legend>{(["r", "g", "b"] as const).map((channel) => (
      <label key={channel}>{channel === "r" ? "Red" : channel === "g" ? "Green" : "Blue"}<input aria-label={`${label} ${channel === "r" ? "Red" : channel === "g" ? "Green" : "Blue"}`} type="number" min={-255} max={255} value={value[channel]} disabled={disabled || saving} onInput={(event) => {
        const next = event.currentTarget.valueAsNumber;
        if (Number.isInteger(next)) apply({ ...value, [channel]: next });
      }} /></label>
    ))}</fieldset>
  );
  const text = (label: string, value: string, update: (next: string) => void): preact.JSX.Element => input(label, value, update);
  const link = (direction: keyof BoardDocumentSnapshot["links"], label: string): preact.JSX.Element => (
    <div class="tkr-board-link" key={direction}>
      {text(label, links[direction], (value) => { setDirtyDraft(true); setLinks((current) => ({ ...current, [direction]: value })); })}
      <button type="button" aria-label={`Open ${label}`} disabled={saving || !navigation?.open || links[direction].length === 0} onClick={() => { void navigation?.open?.(links[direction]).then(setMessage); }}>Open</button>
    </div>
  );
  const list = (label: string, value: string, update: (value: string) => void): preact.JSX.Element => (
    <label>{label}<textarea aria-label={label} value={value} disabled={disabled || saving} onInput={(event) => { setDirtyDraft(true); update(event.currentTarget.value); }} /></label>
  );
  const applyAll = (): void => {
    const lines = (value: string): string[] => value === "" ? [] : value.split(/\r?\n/);
    const fields = {
      links,
      properties: { ...settings, start: doc.getSnapshot().properties.start },
      threads: threads === snapshot.threads.join("\n") ? snapshot.threads : lines(threads),
      constants: constants === snapshot.constants.join("\n") ? snapshot.constants : lines(constants),
      layerTitles: layerTitles === snapshot.layerTitles.join("\n") ? snapshot.layerTitles : lines(layerTitles),
    };
    if ([settings.battleSkill, settings.backgroundDrawType, properties.start.x, properties.start.y, properties.start.layer, settings.ambient.r, settings.ambient.g, settings.ambient.b, settings.backgroundColour.r, settings.backgroundColour.g, settings.backgroundColour.b].some((value) => !Number.isFinite(value))) {
      setMessage("Every numeric property must contain a finite number.");
      return;
    }
    void submit(fields).then((applied) => {
      if (applied) setDirtyDraft(false);
    });
  };
  const applyStart = async (): Promise<void> => {
    const x = Number(column);
    const y = Number(row);
    const l = Number(layer);
    if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(l) || x < 1 || y < 1 || l < 1 || l > snapshot.layers || !cellOnBoard(snapshot, x - 1, y - 1)) {
      setMessage("Start column, row and layer must name a cell and layer on this board.");
      return;
    }
    if (await onSetStart(x, y, l)) {
      setColumn(String(x));
      setRow(String(y));
      setLayer(String(l));
    }
  };
  return (
    <details class="tkr-board-properties">
      <summary>Board properties</summary>
      <fieldset disabled={disabled || saving}><legend>Board properties</legend>
        {text("Background image", settings.backgroundImage, (value) => setProperty("backgroundImage", value))}
        {input("Background image mode", settings.backgroundDrawType, (value) => setProperty("backgroundDrawType", Number(value)), true)}
        {colour("Background colour", settings.backgroundColour, (value) => setProperty("backgroundColour", value))}
        {text("Background music", settings.backgroundMusic, (value) => setProperty("backgroundMusic", value))}
        {text("Enter program", settings.enterPrg, (value) => setProperty("enterPrg", value))}
        {text("Battle background", settings.battleBackground, (value) => setProperty("battleBackground", value))}
        {input("Battle skill", settings.battleSkill, (value) => setProperty("battleSkill", Number(value)), true)}
        <label><input aria-label="Random battles enabled" type="checkbox" checked={settings.allowBattles !== 0} onChange={(event) => setProperty("allowBattles", event.currentTarget.checked ? 1 : 0)} />Random battles enabled</label>
        <label><input aria-label="Disable saving" type="checkbox" checked={settings.disableSaving !== 0} onChange={(event) => setProperty("disableSaving", event.currentTarget.checked ? 1 : 0)} />Disable saving</label>
        {colour("Ambient RGB", settings.ambient, (value) => setProperty("ambient", value))}
      </fieldset>
      <fieldset disabled={disabled || saving}><legend>Player start</legend>
        <p role="status">{initialCell === null ? "Player start marker is outside this board." : `Player start marker: column ${initialCell.x + 1}, row ${initialCell.y + 1}, layer ${properties.start.layer}`}</p>
        {input("Start column", column, setColumn, true, false)}
        {input("Start row", row, setRow, true, false)}
        {input("Start layer", layer, setLayer, true, false)}
        <button type="button" disabled={disabled || saving} onClick={onChooseStart}>Set player start</button>
        <button type="button" disabled={disabled || saving} onClick={applyStart}>Apply player start</button>
      </fieldset>
      <fieldset><legend>Board links</legend>
        {link("north", "North link")}{link("south", "South link")}{link("east", "East link")}{link("west", "West link")}
        <button type="button" disabled={!navigation?.returnFromVisit} onClick={() => { void navigation?.returnFromVisit?.().then(setMessage); }}>Return to board</button>
      </fieldset>
      <fieldset><legend>Background threads</legend>
        {list("Board threads", threads, setThreads)}
        {threads.split(/\r?\n/).map((thread, index) => thread.trim().length === 0 ? null : (
          <button key={index} type="button" aria-label={`Open thread ${index + 1}`} disabled={!navigation?.open} onClick={() => { void navigation?.open?.(thread).then(setMessage); }}>Open thread {index + 1}</button>
        ))}
      </fieldset>
      <fieldset disabled={disabled || saving}><legend>Board constants</legend>{list("Board constants", constants, setConstants)}</fieldset>
      <fieldset disabled={disabled || saving}><legend>Layer titles</legend>{list("Layer titles", layerTitles, setLayerTitles)}</fieldset>
      <button type="button" disabled={disabled || saving} onClick={applyAll}>Apply</button>
      {navigation?.setInitialBoard && <button type="button" disabled={saving} onClick={() => setConfirmInitial(true)}>Set as initial board</button>}
      {confirmInitial && (
        <dialog ref={initialDialog} aria-labelledby="tkr-confirm-initial-board" onCancel={(event) => { event.preventDefault(); setConfirmInitial(false); }}>
          <h2 id="tkr-confirm-initial-board">Set initial board</h2>
          <p>Change the owning game file's initial board to {doc.identity.path}? This edits the game file separately from this board.</p>
          <button type="button" disabled={saving} onClick={() => {
            setConfirmInitial(false);
            void navigation?.setInitialBoard?.(doc.identity.path).then(setMessage);
          }}>Set initial board</button>
          <button type="button" onClick={() => setConfirmInitial(false)}>Cancel</button>
        </dialog>
      )}
      {message && <p role="alert">{message}</p>}
    </details>
  );
}
