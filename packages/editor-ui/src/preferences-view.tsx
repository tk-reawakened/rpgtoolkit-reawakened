import type { PreferenceRow, Preferences } from "@tk-reawakened/editor-model";
import type { SettingsLayer } from "@tk-reawakened/platform-services";
import { useEffect, useState } from "preact/hooks";
import { useDocumentSnapshot } from "./use-document.ts";

let viewsMade = 0;

export interface PreferencesViewProps {
  readonly preferences: Preferences;
}

const SOURCE_WORDS = { default: "the default", user: "your setting", project: "this project's setting" } as const;

/** One preference: its label and words, the control for its type, which layer it is editing, its effective value and its reset buttons. */
function PreferenceField({ row, preferences, id }: { readonly row: PreferenceRow; readonly preferences: Preferences; readonly id: string }) {
  const { entry } = row;
  const available = preferences.getSnapshot().projectLayerAvailable && entry.projectLayer;
  const [layer, setLayer] = useState<SettingsLayer>("user");
  const [draft, setDraft] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [refusalKey, setRefusalKey] = useState(0);
  const target: SettingsLayer = available ? layer : "user";
  // What the control shows is the value of the layer being edited when it has one, else the value in force.
  const shown = row.layers[target] ?? row.effective;
  const text = Array.isArray(shown) ? shown.join(", ") : String(shown);
  const fieldId = `${id}-field`;
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;

  const refuse = (reason: string | null): void => {
    setRefusal(reason);
    if (reason !== null) setRefusalKey((key) => key + 1);
  };
  const store = async (value: unknown): Promise<void> => {
    const result = await preferences.set(entry.id, target, value);
    if (result.ok) {
      setDraft(null);
      refuse(null);
    } else {
      refuse(result.reason);
    }
  };
  const commitText = (): void => {
    if (draft === null || draft === text) {
      setDraft(null);
      return;
    }
    void store(entry.type === "number" ? (draft.trim() === "" ? Number.NaN : Number(draft)) : entry.type === "list" ? draft.split(",").map((item) => item.trim()).filter((item) => item !== "") : draft);
  };
  const reset = (which: SettingsLayer): void => {
    void preferences.reset(entry.id, which).then((result) => {
      if (result.ok) {
        setDraft(null);
        refuse(null);
      } else {
        refuse(result.reason);
      }
    });
  };

  const describedBy = refusal === null ? helpId : `${helpId} ${errorId}`;
  let control;
  if (entry.type === "boolean") {
    control = (
      <input
        id={fieldId}
        type="checkbox"
        checked={shown === true}
        aria-describedby={describedBy}
        onChange={(event) => void store((event.currentTarget as HTMLInputElement).checked)}
      />
    );
  } else if (entry.type === "enum") {
    control = (
      <select id={fieldId} value={String(shown)} aria-describedby={describedBy} onChange={(event) => void store((event.currentTarget as HTMLSelectElement).value)}>
        {entry.options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    );
  } else {
    control = (
      <input
        id={fieldId}
        type="text"
        value={draft ?? text}
        aria-invalid={refusal === null ? undefined : "true"}
        aria-describedby={describedBy}
        onInput={(event) => setDraft((event.currentTarget as HTMLInputElement).value)}
        onBlur={commitText}
        onKeyDown={(event) => {
          if (event.key === "Enter") commitText();
          else if (event.key === "Escape") {
            setDraft(null);
            refuse(null);
          }
        }}
      />
    );
  }

  return (
    <div class="tkr-pref" data-preference={entry.id}>
      <label for={fieldId} class="tkr-pref-label">{entry.label}</label>
      {control}
      <p id={helpId} class="tkr-pref-help">{entry.description}</p>
      <p class="tkr-pref-source">Using {SOURCE_WORDS[row.source]}.</p>
      {available ? (
        <label class="tkr-pref-layer">
          Edit for
          <select value={layer} onChange={(event) => { setLayer((event.currentTarget as HTMLSelectElement).value as SettingsLayer); setDraft(null); refuse(null); }}>
            <option value="user">Me</option>
            <option value="project">This project</option>
          </select>
        </label>
      ) : null}
      <button type="button" disabled={target === "user" ? !row.canResetUser : !row.canResetProject} onClick={() => reset(target)}>
        Reset {target === "user" ? "my setting" : "the project setting"}
      </button>
      {refusal === null ? null : <p id={errorId} key={refusalKey} role="alert" class="tkr-pref-error">{refusal}</p>}
    </div>
  );
}

/**
 * The editor preferences (T-08, T-33): a searchable, grouped list of fields built from the catalogue. Every field
 * says which layer its value comes from, can be reset to the layer below, and says in words why a value was refused.
 * A stored value the model could not use is listed once at the top. Preferences never touch the game's own data.
 */
export function PreferencesView({ preferences }: PreferencesViewProps) {
  const snapshot = useDocumentSnapshot(preferences);
  const [query, setQuery] = useState("");
  const [ids] = useState(() => {
    viewsMade += 1;
    return `tkr-prefs-${viewsMade}`;
  });
  useEffect(() => {
    void preferences.refresh();
  }, [preferences]);

  const rows = preferences.search(query);
  const groups = [...new Set(rows.map((row) => row.entry.group))];
  return (
    <section class="tkr-preferences" aria-label="Editor preferences">
      <label for={`${ids}-search`}>Search preferences</label>
      <input id={`${ids}-search`} type="search" value={query} onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)} />
      <p>These settings belong to the editor. They are not saved in your game.</p>
      {snapshot.problems.length === 0 ? null : (
        <ul class="tkr-pref-problems" role="status">
          {snapshot.problems.map((problem) => (
            <li key={`${problem.layer}:${problem.id}:${problem.reason}`}>{problem.reason}</li>
          ))}
        </ul>
      )}
      {rows.length === 0 ? <p role="status">No preferences match “{query}”.</p> : null}
      {groups.map((group) => (
        <fieldset key={group} class="tkr-pref-group">
          <legend>{group}</legend>
          {rows.filter((row) => row.entry.group === group).map((row) => (
            <PreferenceField key={row.entry.id} row={row} preferences={preferences} id={`${ids}-${row.entry.id.replace(/\./g, "-")}`} />
          ))}
        </fieldset>
      ))}
    </section>
  );
}
