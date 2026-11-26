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
  nudge: "program.visual.nudgeEvent",
  reorder: "program.visual.reorderEvent",
  open: "program.visual.openSource",
} as const satisfies Record<VisualEventAction["type"], string>;

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
      <form onSubmit={(event) => {
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

function OpaqueBlock({ region, onAction }: {
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
          return <MessageCard key={`message:${region.line}`} card={region} readOnly={readOnly} dispatch={dispatch} canUp={canUp} canDown={canDown} source={source} />;
        }
        if (region.type === "event") {
          const template = TEMPLATES.get(region.templateId)!;
          return <EventCardView key={`event:${region.line}`} card={region} template={template} readOnly={readOnly} dispatch={dispatch}
            canUp={canUp} canDown={canDown} pickAsset={pickAsset} />;
        }
        if (region.type === "condition") {
          return <ConditionCardView key={`condition:${region.line}`} card={region} readOnly={readOnly} dispatch={dispatch} canUp={canUp} canDown={canDown} />;
        }
        return <OpaqueBlock key={`opaque:${region.from}`} region={region} dispatch={dispatch} />;
      })}
      {placed.length === 0 ? null : <LayoutCanvas placed={placed} readOnly={readOnly} dispatch={dispatch} resetKey={source} />}
    </section>
  );
}
