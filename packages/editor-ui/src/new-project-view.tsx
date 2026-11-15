import {
  NEW_PROJECT_MAX_NAME,
  STARTER_ITEMS,
  suggestedMainFile,
  validateNewProject,
  type NewProjectSettings,
  type StarterItem,
} from "@tk-reawakened/editor-model";
import { useEffect, useRef, useState } from "preact/hooks";

/** How many wizards have been given ids (ids must be unique in the page; see `SettingsView`). */
let wizardsMade = 0;

export interface NewProjectViewProps {
  /** What the wizard offers to copy in: the catalogue, with the unavailable items and their reasons. */
  readonly starters?: readonly StarterItem[];
  /** Ask the host for the folder the project is made in; its name, or `null` when the person cancels. */
  readonly chooseDestination: () => Promise<string | null>;
  /**
   * Make the project in the chosen folder. A failure is shown here and the wizard stays open with what was typed; `details`
   * lists each path or item the message is about.
   */
  readonly onCreate: (settings: NewProjectSettings) => Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string; readonly details?: readonly string[] }>;
  readonly onCancel: () => void;
}

/**
 * The new-project wizard (T-04): the game's name, its main file, the starter contents to copy in and the destination
 * folder. Nothing is ticked at first, so a blank project is what Create makes unless the person asks for more; each item
 * says what it writes and where it came from, and an unavailable item is shown with its reason and cannot be ticked.
 * Every field has a visible label, a problem is said beside its field, and Cancel (or Escape) creates nothing. Only
 * classes and ARIA attributes are used (ADR 0025 decision 6).
 */
export function NewProjectView({ starters = STARTER_ITEMS, chooseDestination, onCreate, onCancel }: NewProjectViewProps) {
  const [ids] = useState(() => {
    wizardsMade += 1;
    return `tkr-new-project-${wizardsMade}`;
  });
  const [name, setName] = useState("");
  const [mainFile, setMainFile] = useState("");
  /** The main file follows the name until the person types in it. */
  const [mainTyped, setMainTyped] = useState(false);
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const [destination, setDestination] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ readonly message: string; readonly details: readonly string[] } | null>(null);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);

  const settings: NewProjectSettings = { gameName: name, mainFile, starters: chosen };
  const problems = validateNewProject(settings);
  const problemOf = (field: keyof NewProjectSettings): string | undefined => problems.find((problem) => problem.field === field)?.message;
  // A field that is still empty is not scolded before the person has tried to create.
  const shown = (field: keyof NewProjectSettings): string | undefined => (!attempted && (field === "gameName" ? name === "" : field === "mainFile" && mainFile === "") ? undefined : problemOf(field));

  const rename = (value: string): void => {
    setName(value);
    if (!mainTyped) setMainFile(suggestedMainFile(value));
  };
  const toggle = (id: string, on: boolean): void => setChosen((current) => (on ? [...current.filter((item) => item !== id), id] : current.filter((item) => item !== id)));

  const choose = (): void => {
    if (choosing || busy) return;
    setChoosing(true);
    void chooseDestination().then((picked) => { if (picked !== null) setDestination(picked); }).finally(() => setChoosing(false));
  };

  /** Cancelling is closed while the project is being made: it could report "cancelled" and still write. */
  const cancel = (): void => {
    if (!busy) onCancel();
  };

  const submit = (event: Event): void => {
    event.preventDefault();
    setAttempted(true);
    if (problems.length > 0 || destination === null || busy || choosing) return;
    setBusy(true);
    setFailure(null);
    void onCreate(settings).then((result) => { if (!result.ok) setFailure({ message: result.message, details: result.details ?? [] }); }).finally(() => setBusy(false));
  };

  const error = (id: string, field: keyof NewProjectSettings) => (shown(field) === undefined ? null : <p id={`${ids}-${id}-error`} class="tkr-new-project-error" role="alert">{shown(field)}</p>);
  const described = (id: string, field: keyof NewProjectSettings): string | undefined => (shown(field) === undefined ? undefined : `${ids}-${id}-error`);

  return (
    <form class="tkr-new-project" aria-label="New project" onSubmit={submit} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); cancel(); } }}>
      <h2 class="tkr-new-project-heading">New project</h2>
      <div class="tkr-new-project-row">
        <label for={`${ids}-name`}>Game name</label>
        <input id={`${ids}-name`} ref={first} type="text" maxLength={NEW_PROJECT_MAX_NAME + 20} value={name} aria-invalid={shown("gameName") === undefined ? undefined : true} aria-describedby={described("name", "gameName")} onInput={(event) => rename(event.currentTarget.value)} />
        {error("name", "gameName")}
      </div>
      <div class="tkr-new-project-row">
        <label for={`${ids}-main`}>Main file</label>
        <input id={`${ids}-main`} type="text" value={mainFile} aria-invalid={shown("mainFile") === undefined ? undefined : true} aria-describedby={described("main", "mainFile")} onInput={(event) => { setMainTyped(true); setMainFile(event.currentTarget.value); }} />
        {error("main", "mainFile")}
      </div>
      <fieldset class="tkr-new-project-starters">
        <legend>Starter contents</legend>
        <p id={`${ids}-starters-note`} class="tkr-new-project-note">Nothing is copied unless you tick it. Leave everything unticked for a blank project with its folders.</p>
        {starters.map((item) => {
          const unavailable = item.unavailable !== null;
          const on = chosen.includes(item.id);
          return (
            <div key={item.id} class={unavailable ? "tkr-new-project-starter tkr-new-project-starter-unavailable" : "tkr-new-project-starter"}>
              <input id={`${ids}-starter-${item.id}`} type="checkbox" checked={on} disabled={unavailable} aria-describedby={`${ids}-starter-${item.id}-detail`} onChange={(event) => toggle(item.id, event.currentTarget.checked)} />
              <label for={`${ids}-starter-${item.id}`}>{item.label}</label>
              <p id={`${ids}-starter-${item.id}-detail`} class="tkr-new-project-detail">
                {unavailable ? `Not available: ${item.unavailable}` : item.description}
                {unavailable ? null : ` Writes: ${item.writes} Provenance: ${item.provenance}`}
              </p>
            </div>
          );
        })}
        {error("starters", "starters")}
      </fieldset>
      <div class="tkr-new-project-row">
        <span id={`${ids}-destination-label`}>Destination folder</span>
        <button type="button" class="tkr-new-project-choose" aria-describedby={`${ids}-destination-label ${ids}-destination`} disabled={busy || choosing} onClick={choose}>Choose folder…</button>
        <span id={`${ids}-destination`} class="tkr-new-project-destination" role="status">{destination === null ? "No folder chosen. Choose an empty folder, or one that holds none of the project's files; nothing in it is ever replaced." : destination}</span>
        {attempted && destination === null ? <p class="tkr-new-project-error" role="alert">Choose the folder to make the project in.</p> : null}
      </div>
      {failure === null ? null : (
        <div class="tkr-new-project-failure" role="alert">
          <p>{failure.message}</p>
          {failure.details.length === 0 ? null : <ul>{failure.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>}
        </div>
      )}
      <button type="submit" class="tkr-new-project-create" disabled={busy || choosing}>Create project</button>
      <button type="button" class="tkr-new-project-cancel" disabled={busy} onClick={cancel}>Cancel</button>
    </form>
  );
}
