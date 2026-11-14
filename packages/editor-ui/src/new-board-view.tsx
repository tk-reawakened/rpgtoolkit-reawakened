import {
  BOARD_COORD_SYSTEMS,
  NEW_BOARD_MAX_LAYERS,
  NEW_BOARD_MAX_SIZE,
  newBoardSummary,
  validateNewBoard,
  type BoardCoordSystem,
  type NewBoardSettings,
} from "@tk-reawakened/editor-model";
import { useEffect, useRef, useState } from "preact/hooks";

/** How many dialogs have been given ids (ids must be unique in the page; see `SettingsView`). */
let dialogsMade = 0;

export interface NewBoardViewProps {
  /** What the questions start with: the remembered choices, and no name. */
  readonly initial: NewBoardSettings;
  /** The boards a new one can be made from, by project-relative path. */
  readonly templates: readonly { readonly path: string; readonly name: string }[];
  /** Fill the layout, size, layers and background from a template; `null` with the reason when it cannot be read. */
  readonly describeTemplate: (path: string) => Promise<Partial<NewBoardSettings> | string>;
  /** Make the board. A failure is shown here and the dialog stays open with what was typed. */
  readonly onCreate: (settings: NewBoardSettings) => Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
  readonly onCancel: () => void;
}

/**
 * The new-board questions (T-20): a name, blank or a template, the coordinate system, the size in tiles with its pixel
 * size, the layers, and the background. Every field has a visible label, a problem is said beside its field, and
 * Cancel (or Escape) creates nothing. Only classes and ARIA attributes are used (ADR 0025 decision 6).
 */
export function NewBoardView({ initial, templates, describeTemplate, onCreate, onCancel }: NewBoardViewProps) {
  const [ids] = useState(() => {
    dialogsMade += 1;
    return `tkr-new-board-${dialogsMade}`;
  });
  const [settings, setSettings] = useState<NewBoardSettings>(initial);
  const [numbers, setNumbers] = useState({ width: String(initial.width), height: String(initial.height), layers: String(initial.layers) });
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /** A template has been chosen and its layout, size and background are still being read: the fields are not its yet. */
  const [describing, setDescribing] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  /** Counts template choices, so a slow answer for an earlier choice never replaces a later one. */
  const choice = useRef(0);
  useEffect(() => first.current?.focus(), []);

  const typed: NewBoardSettings = { ...settings, width: Number(numbers.width), height: Number(numbers.height), layers: Number(numbers.layers) };
  const problems = validateNewBoard(typed);
  const problemOf = (field: keyof NewBoardSettings): string | undefined => problems.find((problem) => problem.field === field)?.message;
  const shown = (field: keyof NewBoardSettings): string | undefined => (field === "name" && !attempted ? undefined : problemOf(field));
  const summary = problems.some((problem) => problem.field !== "name" && problem.field !== "backgroundImage") ? null : newBoardSummary(typed);

  const choose = (template: string): void => {
    const mine = ++choice.current;
    setFailure(null);
    if (template === "") {
      setDescribing(false);
      return setSettings({ ...settings, template: null });
    }
    setDescribing(true);
    // Shown at once, so the list says what was chosen while the template is read.
    setSettings({ ...settings, template });
    void describeTemplate(template).then((found) => {
      if (mine !== choice.current) return;
      setDescribing(false);
      if (typeof found === "string") {
        setSettings((current) => ({ ...current, template: null }));
        return setFailure(found);
      }
      setSettings((current) => ({ ...current, ...found, template }));
      setNumbers({ width: String(found.width ?? numbers.width), height: String(found.height ?? numbers.height), layers: String(found.layers ?? numbers.layers) });
    });
  };

  /** Cancelling is closed while the board is being made: it could report "cancelled" and still write and open it. */
  const cancel = (): void => {
    if (!busy) onCancel();
  };

  const submit = (event: Event): void => {
    event.preventDefault();
    setAttempted(true);
    // A template's own layout, size and background are what the fields must hold when it is chosen: wait for them.
    if (problems.length > 0 || busy || describing) return;
    setBusy(true);
    setFailure(null);
    void onCreate(typed).then((result) => { if (!result.ok) setFailure(result.message); }).finally(() => setBusy(false));
  };

  const field = (id: string, label: string, field: keyof NewBoardSettings, control: preact.ComponentChildren) => (
    <div class="tkr-new-board-row">
      <label for={`${ids}-${id}`}>{label}</label>
      {control}
      {shown(field) === undefined ? null : <p id={`${ids}-${id}-error`} class="tkr-new-board-error" role="alert">{shown(field)}</p>}
    </div>
  );
  const described = (id: string, name: keyof NewBoardSettings): string | undefined => (shown(name) === undefined ? undefined : `${ids}-${id}-error`);

  return (
    <form class="tkr-new-board" aria-label="New board" onSubmit={submit} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); cancel(); } }}>
      <h2 class="tkr-new-board-heading">New board</h2>
      {field("name", "Name", "name", (
        <input id={`${ids}-name`} ref={first} type="text" value={settings.name} aria-invalid={shown("name") === undefined ? undefined : true} aria-describedby={described("name", "name")} onInput={(event) => setSettings({ ...settings, name: event.currentTarget.value })} />
      ))}
      {field("template", "Start from", "template", (
        <select id={`${ids}-template`} value={settings.template ?? ""} onChange={(event) => choose(event.currentTarget.value)}>
          <option value="">A blank board</option>
          {templates.map((template) => <option key={template.path} value={template.path}>{template.name}</option>)}
        </select>
      ))}
      {field("system", "Layout", "coordSystem", (
        <select id={`${ids}-system`} value={settings.coordSystem} onChange={(event) => setSettings({ ...settings, coordSystem: event.currentTarget.value as BoardCoordSystem })}>
          {BOARD_COORD_SYSTEMS.map((system) => <option key={system.value} value={system.value}>{system.label}</option>)}
        </select>
      ))}
      <div class="tkr-new-board-row">
        <input id={`${ids}-pixels`} type="checkbox" checked={settings.pixelCoordinates} onChange={(event) => setSettings({ ...settings, pixelCoordinates: event.currentTarget.checked })} />
        <label for={`${ids}-pixels`}>Use pixel coordinates</label>
      </div>
      {field("width", "Width in tiles", "width", (
        <input id={`${ids}-width`} type="number" min="1" max={NEW_BOARD_MAX_SIZE} step="1" value={numbers.width} aria-invalid={shown("width") === undefined ? undefined : true} aria-describedby={described("width", "width")} onInput={(event) => setNumbers({ ...numbers, width: event.currentTarget.value })} />
      ))}
      {field("height", "Height in tiles", "height", (
        <input id={`${ids}-height`} type="number" min="1" max={NEW_BOARD_MAX_SIZE} step="1" value={numbers.height} aria-invalid={shown("height") === undefined ? undefined : true} aria-describedby={described("height", "height")} onInput={(event) => setNumbers({ ...numbers, height: event.currentTarget.value })} />
      ))}
      {field("layers", "Layers", "layers", (
        <input id={`${ids}-layers`} type="number" min="1" max={NEW_BOARD_MAX_LAYERS} step="1" value={numbers.layers} aria-invalid={shown("layers") === undefined ? undefined : true} aria-describedby={described("layers", "layers")} onInput={(event) => setNumbers({ ...numbers, layers: event.currentTarget.value })} />
      ))}
      <p class="tkr-new-board-summary" role="status">
        {summary === null ? "Fix the size to see the board's pixel size." : `${summary.pixelWidth} × ${summary.pixelHeight} pixels, ${summary.cells} stored cells.`}
      </p>
      {field("background", "Background image", "backgroundImage", (
        <input id={`${ids}-background`} type="text" value={settings.backgroundImage} aria-describedby={described("background", "backgroundImage")} onInput={(event) => setSettings({ ...settings, backgroundImage: event.currentTarget.value })} />
      ))}
      {failure === null ? null : <p class="tkr-new-board-error" role="alert">{failure}</p>}
      {describing ? <p class="tkr-new-board-summary" role="status">Reading the template…</p> : null}
      <button type="submit" class="tkr-new-board-create" disabled={busy || describing}>Create board</button>
      <button type="button" class="tkr-new-board-cancel" disabled={busy} onClick={cancel}>Cancel</button>
    </form>
  );
}
