import {
  placedVisualEvents,
  projectVisualProgram,
  VISUAL_EVENT_TEMPLATES,
  VISUAL_PREVIEW_SCREEN,
  type OpaqueProgramRegion,
  type PickOutcome,
  type PlacedVisualEvent,
  type ShowMessageCard,
  type VisualConditionCard,
  type VisualEventAction,
  type VisualEventCard,
  type VisualEventField,
  type VisualEventTemplate,
  type EditableVisualEvent,
  type VisualProgramRegion,
} from "@tk-reawakened/editor-model";
import type { AssetKind } from "@tk-reawakened/core";
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

export type { VisualEventAction } from "@tk-reawakened/editor-model";

/** Command identities shared between the focused browser registry and the native host registry (ADR 0038). */
export const VISUAL_EVENT_COMMANDS = {
  add: "program.visual.addMessage",
  "add-template": "program.visual.addCommand",
  message: "program.visual.editMessage",
  edit: "program.visual.editCommand",
  condition: "program.visual.editCondition",
  delete: "program.visual.removeEvent",
  move: "program.visual.placeEvent",
  reorder: "program.visual.reorderEvent",
  // One registered action per direction: a palette entry for a single "nudge" id would have no direction to apply.
  nudgeLeft: "program.visual.nudgeEvent.left",
  nudgeRight: "program.visual.nudgeEvent.right",
  nudgeUp: "program.visual.nudgeEvent.up",
  nudgeDown: "program.visual.nudgeEvent.down",
  open: "program.visual.openSource",
};

/** The four nudges a placed card offers, each a registered action (ADR 0038). */
const NUDGES = [["left", -1, 0], ["right", 1, 0], ["up", 0, -1], ["down", 0, 1]] as const;
const NUDGE_COMMANDS = {
  left: VISUAL_EVENT_COMMANDS.nudgeLeft,
  right: VISUAL_EVENT_COMMANDS.nudgeRight,
  up: VISUAL_EVENT_COMMANDS.nudgeUp,
  down: VISUAL_EVENT_COMMANDS.nudgeDown,
} as const;

/** What the shared asset picker is asked for; the host supplies the picker (browser overlay, native quick pick). */
export type VisualAssetPicker = (request: { readonly kind: AssetKind; readonly extensions: readonly string[]; readonly field: string }) => Promise<PickOutcome>;

interface VisualEventPaneProps {
  readonly source: string;
  readonly readOnly: boolean;
  readonly error: string | null;
  readonly onAction: (action: VisualEventAction) => void;
  readonly pickAsset?: VisualAssetPicker;
}

type Dispatch = (action: VisualEventAction) => void;

const TEMPLATES = new Map(VISUAL_EVENT_TEMPLATES.map((template) => [template.id, template]));
const CATEGORIES = [...new Set(VISUAL_EVENT_TEMPLATES.map((template) => template.category))];
const SETTLE_MS = 600;

function hint(field: VisualEventField): string {
  const range = field.minimum !== undefined && field.maximum !== undefined ? `, ${field.minimum} to ${field.maximum}`
    : field.minimum !== undefined ? `, at least ${field.minimum}` : field.maximum !== undefined ? `, at most ${field.maximum}` : "";
  return field.unit === undefined && range === "" ? "" : `${field.unit ?? ""}${range}`.replace(/^, /, "");
}

function parseDraft(field: VisualEventField, draft: string): string | number {
  if (field.type !== "number") return draft;
  return draft.trim() === "" ? Number.NaN : Number(draft);
}

function CardActions({ line, label, canUp, canDown, readOnly, from, dispatch, removeLabel }: {
  readonly line: number;
  readonly label: string;
  readonly canUp: boolean;
  readonly canDown: boolean;
  readonly readOnly: boolean;
  readonly from: number;
  readonly dispatch: Dispatch;
  readonly removeLabel?: string;
}) {
  const lock = "Only neighbouring supported commands can swap; code the builder does not edit stays where it is.";
  return (
    <div class="tkr-visual-actions">
      <button type="button" aria-label={`Move ${label} up`} title={canUp ? undefined : lock} data-editor-command-id={`${VISUAL_EVENT_COMMANDS.reorder}.up.${line}`}
        disabled={readOnly || !canUp} onClick={() => dispatch({ type: "reorder", from, direction: "up" })}>Move up</button>
      <button type="button" aria-label={`Move ${label} down`} title={canDown ? undefined : lock} data-editor-command-id={`${VISUAL_EVENT_COMMANDS.reorder}.down.${line}`}
        disabled={readOnly || !canDown} onClick={() => dispatch({ type: "reorder", from, direction: "down" })}>Move down</button>
      <button type="button" data-editor-command-id={`${VISUAL_EVENT_COMMANDS.delete}.${line}`} disabled={readOnly}
        onClick={() => dispatch({ type: "delete", from })}>{removeLabel ?? `Remove ${label}`}</button>
    </div>
  );
}

function MessageCard({ card, readOnly, dispatch, canUp, canDown, source }: {
  readonly card: ShowMessageCard;
  readonly readOnly: boolean;
  readonly dispatch: Dispatch;
  readonly canUp: boolean;
  readonly canDown: boolean;
  readonly source: string;
}) {
  const [draft, setDraft] = useState(card.message);
  // A snapshot of someone else's edit must not throw away half-typed text: reseed only when this card's own text changed.
  const seeded = useRef(card.message);
  useEffect(() => {
    if (seeded.current === card.message) return;
    seeded.current = card.message;
    setDraft(card.message);
  }, [card.message]);
  return (
    <fieldset>
      <legend>Show message</legend>
      <form noValidate onSubmit={(event) => {
        event.preventDefault();
        if (!readOnly && draft !== card.message) dispatch({ type: "message", from: card.from, message: draft });
      }}>
        <label>Message <input type="text" value={draft} readOnly={readOnly}
          onInput={(event) => setDraft(event.currentTarget.value)} /></label>
        <button type="submit" data-editor-command-id={`${VISUAL_EVENT_COMMANDS.message}.${card.line}`}
          disabled={readOnly || draft === card.message}>Apply message</button>
      </form>
      <Code>{source.slice(card.from, card.to).trimEnd()}</Code>
      <CardActions line={card.line} label="Show message" canUp={canUp} canDown={canDown} readOnly={readOnly} from={card.from} dispatch={dispatch} />
    </fieldset>
  );
}

/** The generated RPGCode is always on show: the card is another view of exactly these lines. */
function Code({ children }: { readonly children: ComponentChildren }) {
  return <pre class="tkr-visual-code" aria-label="Generated code"><code>{children}</code></pre>;
}

function FieldInput({ field, draft, readOnly, onDraft, pickAsset, describedBy }: {
  readonly field: VisualEventField;
  readonly draft: string;
  readonly readOnly: boolean;
  readonly onDraft: (value: string) => void;
  readonly pickAsset: VisualAssetPicker | undefined;
  readonly describedBy: string;
}) {
  const [picking, setPicking] = useState(false);
  const note = hint(field);
  const input = field.type === "number"
    ? <input type="number" value={draft} readOnly={readOnly} step={field.integer === true ? 1 : "any"} min={field.minimum} max={field.maximum}
      aria-describedby={note === "" ? undefined : describedBy} onInput={(event) => onDraft(event.currentTarget.value)} />
    : <input type="text" value={draft} readOnly={readOnly} spellcheck={false}
      aria-describedby={note === "" ? undefined : describedBy} onInput={(event) => onDraft(event.currentTarget.value)} />;
  return (
    <div class="tkr-visual-field">
      <label>{field.label} {input}</label>
      {field.type === "asset" && field.asset !== undefined && pickAsset !== undefined
        ? <button type="button" aria-label={`Choose ${field.label.toLowerCase()}`} disabled={readOnly || picking}
          onClick={() => {
            setPicking(true);
            void pickAsset({ kind: field.asset!.kind, extensions: field.asset!.extensions, field: field.label.toLowerCase() })
              .then((outcome) => { if (outcome.chosen) onDraft(outcome.reference); })
              .finally(() => setPicking(false));
          }}>Choose…</button> : null}
      {note === "" ? null : <small id={describedBy}>{note}</small>}
    </div>
  );
}

function EventCardView({ card, template, readOnly, dispatch, canUp, canDown, pickAsset }: {
  readonly card: VisualEventCard;
  readonly template: VisualEventTemplate;
  readonly readOnly: boolean;
  readonly dispatch: Dispatch;
  readonly canUp: boolean;
  readonly canDown: boolean;
  readonly pickAsset: VisualAssetPicker | undefined;
}) {
  const [drafts, setDrafts] = useState(() => card.values.map(String));
  const signature = JSON.stringify(card.values);
  const seeded = useRef(signature);
  useEffect(() => {
    if (seeded.current === signature) return;
    seeded.current = signature;
    setDrafts(card.values.map(String));
  }, [signature]);
  const changed = drafts.some((draft, index) => draft !== String(card.values[index]));
  return (
    <fieldset>
      <legend>{template.label}</legend>
      {template.fields.length === 0 ? null : (
        <form noValidate onSubmit={(event) => {
          event.preventDefault();
          if (!readOnly && changed) dispatch({ type: "edit", from: card.from, values: template.fields.map((field, index) => parseDraft(field, drafts[index]!)) });
        }}>
          {template.fields.map((field, index) => (
            <FieldInput key={index} field={field} draft={drafts[index]!} readOnly={readOnly} pickAsset={pickAsset}
              describedBy={`tkr-vf-${card.line}-${index}`}
              onDraft={(value) => setDrafts((previous) => previous.map((item, at) => at === index ? value : item))} />
          ))}
          <button type="submit" data-editor-command-id={`${VISUAL_EVENT_COMMANDS.edit}.${card.line}`} disabled={readOnly || !changed}>Apply {template.label}</button>
        </form>
      )}
      <Code>{card.source.trim()}</Code>
      <CardActions line={card.line} label={template.label} canUp={canUp} canDown={canDown} readOnly={readOnly} from={card.from} dispatch={dispatch} />
    </fieldset>
  );
}

function ConditionCardView({ card, readOnly, dispatch, canUp, canDown }: {
  readonly card: VisualConditionCard;
  readonly readOnly: boolean;
  readonly dispatch: Dispatch;
  readonly canUp: boolean;
  readonly canDown: boolean;
}) {
  const [draft, setDraft] = useState(card.condition);
  const seeded = useRef(card.condition);
  useEffect(() => {
    if (seeded.current === card.condition) return;
    seeded.current = card.condition;
    setDraft(card.condition);
  }, [card.condition]);
  return (
    <fieldset>
      <legend>If condition</legend>
      <form noValidate onSubmit={(event) => {
        event.preventDefault();
        if (!readOnly && draft !== card.condition) dispatch({ type: "condition", from: card.from, condition: draft });
      }}>
        <label>Condition <input type="text" value={draft} readOnly={readOnly} spellcheck={false} aria-describedby={`tkr-vc-${card.line}`}
          onInput={(event) => setDraft(event.currentTarget.value)} /></label>
        <small id={`tkr-vc-${card.line}`}>A variable, number or quoted text on each side of ==, !=, &lt;, &gt;, &lt;= or &gt;=.</small>
        <button type="submit" data-editor-command-id={`${VISUAL_EVENT_COMMANDS.condition}.${card.line}`} disabled={readOnly || draft === card.condition}>Apply condition</button>
      </form>
      <Code>{`if (${card.condition}) {`}</Code>
      {card.body.trim() === "" ? <p>The block is empty.</p> : (
        <details open>
          <summary>Code inside the condition</summary>
          <pre aria-label="Code inside the condition"><code>{card.body}</code></pre>
          <p class="tkr-visual-note">This code is edited in the code editor; the builder keeps it exactly as written.</p>
        </details>
      )}
      <CardActions line={card.line} label="If condition" canUp={canUp} canDown={canDown} readOnly={readOnly} from={card.from} dispatch={dispatch} />
    </fieldset>
  );
}

function OpaqueBlock({ region, dispatch }: {
  readonly region: OpaqueProgramRegion;
  readonly dispatch: Dispatch;
}) {
  const pressed = useRef<(() => void) | null>(null);
  const open = () => dispatch({ type: "open", from: region.from });
  return (
    <fieldset>
      <legend>Code the builder does not edit</legend>
      <pre><code>{region.text}</code></pre>
      <button type="button" data-editor-command-id={`${VISUAL_EVENT_COMMANDS.open}.${region.line}`}
        onPointerDown={(event) => {
          // Monaco may commit typing on blur and reuse this button for a different block before click.
          if (event.isPrimary && event.button === 0) pressed.current = open;
        }}
        onPointerCancel={() => { pressed.current = null; }}
        onClick={(event) => {
          const activate = event.detail > 0 ? pressed.current ?? open : open;
          pressed.current = null;
          activate();
        }}>Open in editor</button>
    </fieldset>
  );
}

function summary(region: VisualProgramRegion): string {
  return region.type === "show-message" ? "Show message"
    : region.type === "condition" ? `If ${region.condition}`
      : region.type === "event" ? TEMPLATES.get(region.templateId)?.label ?? "Command" : "";
}

function AddCommand({ regions, readOnly, dispatch }: {
  readonly regions: readonly VisualProgramRegion[];
  readonly readOnly: boolean;
  readonly dispatch: Dispatch;
}) {
  const [category, setCategory] = useState<string>(CATEGORIES[0]!);
  const [templateId, setTemplateId] = useState(VISUAL_EVENT_TEMPLATES[0]!.id);
  const [where, setWhere] = useState("end");
  const choices = VISUAL_EVENT_TEMPLATES.filter((template) => template.category === category);
  const cards = regions.filter((region) => region.type !== "opaque");
  const at = where === "end" || !cards.some((card) => String(card.from) === where) ? undefined : Number(where);
  const target = at === undefined ? {} : { at };
  return (
    <fieldset class="tkr-visual-add">
      <legend>Add a command</legend>
      <label>Category <select aria-label="Category" value={category} disabled={readOnly} onChange={(event) => {
        const next = event.currentTarget.value;
        setCategory(next);
        setTemplateId(VISUAL_EVENT_TEMPLATES.find((template) => template.category === next)!.id);
      }}>{CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label>Command <select aria-label="Command" value={templateId} disabled={readOnly} onChange={(event) => setTemplateId(event.currentTarget.value)}>
        {choices.map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}</select></label>
      <label>Insert <select aria-label="Insert" value={at === undefined ? "end" : where} disabled={readOnly} onChange={(event) => setWhere(event.currentTarget.value)}>
        <option value="end">At the end of the program</option>
        {cards.map((card) => <option key={card.from} value={String(card.from)}>Before line {card.line}: {summary(card)}</option>)}
      </select></label>
      <div class="tkr-visual-actions">
        <button type="button" data-editor-command-id={VISUAL_EVENT_COMMANDS["add-template"]} disabled={readOnly}
          onClick={() => dispatch({ type: "add-template", templateId, ...target })}>Add command</button>
        <button type="button" data-editor-command-id={VISUAL_EVENT_COMMANDS.add} disabled={readOnly}
          onClick={() => dispatch({ type: "add", message: "Welcome to the village.", ...target })}>Add Show message</button>
      </div>
    </fieldset>
  );
}

interface Drag {
  readonly line: number;
  readonly startX: number;
  readonly startY: number;
  readonly x: number;
  readonly y: number;
}

/** Screen-layout canvas (T-45, TOOL-12): another editor for the placed commands' own coordinates, never a second document. */
function LayoutCanvas({ placed, readOnly, dispatch, resetKey }: {
  readonly placed: readonly PlacedVisualEvent[];
  readonly readOnly: boolean;
  readonly dispatch: Dispatch;
  readonly resetKey: string;
}) {
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ readonly line: number; readonly x: number; readonly y: number } | null>(null);
  const drag = useRef<Drag | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  useEffect(() => { setPreview(null); }, [resetKey]);
  const active = placed.find((item) => item.line === selectedLine) ?? placed[0]!;
  const [drafts, setDrafts] = useState<{ readonly line: number; readonly x: string; readonly y: string }>({ line: active.line, x: String(active.x), y: String(active.y) });
  const shown = drafts.line === active.line ? drafts : { line: active.line, x: String(active.x), y: String(active.y) };
  useEffect(() => { setDrafts({ line: active.line, x: String(active.x), y: String(active.y) }); }, [active.line, active.x, active.y, resetKey]);
  const template = TEMPLATES.get(active.templateId)!;
  const xField = template.fields[template.placement!.xField]!;
  const yField = template.fields[template.placement!.yField]!;
  const listId = useMemo(() => `tkr-layout-${Math.random().toString(36).slice(2, 8)}`, []);
  const select = (line: number): void => setSelectedLine(line);
  const position = (item: PlacedVisualEvent): { readonly left: number; readonly top: number } => {
    const live = preview?.line === item.line ? preview : null;
    const x = live?.x ?? item.x;
    const y = live?.y ?? item.y;
    return item.unit === "cells"
      ? { left: Math.trunc((x - 1) * item.cell), top: Math.trunc((y - 1) * item.cell) }
      : { left: x, top: y };
  };
  const arrow = (event: KeyboardEvent): readonly [number, number] | null => {
    const step = event.shiftKey ? 10 : 1;
    return event.key === "ArrowLeft" ? [-step, 0] : event.key === "ArrowRight" ? [step, 0]
      : event.key === "ArrowUp" ? [0, -step] : event.key === "ArrowDown" ? [0, step] : null;
  };
  const choose = (to: number): void => {
    const target = placed[Math.max(0, Math.min(placed.length - 1, to))]!;
    select(target.line);
  };
  const activeIndex = placed.indexOf(active);
  return (
    <section class="tkr-visual-layout" aria-label="Screen layout">
      <h4>Screen layout</h4>
      <p class="tkr-visual-note">A preview of a {VISUAL_PREVIEW_SCREEN.width} × {VISUAL_PREVIEW_SCREEN.height} screen. Placing a command edits its own X and Y in the program; nothing else is saved.</p>
      <div class="tkr-visual-layout-body">
        <div id={listId} class="tkr-visual-layout-list" role="listbox" aria-label="Placed commands" tabIndex={0}
          aria-activedescendant={`${listId}-${active.line}`}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowRight") { event.preventDefault(); choose(activeIndex + 1); }
            else if (event.key === "ArrowUp" || event.key === "ArrowLeft") { event.preventDefault(); choose(activeIndex - 1); }
            else if (event.key === "Home") { event.preventDefault(); choose(0); }
            else if (event.key === "End") { event.preventDefault(); choose(placed.length - 1); }
          }}>
          {placed.map((item) => (
            <div key={item.line} id={`${listId}-${item.line}`} role="option" aria-selected={item === active} class="tkr-visual-layout-option"
              onClick={() => select(item.line)}>
              {item.label}: {item.text} ({item.x}, {item.y})
            </div>
          ))}
        </div>
        <div class="tkr-visual-canvas" ref={canvas} role="group" aria-label={`Layout canvas, ${VISUAL_PREVIEW_SCREEN.width} by ${VISUAL_PREVIEW_SCREEN.height} preview`}>
          {placed.map((item) => {
            const at = position(item);
            return (
              <button key={item.line} type="button" class="tkr-visual-item" data-selected={item === active ? "true" : "false"}
                aria-label={`${item.label} "${item.text}" at ${item.x}, ${item.y}`}
                aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown"
                disabled={readOnly}
                style={{
                  left: `${at.left / VISUAL_PREVIEW_SCREEN.width * 100}%`,
                  top: `${at.top / VISUAL_PREVIEW_SCREEN.height * 100}%`,
                  fontSize: `${(item.unit === "cells" ? item.cell : 8) / VISUAL_PREVIEW_SCREEN.width * 100}cqw`,
                }}
                onFocus={() => select(item.line)}
                onKeyDown={(event) => {
                  const delta = arrow(event);
                  if (delta === null || readOnly) return;
                  event.preventDefault();
                  dispatch({ type: "nudge", from: item.from, dx: delta[0], dy: delta[1] });
                }}
                onPointerDown={(event) => {
                  if (readOnly || !event.isPrimary || event.button !== 0) return;
                  select(item.line);
                  event.currentTarget.setPointerCapture(event.pointerId);
                  drag.current = { line: item.line, startX: event.clientX, startY: event.clientY, x: item.x, y: item.y };
                }}
                onPointerMove={(event) => {
                  const current = drag.current;
                  const surface = canvas.current?.getBoundingClientRect();
                  if (current === null || current.line !== item.line || surface === undefined || surface.width === 0) return;
                  const scale = VISUAL_PREVIEW_SCREEN.width / surface.width;
                  const unit = item.cell;
                  setPreview({
                    line: item.line,
                    x: current.x + Math.round((event.clientX - current.startX) * scale / unit),
                    y: current.y + Math.round((event.clientY - current.startY) * scale / unit),
                  });
                }}
                onPointerUp={(event) => {
                  const current = drag.current;
                  drag.current = null;
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                  if (current === null || preview === null || preview.line !== item.line) { setPreview(null); return; }
                  if (preview.x === item.x && preview.y === item.y) { setPreview(null); return; }
                  dispatch({ type: "move", from: item.from, x: preview.x, y: preview.y });
                }}
                onPointerCancel={() => { drag.current = null; setPreview(null); }}
              >{item.text}</button>
            );
          })}
        </div>
      </div>
      <form noValidate class="tkr-visual-inspector" aria-label="Placement of the selected command" onSubmit={(event) => {
        event.preventDefault();
        if (readOnly) return;
        // A blank field is not a zero: refusing it keeps the model's range check from silently placing at the origin.
        const coordinate = (text: string): number => text.trim() === "" ? Number.NaN : Number(text);
        dispatch({ type: "move", from: active.from, x: coordinate(shown.x), y: coordinate(shown.y) });
      }}>
        <div class="tkr-visual-field">
          <label>Placed X <input type="number" step="any" min={xField.minimum} value={shown.x} readOnly={readOnly}
            aria-describedby={`${listId}-x`} onInput={(event) => setDrafts({ ...shown, x: event.currentTarget.value })} /></label>
          <small id={`${listId}-x`}>{hint(xField)}</small>
        </div>
        <div class="tkr-visual-field">
          <label>Placed Y <input type="number" step="any" min={yField.minimum} value={shown.y} readOnly={readOnly}
            aria-describedby={`${listId}-y`} onInput={(event) => setDrafts({ ...shown, y: event.currentTarget.value })} /></label>
          <small id={`${listId}-y`}>{hint(yField)}</small>
        </div>
        <button type="submit" data-editor-command-id={`${VISUAL_EVENT_COMMANDS.move}.${active.line}`}
          disabled={readOnly || (shown.x === String(active.x) && shown.y === String(active.y))}>Apply placement</button>
        <div class="tkr-visual-actions">
          {NUDGES.map(([direction, dx, dy]) => (
            <button key={direction} type="button" aria-label={`Nudge ${active.label} ${direction}`}
              data-editor-command-id={`${NUDGE_COMMANDS[direction]}.${active.line}`} disabled={readOnly}
              onClick={() => dispatch({ type: "nudge", from: active.from, dx, dy })}>Move {direction}</button>
          ))}
        </div>
        <p class="tkr-visual-note">Arrow keys on a placed item move it one unit; Shift moves ten.</p>
      </form>
    </section>
  );
}

/**
 * Serialises card actions against the text they were made from. A nudge typed while the previous one is still being
 * applied is added to it, so held arrow keys end as one further edit instead of a stale-source refusal.
 */
function useDispatch(source: string, error: string | null, onAction: Dispatch): Dispatch {
  const latest = useRef({ source, onAction });
  latest.current = { source, onAction };
  const state = useRef<{ inflight: string | null; queued: { readonly from: number; readonly line: number; readonly templateId: string; readonly dx: number; readonly dy: number } | null; timer: ReturnType<typeof setTimeout> | undefined }>({
    inflight: null, queued: null, timer: undefined,
  });
  /** The card a gesture was made on, by offset, line and command: its own value edits keep all three, a swap does not. */
  const cardAt = (text: string, from: number): { readonly line: number; readonly templateId: string } | null => {
    const region = projectVisualProgram(text).regions.find((item): item is EditableVisualEvent => item.type !== "opaque" && item.from === from);
    return region !== undefined && region.type === "event" ? { line: region.line, templateId: region.templateId } : null;
  };
  const send = (action: VisualEventAction, to: Dispatch, from: string): void => {
    const current = state.current;
    current.inflight = from;
    clearTimeout(current.timer);
    current.timer = setTimeout(settle, SETTLE_MS);
    to(action);
  };
  const settle = (): void => {
    const current = state.current;
    clearTimeout(current.timer);
    current.timer = undefined;
    current.inflight = null;
    const queued = current.queued;
    current.queued = null;
    if (queued === null) return;
    // The gesture belongs to the card it was made on: a card that swapped places, changed command or went away drops it.
    const region = projectVisualProgram(latest.current.source).regions.find((item): item is EditableVisualEvent =>
      item.type === "event" && item.from === queued.from && item.line === queued.line && item.templateId === queued.templateId);
    if (region === undefined) return;
    send({ type: "nudge", from: region.from, dx: queued.dx, dy: queued.dy }, latest.current.onAction, latest.current.source);
  };
  useEffect(settle, [source, error]);
  useEffect(() => () => clearTimeout(state.current.timer), []);
  return (action) => {
    const current = state.current;
    if (action.type !== "nudge" || current.inflight !== latest.current.source) {
      send(action, onAction, source);
      return;
    }
    const card = cardAt(latest.current.source, action.from);
    if (card === null) return;
    const queued = current.queued;
    const same = queued !== null && queued.from === action.from && queued.line === card.line && queued.templateId === card.templateId;
    current.queued = same
      ? { ...queued, dx: queued.dx + action.dx, dy: queued.dy + action.dy }
      : { from: action.from, line: card.line, templateId: card.templateId, dx: action.dx, dy: action.dy };
  };
}

/** A projection of the live program text, not a second document or undo history (TOOL-12). */
export function VisualEventPane({ source, readOnly, error, onAction, pickAsset }: VisualEventPaneProps) {
  const projection = useMemo(() => projectVisualProgram(source), [source]);
  const { regions } = projection;
  const placed = useMemo(() => placedVisualEvents(projection), [projection]);
  const dispatch = useDispatch(source, error, onAction);
  const supported = (index: number): boolean => {
    const region = regions[index];
    return region !== undefined && region.type !== "opaque";
  };
  return (
    <section class="tkr-visual-events" aria-label="Visual events">
      <h3>Visual events</h3>
      <AddCommand regions={regions} readOnly={readOnly} dispatch={dispatch} />
      {error === null ? null : <p role="alert">{error}</p>}
      {regions.map((region, index) => {
        const canUp = supported(index - 1);
        const canDown = supported(index + 1);
        if (region.type === "show-message") {
          return <MessageCard key={region.id} card={region} readOnly={readOnly} dispatch={dispatch} canUp={canUp} canDown={canDown} source={source} />;
        }
        if (region.type === "event") {
          const template = TEMPLATES.get(region.templateId)!;
          return <EventCardView key={region.id} card={region} template={template} readOnly={readOnly} dispatch={dispatch}
            canUp={canUp} canDown={canDown} pickAsset={pickAsset} />;
        }
        if (region.type === "condition") {
          return <ConditionCardView key={region.id} card={region} readOnly={readOnly} dispatch={dispatch} canUp={canUp} canDown={canDown} />;
        }
        return <OpaqueBlock key={`opaque:${region.from}`} region={region} dispatch={dispatch} />;
      })}
      {placed.length === 0 ? null : <LayoutCanvas placed={placed} readOnly={readOnly} dispatch={dispatch} resetKey={source} />}
    </section>
  );
}
