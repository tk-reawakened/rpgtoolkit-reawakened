import { addLight, convertLightToShading, createEditTracker, moveLightNode, newLight, removeLight, setLightColour, setLightType, type LightType, type LightEdit, type PendingEdits, type SetBoardFieldsCommand } from "@tk-reawakened/editor-model";
import type { BoardCommand } from "@tk-reawakened/editor-model";
import type { DocumentEdited } from "@tk-reawakened/platform-services";
import { useEffect, useRef, useState } from "preact/hooks";
import type { BoardViewDocument } from "./mount.ts";
import { useDocumentSnapshot } from "./use-document.ts";

export interface BoardLightingViewProps {
  readonly doc: BoardViewDocument;
  readonly disabled: boolean;
  readonly onEdited: (event: DocumentEdited) => void;
  readonly pendingEdits: PendingEdits;
}

const TYPE_NAMES: Readonly<Record<LightType, string>> = { 0: "Spotlight", 1: "Gradient", 2: "Clipped gradient" };
/** What each node of a light is for (docs/spec/formats/board.md#lights): a spotlight's node 1 is its centre. */
const NODE_NAMES: Readonly<Record<LightType, readonly string[]>> = {
  0: ["Radius point 1", "Centre", "Radius point 2"],
  1: ["Start", "End"],
  2: ["Start", "End"],
};
const COLOUR_NAMES: Readonly<Record<LightType, readonly string[]>> = {
  0: ["Shade at ellipse edge", "Shade at ellipse centre"],
  1: ["Shade at start", "Shade at end"],
  2: ["Shade at start", "Shade at end"],
};
const CHANNELS = [["r", "Red"], ["g", "Green"], ["b", "Blue"]] as const;

const clamp = (value: number): number => Math.max(-255, Math.min(255, Math.trunc(value)));

/**
 * Lights and shading beside the board (T-23 Shading and Lighting, T-26). Every control has a numeric field and an accessible
 * name; each change is one command, so one undo takes it back. Lights stay editable until Convert, which adds one light into
 * the board's shading and removes it in a single edit (docs/spec/formats/board.md#lights). The shade brush is
 * (64,64,64) until changed; there is no brush size.
 */
export function BoardLightingView({ doc, disabled, onEdited, pendingEdits }: BoardLightingViewProps) {
  const submitted = useRef(createEditTracker());
  useEffect(() => pendingEdits.register(submitted.current), [pendingEdits]);
  const snapshot = useDocumentSnapshot(doc);
  const [brush, setBrush] = useState({ r: 64, g: 64, b: 64 });
  const [column, setColumn] = useState(1);
  const [row, setRow] = useState(1);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = disabled || busy;

  const submit = async (command: BoardCommand): Promise<boolean> => {
    const finish = submitted.current.begin();
    setBusy(true);
    setMessage(null);
    try {
      const result = await doc.apply(command);
      if (!result.ok) {
        setMessage(result.rejection.message);
        return false;
      }
      const edit = doc.getSnapshot().edits.find((entry) => entry.editId === result.editId);
      onEdited({ document: doc.identity.key, editId: result.editId, label: edit?.label ?? "Edit lights and shading" });
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      finish();
      setBusy(false);
    }
  };
  const submitFields = (fields: SetBoardFieldsCommand["fields"]): Promise<boolean> => submit({ type: "set-board-fields", fields });
  const editLights = (edit: LightEdit): void => {
    if (!edit.ok) { setMessage(edit.message); return; }
    void submitFields({ lights: edit.lights });
  };
  const number = (label: string, value: number, change: (next: number) => void, min?: number, max?: number): preact.JSX.Element => (
    <label class="tkr-board-property">{label}
      <input aria-label={label} type="number" value={value} disabled={locked} {...(min === undefined ? {} : { min })} {...(max === undefined ? {} : { max })}
        onChange={(event) => { const next = event.currentTarget.valueAsNumber; if (Number.isInteger(next)) change(next); }} />
    </label>
  );
  const grid = snapshot.grid;
  const centre = { x: Math.floor((grid.width * 32) / 2), y: Math.floor((grid.height * 32) / 2) };
  const addNew = (type: LightType): void => { void submitFields({ lights: addLight(snapshot, newLight(type, centre, brush)) }); };

  return (
    <details class="tkr-board-lighting" open data-editor-commands="include">
      <summary>Lights and shading</summary>
      <fieldset class="tkr-board-shading">
        <legend>Shading</legend>
        <p class="tkr-board-note">Each channel is a whole number from −255 to 255; 0 changes nothing. The Shading brush paints one cell.</p>
        {CHANNELS.map(([channel, name]) => number(`Shade ${name}`, brush[channel], (next) => setBrush((current) => ({ ...current, [channel]: clamp(next) })), -255, 255))}
        {number("Shade grey (sets all three)", brush.r, (next) => setBrush({ r: clamp(next), g: clamp(next), b: clamp(next) }), -255, 255)}
        <button type="button" disabled={locked} onClick={() => setBrush({ r: 0, g: 0, b: 0 })}>Zero RGB</button>
        {number("Shade column", column, setColumn, 1, grid.width)}
        {number("Shade row", row, setRow, 1, grid.height)}
        <button type="button" disabled={locked} onClick={() => { void submit({ type: "set-shade-cells", cells: [{ x: column - 1, y: row - 1, ...brush }] }); }}>Shade cell</button>
      </fieldset>
      <fieldset class="tkr-board-lights">
        <legend>Lights</legend>
        <button type="button" disabled={locked} onClick={() => addNew(0)}>Add spotlight</button>
        <button type="button" disabled={locked} onClick={() => addNew(1)}>Add gradient</button>
        {snapshot.lights.length === 0 ? <p class="tkr-board-note">This board has no lights. A light adds its shade to the tiles under it when the board loads.</p> : null}
        {snapshot.lights.map((light, index) => {
          const type = light.type as LightType;
          const name = `Light ${index + 1}`;
          return (
            <fieldset class="tkr-board-light" key={`${index}-${light.type}`}>
              <legend>{name}</legend>
              <label class="tkr-board-property">{`${name} type`}
                <select aria-label={`${name} type`} value={String(type)} disabled={locked}
                  onChange={(event) => editLights(setLightType(snapshot, index, Number(event.currentTarget.value) as LightType))}>
                  {([0, 1, 2] as const).map((option) => <option key={option} value={String(option)}>{TYPE_NAMES[option]}</option>)}
                </select>
              </label>
              {light.nodes.map((node, at) => (
                <div class="tkr-board-node" key={at}>
                  {number(`${name} ${NODE_NAMES[type][at] ?? `node ${at + 1}`} X (pixels)`, node.x, (next) => editLights(moveLightNode(snapshot, index, at, { x: next, y: node.y })))}
                  {number(`${name} ${NODE_NAMES[type][at] ?? `node ${at + 1}`} Y (pixels)`, node.y, (next) => editLights(moveLightNode(snapshot, index, at, { x: node.x, y: next })))}
                </div>
              ))}
              {light.colours.map((colour, at) => (
                <div class="tkr-board-color" key={at}>
                  {CHANNELS.map(([channel, channelName]) => number(`${name} ${COLOUR_NAMES[type][at] ?? `colour ${at + 1}`} ${channelName}`, colour[channel],
                    (next) => editLights(setLightColour(snapshot, index, at as 0 | 1, { ...colour, [channel]: next })), -255, 255))}
                </div>
              ))}
              <button type="button" disabled={locked} aria-label={`Convert ${name} to shading`}
                title="Adds this light into the board's shading and removes the light. One undo brings it back."
                onClick={() => {
                  const converted = convertLightToShading(snapshot, index);
                  if (!converted.ok) { setMessage(converted.message); return; }
                  void submitFields({ lights: converted.lights, shadeLayers: converted.shadeLayers });
                }}>Convert to shading</button>
              <button type="button" disabled={locked} aria-label={`Remove ${name}`} onClick={() => editLights(removeLight(snapshot, index))}>Remove</button>
            </fieldset>
          );
        })}
      </fieldset>
      {message === null ? null : <p class="tkr-board-note" role="alert">{message}</p>}
    </details>
  );
}
