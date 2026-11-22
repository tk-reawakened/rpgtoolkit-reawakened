import { addLight, convertLightToShading, moveLightNode, newLight, removeLight, setLightColour, setLightType, SHADE_TOOLS, type LightType, type LightEdit, type SetBoardFieldsCommand, type ShadeTool } from "@tk-reawakened/editor-model";
import { useState } from "preact/hooks";
import type { BoardSubmit } from "./use-board-submit.ts";
import type { BoardViewDocument } from "./mount.ts";
import { useDocumentSnapshot } from "./use-document.ts";

/** What the pointer does on the board canvas: nothing special, paint shade cells, or move light nodes. */
export type ShadeCanvasMode = "off" | "shading" | "lighting";

/** The shading and lighting state the panel and the canvas share. */
export interface ShadeUi {
  readonly mode: ShadeCanvasMode;
  readonly tool: ShadeTool;
  readonly brush: { readonly r: number; readonly g: number; readonly b: number };
  /** Whether the picture draws painted tile shading and lights; hiding changes only the picture, never the board. */
  readonly showShading: boolean;
  readonly showLighting: boolean;
}

export const INITIAL_SHADE_UI: ShadeUi = { mode: "off", tool: "draw", brush: { r: 64, g: 64, b: 64 }, showShading: true, showLighting: true };

const TOOL_NAMES: Readonly<Record<ShadeTool, string>> = { draw: "Draw", erase: "Erase", rectangle: "Rectangle", flood: "Flood fill", dropper: "Dropper" };

export interface BoardLightingViewProps {
  readonly doc: BoardViewDocument;
  readonly disabled: boolean;
  readonly ui: ShadeUi;
  readonly onUi: (next: ShadeUi) => void;
  readonly board: BoardSubmit;
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
export function BoardLightingView({ doc, disabled, ui, onUi, board }: BoardLightingViewProps) {
  const snapshot = useDocumentSnapshot(doc);
  const brush = ui.brush;
  const setBrush = (next: ShadeUi["brush"] | ((current: ShadeUi["brush"]) => ShadeUi["brush"])): void => onUi({ ...ui, brush: typeof next === "function" ? next(ui.brush) : next });
  const [column, setColumn] = useState(1);
  const [row, setRow] = useState(1);
  const { message, setMessage, busy, submit } = board;
  const locked = disabled || busy;

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
      <fieldset class="tkr-board-canvas-tools">
        <legend>On the board</legend>
        <button type="button" aria-pressed={ui.mode === "shading"} disabled={locked} onClick={() => onUi({ ...ui, mode: ui.mode === "shading" ? "off" : "shading" })}>Paint shading on the board</button>
        <button type="button" aria-pressed={ui.mode === "lighting"} disabled={locked} onClick={() => onUi({ ...ui, mode: ui.mode === "lighting" ? "off" : "lighting" })}>Move lights on the board</button>
        <button type="button" aria-pressed={ui.showShading} onClick={() => onUi({ ...ui, showShading: !ui.showShading })}>Draw tile shading</button>
        <button type="button" aria-pressed={ui.showLighting} onClick={() => onUi({ ...ui, showLighting: !ui.showLighting })}>Draw lighting</button>
        {ui.mode === "shading" ? SHADE_TOOLS.map((tool) => (
          <button type="button" key={tool} aria-pressed={ui.tool === tool} disabled={locked} onClick={() => onUi({ ...ui, tool })}>{TOOL_NAMES[tool]}</button>
        )) : null}
        {ui.mode === "shading" ? <p class="tkr-board-note">Draw and Erase paint cells (right-click erases), Rectangle draws an outline (Shift fills), Flood fill replaces the connected area, and Dropper copies a cell's shade into the brush. The Scroll and Zoom tools still move the view. From the keyboard, move over the cell grid with the arrow keys and press Space to use the tool on that cell; Rectangle takes two Spaces, one on each corner (Shift fills), and Escape cancels it.</p> : null}
        {ui.mode === "lighting" ? <p class="tkr-board-note">Drag a light's node dots to move them. The numeric fields below stay available.</p> : null}
      </fieldset>
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
