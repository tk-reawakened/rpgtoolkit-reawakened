import { projectVisualProgram, type OpaqueProgramRegion, type ShowMessageCard } from "@tk-reawakened/editor-model";
import { useMemo, useRef, useState } from "preact/hooks";

export type VisualEventAction =
  | { readonly type: "add"; readonly message: string }
  | { readonly type: "message"; readonly from: number; readonly message: string }
  | { readonly type: "delete"; readonly from: number }
  | { readonly type: "open"; readonly from: number };

/** Command identities shared between the focused browser registry and the native host registry. */
export const VISUAL_EVENT_COMMANDS = {
  add: "program.visual.addMessage",
  message: "program.visual.editMessage",
  delete: "program.visual.removeMessage",
  open: "program.visual.openSource",
} as const satisfies Record<VisualEventAction["type"], string>;

interface VisualEventPaneProps {
  readonly source: string;
  readonly readOnly: boolean;
  readonly error: string | null;
  readonly onAction: (action: VisualEventAction) => void;
}

function MessageCard({ card, readOnly, onAction }: {
  readonly card: ShowMessageCard;
  readonly readOnly: boolean;
  readonly onAction: VisualEventPaneProps["onAction"];
}) {
  const [draft, setDraft] = useState(card.message);
  return (
    <fieldset>
      <legend>Show message</legend>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (!readOnly && draft !== card.message) onAction({ type: "message", from: card.from, message: draft });
      }}>
        <label>Message <input type="text" value={draft} readOnly={readOnly}
          onInput={(event) => setDraft(event.currentTarget.value)} /></label>
        <button type="submit" data-editor-command-id={`${VISUAL_EVENT_COMMANDS.message}.${card.line}`}
          disabled={readOnly || draft === card.message}>Apply message</button>
      </form>
      <button type="button" data-editor-command-id={`${VISUAL_EVENT_COMMANDS.delete}.${card.line}`} disabled={readOnly}
        onClick={() => onAction({ type: "delete", from: card.from })}>Remove Show message</button>
    </fieldset>
  );
}

function OpaqueBlock({ region, onAction }: {
  readonly region: OpaqueProgramRegion;
  readonly onAction: VisualEventPaneProps["onAction"];
}) {
  const pressed = useRef<(() => void) | null>(null);
  const open = () => onAction({ type: "open", from: region.from });
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
export function VisualEventPane({ source, readOnly, error, onAction }: VisualEventPaneProps) {
  const { regions } = useMemo(() => projectVisualProgram(source), [source]);
  return (
    <section class="tkr-visual-events" aria-label="Visual events">
      <h3>Visual events</h3>
      <button type="button" data-editor-command-id={VISUAL_EVENT_COMMANDS.add} disabled={readOnly}
        onClick={() => onAction({ type: "add", message: "Welcome to the village." })}>Add Show message</button>
      {error === null ? null : <p role="alert">{error}</p>}
      {regions.map((region) => region.type === "show-message"
        ? <MessageCard key={`message:${region.from}:${region.message}`} card={region} readOnly={readOnly} onAction={onAction} />
        : <OpaqueBlock key={`opaque:${region.from}`} region={region} onAction={onAction} />)}
    </section>
  );
}
