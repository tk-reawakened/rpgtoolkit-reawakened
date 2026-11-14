import {
  changedSettings,
  DEBUG_DRAWING_BITS,
  DEFAULT_CURSOR,
  ENEMY_SLOTS,
  EXT_KEY_SLOTS,
  keyOfScanCode,
  KNOWN_PACKAGES,
  MAIN_SETTING_KEYS,
  MAIN_SETTINGS,
  MOVEMENT_DIRECTION_LABELS,
  scanCodeOfKey,
  SETTINGS_CATEGORIES,
  settingsErrors,
  settingStored,
  settingsWarnings,
  type ApplyResult,
  type MainDocumentSnapshot,
  type MainSettingKey,
  type MainSettings,
  type MainSettingsChanges,
  type SettingIssue,
  type SettingsCategory,
} from "@tk-reawakened/editor-model";
import type { DocumentEdited } from "@tk-reawakened/platform-services";
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { ViewDocument } from "./mount.ts";

export interface GameSettingsFormProps {
  readonly doc: ViewDocument;
  readonly snapshot: MainDocumentSnapshot;
  /** The view's id prefix, unique in the page. */
  readonly ids: string;
  readonly readOnly: boolean;
  readonly onEdited: (event: DocumentEdited) => void;
}

type Colour = MainSettings["pathColor"];

const hex = (colour: Colour): string => `#${[colour.r, colour.g, colour.b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;

/** The words for a stored value of a row the file's minor does not store: what the engine uses instead. */
function shown(key: MainSettingKey, value: MainSettings[MainSettingKey]): string {
  if (typeof value === "boolean") return value ? "on" : "off";
  if (typeof value === "number") return MAIN_SETTINGS[key].choices?.find((choice) => choice.value === value)?.label ?? String(value);
  if (Array.isArray(value)) return key === "movementScanCodes" ? (value as number[]).map((code) => keyOfScanCode(code) ?? "unbound").join(", ") : `${value.length} entries`;
  if (value !== null && typeof value === "object" && "r" in value) return hex(value);
  return value === null || value === "" ? "none" : String(value);
}

/**
 * The staged form over every game setting of editor-features T-10 to T-14. Fields edit a staged copy; nothing reaches the
 * document until Apply, which sends the staged changes as one command (one undo step). Cancel drops the staged copy and
 * leaves the document as it was. Save (the view's own button, or the host's) persists only what has been applied.
 *
 * Validation is staged: each changed field is checked as it is edited (`settingsErrors`), and Apply stays disabled while
 * any error stands; conflicts are warnings beside the field (`settingsWarnings`). Each field names the row that owns it,
 * and a row this file's version does not store is disabled and says which value the engine uses instead.
 */
export function GameSettingsForm({ doc, snapshot, ids, readOnly, onEdited }: GameSettingsFormProps) {
  const [staged, setStaged] = useState<MainSettingsChanges>({});
  const [applying, setApplying] = useState(false);
  const [refusal, setRefusal] = useState<{ readonly message: string; readonly key: number } | null>(null);
  const [opened, setOpened] = useState<Readonly<Record<"extKeys" | "enemies" | "commandPlugins", readonly number[]>>>({ extKeys: [], enemies: [], commandPlugins: [] });
  const [packageDraft, setPackageDraft] = useState("");
  const [added, setAdded] = useState<string | null>(null);
  const [cursorImage, setCursorImage] = useState(false);
  const [keyProblem, setKeyProblem] = useState<string | null>(null);

  const minor = snapshot.minor;
  const current = snapshot.settings;
  const pending = changedSettings(staged, current);
  const pendingCount = Object.keys(pending).length;
  const merged = { ...current, ...pending } as MainSettings;
  const issues: SettingIssue[] = [...settingsErrors(pending, current, minor), ...settingsWarnings(merged, minor)];
  const errorCount = issues.filter((issue) => issue.severity === "error").length;

  const stage = <Key extends MainSettingKey>(key: Key, value: MainSettings[Key]): void => {
    setStaged((previous) => ({ ...previous, [key]: value }));
  };
  const fieldId = (key: string): string => `${ids}-${key}`;
  const disabled = (key: MainSettingKey): boolean => readOnly || applying || !settingStored(key, minor);

  const apply = (): void => {
    const command = { type: "apply-settings" as const, changes: pending };
    setApplying(true);
    const finish = (result: ApplyResult): void => {
      if (!result.ok) {
        setRefusal({ message: result.rejection.message, key: (refusal?.key ?? 0) + 1 });
        return;
      }
      setRefusal(null);
      setStaged({});
      setOpened({ extKeys: [], enemies: [], commandPlugins: [] });
      setAdded(null);
      const edit = doc.getSnapshot().edits.find((entry) => entry.editId === result.editId);
      onEdited({ document: doc.identity.key, editId: result.editId, label: edit?.label ?? "Change game settings" });
    };
    void Promise.resolve()
      .then(() => doc.apply(command))
      .then(finish)
      .catch((error: unknown) => setRefusal({ message: error instanceof Error ? error.message : String(error), key: (refusal?.key ?? 0) + 1 }))
      .finally(() => setApplying(false));
  };

  const cancel = (): void => {
    setStaged({});
    setOpened({ extKeys: [], enemies: [], commandPlugins: [] });
    setRefusal(null);
    setAdded(null);
    setPackageDraft("");
    setCursorImage(false);
    setKeyProblem(null);
  };

  /** The words under a field: who owns it, what the engine uses when this version cannot store it, and its findings. */
  const about = (key: MainSettingKey): { readonly describedBy: string; readonly invalid: boolean; readonly node: ComponentChildren } => {
    const info = MAIN_SETTINGS[key];
    const own = issues.filter((issue) => issue.key === key);
    const ownerId = fieldId(`${key}-owner`);
    const issueId = fieldId(`${key}-issues`);
    const owner = settingStored(key, minor)
      ? `Stored in ${info.owner}.`
      : `Not stored by this file (minor ${minor}; ${info.owner} needs minor ${info.since}). The engine uses ${shown(key, current[key])}.`;
    return {
      describedBy: own.length === 0 ? ownerId : `${ownerId} ${issueId}`,
      invalid: own.some((issue) => issue.severity === "error"),
      node: (
        <>
          <span id={ownerId} class="tkr-settings-owner">{owner}</span>
          {own.length === 0 ? null : (
            <ul id={issueId} class="tkr-settings-issues">
              {own.map((issue, index) => (
                <li key={index} class={issue.severity === "error" ? "tkr-settings-issue-error" : "tkr-settings-issue-warning"}>
                  {issue.severity === "error" ? "Error: " : "Warning: "}
                  {issue.message}
                </li>
              ))}
            </ul>
          )}
        </>
      ),
    };
  };

  const textField = (key: MainSettingKey): ComponentChildren => {
    const info = about(key);
    return (
      <div class="tkr-settings-field" key={key}>
        <label for={fieldId(key)}>{MAIN_SETTINGS[key].label}</label>
        <input
          id={fieldId(key)}
          type="text"
          value={key === "defaultSoundFont" ? (merged.defaultSoundFont ?? "") : (merged[key] as string)}
          disabled={disabled(key)}
          aria-describedby={info.describedBy}
          aria-invalid={info.invalid ? true : undefined}
          onInput={(event) => {
            const value = event.currentTarget.value;
            if (key === "defaultSoundFont") stage("defaultSoundFont", value === "" ? null : value);
            else stage(key, value as never);
          }}
        />
        {info.node}
      </div>
    );
  };

  const flagField = (key: MainSettingKey): ComponentChildren => {
    const info = about(key);
    return (
      <div class="tkr-settings-field" key={key}>
        <input
          id={fieldId(key)}
          type="checkbox"
          checked={merged[key] as boolean}
          disabled={disabled(key)}
          aria-describedby={info.describedBy}
          onChange={(event) => stage(key, event.currentTarget.checked as never)}
        />
        <label for={fieldId(key)}>{MAIN_SETTINGS[key].label}</label>
        {info.node}
      </div>
    );
  };

  const numberField = (key: MainSettingKey): ComponentChildren => {
    const info = about(key);
    const value = merged[key] as number;
    return (
      <div class="tkr-settings-field" key={key}>
        <label for={fieldId(key)}>{MAIN_SETTINGS[key].label}</label>
        <input
          id={fieldId(key)}
          type="number"
          step={1}
          value={Number.isNaN(value) ? "" : String(value)}
          disabled={disabled(key)}
          aria-describedby={info.describedBy}
          aria-invalid={info.invalid ? true : undefined}
          onInput={(event) => {
            const text = event.currentTarget.value.trim();
            stage(key, (text === "" ? Number.NaN : Number(text)) as never);
          }}
        />
        {info.node}
      </div>
    );
  };

  const choiceField = (key: MainSettingKey): ComponentChildren => {
    const info = about(key);
    const value = merged[key] as number;
    const choices = MAIN_SETTINGS[key].choices ?? [];
    const legacy = !choices.some((choice) => choice.value === value);
    return (
      <div class="tkr-settings-field" key={key}>
        <label for={fieldId(key)}>{MAIN_SETTINGS[key].label}</label>
        <select
          id={fieldId(key)}
          value={String(value)}
          disabled={disabled(key)}
          aria-describedby={info.describedBy}
          aria-invalid={info.invalid ? true : undefined}
          onChange={(event) => stage(key, Number(event.currentTarget.value) as never)}
        >
          {legacy ? <option value={String(value)}>{`${value} (a legacy value the editor does not offer)`}</option> : null}
          {choices.map((choice) => <option key={choice.value} value={String(choice.value)}>{choice.label}</option>)}
        </select>
        {info.node}
      </div>
    );
  };

  const colourField = (key: "transparent" | "pathColor"): ComponentChildren => {
    const info = about(key);
    return (
      <div class="tkr-settings-field" key={key}>
        <label for={fieldId(key)}>{MAIN_SETTINGS[key].label}</label>
        <input
          id={fieldId(key)}
          type="color"
          value={hex(merged[key])}
          disabled={disabled(key)}
          aria-describedby={info.describedBy}
          onInput={(event) => {
            const text = event.currentTarget.value;
            const channel = (at: number): number => Number.parseInt(text.slice(at, at + 2), 16);
            stage(key, { r: channel(1), g: channel(3), b: channel(5) });
          }}
        />
        {info.node}
      </div>
    );
  };

  const movementKeys = (): ComponentChildren => {
    const info = about("movementScanCodes");
    const codes = merged.movementScanCodes;
    const setSlot = (slot: number, code: number): void => stage("movementScanCodes", codes.map((was, index) => (index === slot ? code : was)));
    return (
      <fieldset class="tkr-settings-keys" key="movementScanCodes" aria-describedby={info.describedBy}>
        <legend>{MAIN_SETTINGS.movementScanCodes.label}</legend>
        <p class="tkr-settings-hint">Select a direction's box and press the physical key that moves the player that way.</p>
        {MOVEMENT_DIRECTION_LABELS.map((direction, slot) => {
          const code = codes[slot] ?? 0;
          return (
            <div class="tkr-settings-field" key={direction}>
              <label for={fieldId(`move-${slot}`)}>{direction}</label>
              <input
                id={fieldId(`move-${slot}`)}
                type="text"
                readOnly
                value={code === 0 ? "Unbound" : keyOfScanCode(code) ?? `Scan code 0x${code.toString(16)}`}
                disabled={disabled("movementScanCodes")}
                onKeyDown={(event) => {
                  if (event.code === "Tab" || event.code === "") return;
                  event.preventDefault();
                  const offset = scanCodeOfKey(event.code);
                  if (offset === null) {
                    setKeyProblem(`${event.code} has no DirectInput key offset, so the file cannot store it.`);
                    return;
                  }
                  setKeyProblem(null);
                  setSlot(slot, offset);
                }}
              />
              <button type="button" class="tkr-settings-unbind" disabled={disabled("movementScanCodes") || code === 0} onClick={() => setSlot(slot, 0)}>
                Unbind {direction}
              </button>
            </div>
          );
        })}
        {keyProblem === null ? null : <p class="tkr-settings-issue-error">{keyProblem}</p>}
        {info.node}
      </fieldset>
    );
  };

  /** The slot list rows of `key` a creator sees: every slot in use, plus the ones they opened with Add. */
  const shownSlots = (key: "extKeys" | "enemies" | "commandPlugins", used: (slot: number) => boolean, length: number): number[] =>
    Array.from({ length }, (_unused, slot) => slot).filter((slot) => used(slot) || opened[key].includes(slot));

  const addSlot = <Key extends "extKeys" | "enemies" | "commandPlugins">(key: Key, rows: MainSettings[Key], limit: number, empty: (slot: number) => boolean, blank: MainSettings[Key][number]): void => {
    const free = Array.from({ length: rows.length }, (_unused, slot) => slot).find((slot) => empty(slot) && !opened[key].includes(slot));
    const slot = free ?? rows.length;
    if (slot >= limit) return;
    if (free === undefined) stage(key, [...rows, blank] as MainSettings[Key]);
    setOpened((previous) => ({ ...previous, [key]: [...previous[key], slot] }));
  };

  const extKeys = (): ComponentChildren => {
    const info = about("extKeys");
    const rows = merged.extKeys;
    const empty = (slot: number): boolean => rows[slot]?.asciiKey === 0 && rows[slot]?.program === "";
    const update = (slot: number, row: MainSettings["extKeys"][number]): void => stage("extKeys", rows.map((was, index) => (index === slot ? row : was)));
    const off = disabled("extKeys");
    return (
      <fieldset class="tkr-settings-list" key="extKeys" aria-describedby={info.describedBy}>
        <legend>{MAIN_SETTINGS.extKeys.label}</legend>
        {shownSlots("extKeys", (slot) => !empty(slot), rows.length).map((slot) => {
          const row = rows[slot]!;
          return (
            <div class="tkr-settings-row" key={slot}>
              <label for={fieldId(`ext-${slot}-key`)}>Key {slot + 1} (ASCII code)</label>
              <input id={fieldId(`ext-${slot}-key`)} type="number" step={1} value={Number.isNaN(row.asciiKey) ? "" : String(row.asciiKey)} disabled={off}
                onInput={(event) => update(slot, { ...row, asciiKey: event.currentTarget.value.trim() === "" ? Number.NaN : Number(event.currentTarget.value) })} />
              <label for={fieldId(`ext-${slot}-program`)}>Program {slot + 1}</label>
              <input id={fieldId(`ext-${slot}-program`)} type="text" value={row.program} disabled={off}
                onInput={(event) => update(slot, { ...row, program: event.currentTarget.value })} />
              <button type="button" disabled={off} onClick={() => update(slot, { asciiKey: 0, program: "" })}>Remove key {slot + 1}</button>
            </div>
          );
        })}
        <button type="button" disabled={off} onClick={() => addSlot("extKeys", rows, EXT_KEY_SLOTS, empty, { asciiKey: 0, program: "" })}>Add run-time key</button>
        {info.node}
      </fieldset>
    );
  };

  const enemies = (): ComponentChildren => {
    const info = about("enemies");
    const rows = merged.enemies;
    const empty = (slot: number): boolean => rows[slot]?.enemyFile === "";
    const update = (slot: number, row: MainSettings["enemies"][number]): void => stage("enemies", rows.map((was, index) => (index === slot ? row : was)));
    const off = disabled("enemies");
    return (
      <fieldset class="tkr-settings-list" key="enemies" aria-describedby={info.describedBy}>
        <legend>{MAIN_SETTINGS.enemies.label}</legend>
        {shownSlots("enemies", (slot) => !empty(slot), rows.length).map((slot) => {
          const row = rows[slot]!;
          return (
            <div class="tkr-settings-row" key={slot}>
              <label for={fieldId(`enemy-${slot}-file`)}>Enemy {slot + 1}</label>
              <input id={fieldId(`enemy-${slot}-file`)} type="text" value={row.enemyFile} disabled={off}
                onInput={(event) => update(slot, { ...row, enemyFile: event.currentTarget.value })} />
              <label for={fieldId(`enemy-${slot}-skill`)}>Skill level {slot + 1}</label>
              <input id={fieldId(`enemy-${slot}-skill`)} type="number" step={1} value={Number.isNaN(row.skillLevel) ? "" : String(row.skillLevel)} disabled={off}
                onInput={(event) => update(slot, { ...row, skillLevel: event.currentTarget.value.trim() === "" ? Number.NaN : Number(event.currentTarget.value) })} />
              <button type="button" disabled={off} onClick={() => update(slot, { enemyFile: "", skillLevel: 0 })}>Remove enemy {slot + 1}</button>
            </div>
          );
        })}
        <button type="button" disabled={off} onClick={() => addSlot("enemies", rows, ENEMY_SLOTS, empty, { enemyFile: "", skillLevel: 0 })}>Add enemy</button>
        {info.node}
      </fieldset>
    );
  };

  const commandPlugins = (): ComponentChildren => {
    const info = about("commandPlugins");
    const rows = merged.commandPlugins;
    const empty = (slot: number): boolean => rows[slot] === "";
    const update = (slot: number, name: string): void => stage("commandPlugins", rows.map((was, index) => (index === slot ? name : was)));
    const off = disabled("commandPlugins");
    return (
      <fieldset class="tkr-settings-list" key="commandPlugins" aria-describedby={info.describedBy}>
        <legend>{MAIN_SETTINGS.commandPlugins.label}</legend>
        {shownSlots("commandPlugins", (slot) => !empty(slot), rows.length).map((slot) => (
          <div class="tkr-settings-row" key={slot}>
            <label for={fieldId(`plugin-${slot}`)}>Command plugin {slot + 1}</label>
            <input id={fieldId(`plugin-${slot}`)} type="text" value={rows[slot]} disabled={off} onInput={(event) => update(slot, event.currentTarget.value)} />
            <button type="button" disabled={off} onClick={() => update(slot, "")}>Remove command plugin {slot + 1}</button>
          </div>
        ))}
        <button type="button" disabled={off} onClick={() => addSlot("commandPlugins", rows, Number.MAX_SAFE_INTEGER, empty, "")}>Add command plugin</button>
        {info.node}
      </fieldset>
    );
  };

  const packages = (): ComponentChildren => {
    const info = about("packages");
    const names = merged.packages;
    const off = disabled("packages");
    const add = (): void => {
      const name = packageDraft.trim();
      if (name === "") return;
      stage("packages", [...names, name]);
      setPackageDraft("");
      const description = KNOWN_PACKAGES[name.replace(/[A-Z]/g, (letter) => letter.toLowerCase())];
      setAdded(description === undefined
        ? `Added "${name}". This editor does not know that package: it is kept as written, nothing is enabled by the editor, and the game loads it only if its host supplies it.`
        : `Added "${name}": ${description}`);
    };
    return (
      <fieldset class="tkr-settings-list" key="packages" aria-describedby={info.describedBy}>
        <legend>{MAIN_SETTINGS.packages.label}</legend>
        <ol class="tkr-settings-packages">
          {names.map((name, index) => (
            <li key={`${index}-${name}`}>
              <span>{name}</span>
              <button type="button" disabled={off} onClick={() => stage("packages", names.filter((_name, at) => at !== index))}>Remove package {name}</button>
            </li>
          ))}
        </ol>
        <label for={fieldId("package-new")}>Package to add</label>
        <input id={fieldId("package-new")} type="text" value={packageDraft} disabled={off} onInput={(event) => setPackageDraft(event.currentTarget.value)}
          onKeyDown={(event) => { if (event.key === "Enter") add(); }} />
        <button type="button" disabled={off || packageDraft.trim() === ""} onClick={add}>Add package</button>
        {added === null ? null : <p class="tkr-settings-added" role="status">{added}</p>}
        {info.node}
      </fieldset>
    );
  };

  const cursor = (): ComponentChildren => {
    const info = about("mouseCursor");
    const value = merged.mouseCursor;
    const mode = value === DEFAULT_CURSOR ? "default" : value === "" && !cursorImage ? "none" : "custom";
    const off = disabled("mouseCursor");
    return (
      <div class="tkr-settings-field" key="mouseCursor">
        <label for={fieldId("mouseCursor")}>{MAIN_SETTINGS.mouseCursor.label}</label>
        <select
          id={fieldId("mouseCursor")}
          value={mode}
          disabled={off}
          aria-describedby={info.describedBy}
          aria-invalid={info.invalid ? true : undefined}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setCursorImage(next === "custom");
            stage("mouseCursor", next === "default" ? DEFAULT_CURSOR : next === "none" ? "" : current.mouseCursor === DEFAULT_CURSOR ? "" : current.mouseCursor);
          }}
        >
          <option value="default">The built-in arrow</option>
          <option value="none">No cursor</option>
          <option value="custom" disabled={minor < 6}>An image</option>
        </select>
        {mode === "custom" ? (
          <>
            <label for={fieldId("mouseCursor-image")}>Cursor image</label>
            <input id={fieldId("mouseCursor-image")} type="text" value={value} disabled={off} onInput={(event) => stage("mouseCursor", event.currentTarget.value)} />
          </>
        ) : null}
        {info.node}
      </div>
    );
  };

  const debugDrawing = (): ComponentChildren => {
    const info = about("drawVectorsFlags");
    const flags = merged.drawVectorsFlags;
    return (
      <fieldset class="tkr-settings-list" key="drawVectorsFlags" aria-describedby={info.describedBy}>
        <legend>{MAIN_SETTINGS.drawVectorsFlags.label}</legend>
        {DEBUG_DRAWING_BITS.map(({ bit, label }) => (
          <div class="tkr-settings-field" key={bit}>
            <input id={fieldId(`vectors-${bit}`)} type="checkbox" checked={(flags & bit) !== 0} disabled={disabled("drawVectorsFlags")}
              onChange={(event) => stage("drawVectorsFlags", event.currentTarget.checked ? flags | bit : flags & ~bit)} />
            <label for={fieldId(`vectors-${bit}`)}>{label}</label>
          </div>
        ))}
        {info.node}
      </fieldset>
    );
  };

  const fieldOf = (key: MainSettingKey): ComponentChildren => {
    switch (key) {
      case "movementScanCodes": return movementKeys();
      case "extKeys": return extKeys();
      case "enemies": return enemies();
      case "commandPlugins": return commandPlugins();
      case "packages": return packages();
      case "mouseCursor": return cursor();
      case "drawVectorsFlags": return debugDrawing();
      case "transparent":
      case "pathColor": return colourField(key);
    }
    switch (MAIN_SETTINGS[key].shape) {
      case "flag": return flagField(key);
      case "integer": return numberField(key);
      case "choice": return choiceField(key);
      default: return textField(key);
    }
  };

  const keysOf = (category: SettingsCategory): MainSettingKey[] => MAIN_SETTING_KEYS.filter((key) => MAIN_SETTINGS[key].category === category);

  return (
    <div class="tkr-settings-form" role="group" aria-label="All game settings">
      {snapshot.notes.length === 0 ? null : (
        <div class="tkr-settings-notes">
          <h3>About this file</h3>
          <ul>{snapshot.notes.map((note, index) => <li key={index}>{note.message}</li>)}</ul>
        </div>
      )}
      {SETTINGS_CATEGORIES.map((category) => (
        <fieldset class="tkr-settings-category" key={category.id}>
          <legend>{`${category.label} (${category.feature})`}</legend>
          {keysOf(category.id).map(fieldOf)}
          {category.id === "plugins" ? (
            <div class="tkr-settings-sources">
              <h4>What the game starts with</h4>
              <p>Besides the engine's own commands, the game loads these packages, in this order:</p>
              {snapshot.plugins.length === 0 ? <p>None.</p> : (
                <ul>
                  {snapshot.plugins.map((source, index) => (
                    <li key={index}>
                      <strong>{source.package ?? "Nothing"}</strong>
                      {` — from ${source.owner}. ${source.detail}`}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </fieldset>
      ))}
      <p class="tkr-settings-staged" role="status">
        {pendingCount === 0
          ? "No staged settings."
          : `${pendingCount} staged ${pendingCount === 1 ? "setting is" : "settings are"} not applied yet${errorCount === 0 ? "" : `; fix ${errorCount} ${errorCount === 1 ? "error" : "errors"} to apply`}. Save writes only applied settings.`}
      </p>
      {refusal === null ? null : (
        <p key={refusal.key} class="tkr-settings-error" role="alert">
          The settings were not applied: {refusal.message}
        </p>
      )}
      <button type="button" class="tkr-settings-apply" disabled={readOnly || applying || pendingCount === 0 || errorCount > 0} onClick={apply}>
        Apply changes
      </button>
      <button type="button" class="tkr-settings-discard" disabled={applying || (Object.keys(staged).length === 0 && packageDraft === "")} onClick={cancel}>
        Cancel changes
      </button>
    </div>
  );
}
