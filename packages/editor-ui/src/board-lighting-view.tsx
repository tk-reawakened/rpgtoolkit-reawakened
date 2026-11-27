import { addLight, moveLightNode, newLight, previewLightConversion, removeLight, setLightColour, setLightType, SHADE_TOOLS, type LightConversionPreview, type LightType, type LightEdit, type SetBoardFieldsCommand, type ShadeTool } from "@tk-reawakened/editor-model";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
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

/** One light's conversion under review: nothing is stored until Apply, so a cancelled review leaves the light exactly as it was. */
interface ConversionReview {
  readonly index: number;
  readonly preview: LightConversionPreview;
}

const sameData = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const STALE_REVIEW = "The light or the shading changed while you were reviewing the conversion, so nothing was converted. Review it again.";

/** A neutral grey where the light adds nothing, lighter where it adds shade and darker where it takes it away. */
function drawConversion(canvas: HTMLCanvasElement, preview: LightConversionPreview): void {
  const context = canvas.getContext("2d");
  if (context === null || context === undefined) return;
  const image = context.createImageData(preview.width, preview.height);
  for (let cell = 0; cell < preview.width * preview.height; cell += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      image.data[cell * 4 + channel] = Math.max(0, Math.min(255, 128 + Math.round((preview.added[cell * 3 + channel] ?? 0) / 2)));
    }
    image.data[cell * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

/** An open conversion review, for Escape to tell which one it belongs to when two boards are open side by side. */
interface OpenReview {
  readonly root: () => HTMLDetailsElement | null;
}

/** Open reviews, oldest first: the last is the one most recently opened or focused. */
const openReviews: OpenReview[] = [];

const onScreen = (root: HTMLDetailsElement | null): root is HTMLDetailsElement =>
  root !== null && root.open && root.isConnected && root.closest('[hidden], [inert], [aria-hidden="true"]') === null;

/** The review an Escape belongs to: the one holding the key's target, else the most recent one still on screen. */
function escapeOwner(target: Element | null): OpenReview | undefined {
  const live = openReviews.filter((entry) => onScreen(entry.root()));
  return (target === null ? undefined : live.find((entry) => entry.root()!.contains(target))) ?? live.at(-1);
}

function describeConversion(name: string, preview: LightConversionPreview): string {
  const cells = preview.width * preview.height;
  const spread = preview.bounds === null
    ? `${name} adds nothing to any of the ${cells} shade cells (it lies off the board or its colours are zero), so converting only removes the light.`
    : `${name} adds shade to ${preview.cellsChanged} of the ${cells} shade cells, in columns ${preview.bounds.column0} to ${preview.bounds.column1} and rows ${preview.bounds.row0} to ${preview.bounds.row1}.`;
  const layer = preview.createsShadingLayer ? " The board has no shading yet, so this creates its shading layer." : " This adds to the shading the board already has.";
  const past = preview.cellsBeyondShadeRange === 0 ? "" : ` ${preview.cellsBeyondShadeRange} cell${preview.cellsBeyondShadeRange === 1 ? "" : "s"} would have a stored shade beyond ±255 (in red, green or blue) once added to the shading already there. That is allowed and is not a drawing error: how those cells look depends on the board's ambient light and tile colours, which clamp the final colour when it is drawn.`;
  return `${spread}${layer}${past}`;
}

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
  const [review, setReview] = useState<ConversionReview | null>(null);
  const panel = useRef<HTMLDetailsElement>(null);
  const lightsGroup = useRef<HTMLFieldSetElement>(null);
  const previewCanvas = useRef<HTMLCanvasElement>(null);
  // Where focus goes when the review closes: the light's Convert button, or the lights list once the light is gone.
  const returnFocus = useRef<number | "list" | null>(null);
  const entry = useRef<OpenReview>({ root: () => panel.current });
  const reviewing = review !== null;
  const locked = disabled || busy || review !== null;
  const reviewLocked = disabled || busy;

  /** A plain key pressed inside the review belongs to the review's buttons: the board's own Enter, Space and letter shortcuts never see it. */
  const keepKeyInReview = (event: KeyboardEvent): void => {
    if (!event.ctrlKey && !event.metaKey && !event.altKey) event.stopPropagation();
  };
  const closeReview = (focus: number | "list" | null): void => {
    returnFocus.current = focus;
    setReview(null);
  };
  /** Show what converting a light would do. Nothing is stored: this only reads the board. */
  const startConvert = (index: number): void => {
    const preview = previewLightConversion(snapshot, index);
    if (!preview.ok) { setMessage(preview.message); return; }
    setMessage(null);
    setReview({ index, preview });
  };
  const cancelConvert = (): void => {
    if (review === null || reviewLocked) return;
    closeReview(review.index);
  };
  /**
   * The one place a light is baked. The command carries the lights and shading the review was worked out from, and the document
   * checks them against the stored board, so an edit from another view or editor since the review refuses the Apply and changes nothing.
   */
  const applyConvert = (): void => {
    if (review === null || reviewLocked) return;
    closeReview("list");
    void submit({ type: "set-board-fields", precondition: review.preview.precondition, fields: { lights: review.preview.lights, shadeLayers: review.preview.shadeLayers } });
  };

  useEffect(() => {
    if (review === null) return;
    // Any change to the lights or the shading the review was worked out from makes the picture and counts wrong: close it.
    const source = review.preview.precondition;
    const grid = { sizeX: snapshot.sizeX, sizeY: snapshot.sizeY, layers: snapshot.layers, coordType: snapshot.coordType };
    if (!sameData(snapshot.lights, source.lights) || !sameData(snapshot.shadeLayers, source.shadeLayers) || !sameData(grid, source.grid)) {
      closeReview(null);
      setMessage(STALE_REVIEW);
    }
  }, [snapshot, review]);
  // While a review is open it has first claim on Escape: it cancels from wherever focus is on this page, before the board's own
  // Escape (which would cancel a pending path or gesture) or any other shortcut sees the key. Another open dialog keeps its own Escape.
  // A layout effect, so the claim exists the moment the review is on screen and not a frame later.
  useLayoutEffect(() => {
    if (review === null) return;
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      const root = panel.current;
      if (!onScreen(root)) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target !== null && !root.contains(target) && target.closest('dialog[open], [role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]') !== null) return;
      // With two boards open side by side only one review answers: the one holding the key, else the most recent.
      if (escapeOwner(target) !== entry.current) return;
      event.preventDefault();
      event.stopPropagation();
      cancelConvert();
    };
    document.addEventListener("keydown", onEscape, true);
    return () => document.removeEventListener("keydown", onEscape, true);
  }, [review, reviewLocked]);
  // Register while open, so Escape can tell reviews apart; moving focus into a review makes it the most recent.
  useLayoutEffect(() => {
    if (!reviewing) return;
    const mine = entry.current;
    openReviews.push(mine);
    const onFocus = (event: FocusEvent): void => {
      if (!(event.target instanceof Node) || panel.current?.contains(event.target) !== true) return;
      const at = openReviews.indexOf(mine);
      if (at !== -1 && at !== openReviews.length - 1) openReviews.push(...openReviews.splice(at, 1));
    };
    document.addEventListener("focusin", onFocus, true);
    return () => {
      document.removeEventListener("focusin", onFocus, true);
      const at = openReviews.indexOf(mine);
      if (at !== -1) openReviews.splice(at, 1);
    };
  }, [reviewing]);
  useEffect(() => {
    if (review === null) {
      const target = returnFocus.current;
      returnFocus.current = null;
      if (target === null) return;
      // Closing from another pane's keyboard must not pull focus back: only a focus that was here, or was lost with the review, returns.
      const active = document.activeElement;
      if (active !== null && active !== document.body && panel.current?.contains(active) !== true) return;
      (target === "list" ? lightsGroup.current : panel.current?.querySelector<HTMLElement>(`[data-light-convert="${target}"]`) ?? null)?.focus();
      return;
    }
    panel.current?.querySelector<HTMLElement>("[data-light-review-cancel]")?.focus();
    if (previewCanvas.current !== null) drawConversion(previewCanvas.current, review.preview);
  }, [review]);

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
    <details class="tkr-board-lighting" open data-editor-commands="include" ref={panel}>
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
        {ui.mode === "shading" ? <p class="tkr-board-note">Draw and Erase paint cells (right-click erases), Rectangle draws an outline (Shift fills), Flood fill replaces the connected area, and Dropper copies a cell's shade into the brush. While this is on, the board's tile and object tools are paused; the Scroll and Zoom tools still move the view. From the keyboard, move over the cell grid with the arrow keys and press Space to use the tool on that cell; Rectangle takes two Spaces, one on each corner (Shift fills), and Escape cancels it.</p> : null}
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
      <fieldset class="tkr-board-lights" ref={lightsGroup} tabIndex={-1}>
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
              <button type="button" disabled={locked} aria-label={`Convert ${name} to shading…`} data-light-convert={index}
                title="Shows what converting this light would do. Nothing changes until you press Apply; Cancel keeps the light as it is."
                onClick={() => startConvert(index)}>Convert to shading…</button>
              <button type="button" disabled={locked} aria-label={`Remove ${name}`} onClick={() => editLights(removeLight(snapshot, index))}>Remove</button>
              {review !== null && review.index === index ? (
                <div class="tkr-board-light-review" role="group" aria-labelledby={`tkr-light-review-${index}`}
                  onKeyDown={keepKeyInReview}>
                  <h3 id={`tkr-light-review-${index}`}>Convert {name} to shading?</h3>
                  <p class="tkr-board-note">{describeConversion(name, review.preview)}</p>
                  <p class="tkr-board-note">Apply adds this into the board's shading and removes the light, in one step that Undo takes back. Cancel, or Escape, changes nothing and keeps the light editable.</p>
                  <figure class="tkr-board-light-figure">
                    <canvas ref={previewCanvas} class="tkr-board-light-preview" aria-hidden="true" width={review.preview.width} height={review.preview.height} />
                    <figcaption class="tkr-board-note">This picture shows only what {name} adds on its own, one pixel per cell: grey where it adds nothing, lighter where it adds shade, darker where it takes shade away. It never shows the total with the shading already on the board, so it does not mark cells whose stored shade passes ±255; the count above reports those.</figcaption>
                  </figure>
                  <button type="button" disabled={reviewLocked} data-light-review-cancel aria-label={`Cancel converting ${name}`} onClick={cancelConvert}>Cancel</button>
                  <button type="button" disabled={reviewLocked} aria-label={`Apply conversion of ${name} to shading`} onClick={applyConvert}>Apply conversion</button>
                </div>
              ) : null}
            </fieldset>
          );
        })}
      </fieldset>
      {message === null ? null : <p class="tkr-board-note" role="alert">{message}</p>}
    </details>
  );
}
