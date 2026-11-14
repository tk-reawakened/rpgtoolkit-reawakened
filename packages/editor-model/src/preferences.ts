// Editor preferences (story 11.5, T-08 and T-33; ADR 0022 D6). A declarative catalogue of the settings that belong to
// the editor and never to a game, a validator for each entry, and a model that works out each setting's effective value
// from the layers a host stores. DOM-free and framework-free: a view renders the snapshot, a host stores the layers.
import type { SettingValue, SettingsLayer, SettingsService } from "@tk-reawakened/platform-services";

/** The value types a catalogue entry can have (ADR 0022 D6.2). `list` holds strings. */
export type PreferenceType = "boolean" | "number" | "string" | "enum" | "color" | "list";

interface PreferenceBase {
  /** Stable id. It is the key every host stores the value under. Never reused for another meaning. */
  readonly id: string;
  /** The group the preference is listed under. */
  readonly group: string;
  /** A short name for the preference. */
  readonly label: string;
  /** What the preference does, in plain words for a person writing a game. */
  readonly description: string;
  /**
   * Whether a value may be stored in the project layer. `false` marks a user-only entry: a project someone cloned must not
   * change another person's settings, so a project-layer value for it is ignored and reported (ADR 0022 D6.3).
   */
  readonly projectLayer: boolean;
}

export type PreferenceEntry =
  | (PreferenceBase & { readonly type: "boolean"; readonly default: boolean })
  | (PreferenceBase & { readonly type: "number"; readonly default: number; readonly min: number; readonly max: number; readonly integer: boolean })
  | (PreferenceBase & { readonly type: "string"; readonly default: string; readonly maxLength: number })
  | (PreferenceBase & { readonly type: "enum"; readonly default: string; readonly options: readonly { readonly value: string; readonly label: string }[] })
  | (PreferenceBase & { readonly type: "color"; readonly default: string })
  | (PreferenceBase & { readonly type: "list"; readonly default: readonly string[]; readonly maxItems: number });

const EDITOR = "Editor";
const SYNTAX = "Syntax colours";
const BOARD = "Board editor";

const toggle = (id: string, group: string, label: string, description: string, value: boolean, projectLayer = false): PreferenceEntry =>
  ({ id, group, label, description, type: "boolean", default: value, projectLayer });
const colour = (id: string, group: string, label: string, description: string, value: string): PreferenceEntry =>
  ({ id, group, label, description, type: "color", default: value, projectLayer: false });

/** The preferences of T-08 (editor background, splash, tips, language, syntax colours) and T-33 (board editor). */
export const PREFERENCE_CATALOGUE: readonly PreferenceEntry[] = [
  {
    id: "editor.backgroundImage",
    group: EDITOR,
    label: "Background image",
    description:
      "A picture shown behind the editor's panels. Leave it empty for a plain background. Give a path inside your project, such as Bitmaps/backdrop.png; it is only looked up when the editor opens.",
    type: "string",
    default: "",
    maxLength: 260,
    projectLayer: false,
  },
  toggle("editor.showSplash", EDITOR, "Show the splash screen", "Show the title picture while the editor opens.", true),
  toggle("editor.showTips", EDITOR, "Show a tip when the editor opens", "Show one hint about the editor each time it opens.", true),
  {
    id: "editor.language",
    group: EDITOR,
    label: "Interface language",
    description: "The language of the editor's own words. English is the only language the editor ships.",
    type: "enum",
    default: "en",
    options: [{ value: "en", label: "English" }],
    projectLayer: false,
  },
  colour("syntax.keyword.color", SYNTAX, "Keyword colour", "The colour of RPGCode commands and keywords in the program editor.", "#0000ff"),
  colour("syntax.comment.color", SYNTAX, "Comment colour", "The colour of comments in the program editor.", "#008000"),
  colour("syntax.string.color", SYNTAX, "String colour", "The colour of text in quotation marks in the program editor.", "#a31515"),
  colour("syntax.number.color", SYNTAX, "Number colour", "The colour of numbers in the program editor.", "#098658"),
  toggle("syntax.keyword.bold", SYNTAX, "Bold keywords", "Draw RPGCode keywords in bold.", false),
  toggle("syntax.comment.italic", SYNTAX, "Italic comments", "Draw comments in italics.", true),
  toggle("board.revertToDrawAfterFlood", BOARD, "Return to Draw after a flood fill", "After a flood fill, switch the board editor back to the Draw tool.", true),
  toggle("board.showVectorPointIndices", BOARD, "Show vector point numbers", "Draw each point's number beside the points of a vector shape.", false),
  toggle("board.recursiveFlood", BOARD, "Flood fill across layers", "Let a flood fill continue through every layer instead of the current layer only.", false),
  toggle("board.showNewBoardDialog", BOARD, "Ask before creating a board", "Show the new-board questions each time you create a board.", true),
  {
    id: "board.new.coordSystem",
    group: BOARD,
    label: "New board: layout",
    description: "The layout the new-board questions start with, which is the one you chose for your last new board.",
    type: "enum",
    default: "2d",
    options: [
      { value: "2d", label: "Top-down (2D)" },
      { value: "iso-stacked", label: "Isometric, stacked" },
      { value: "iso-rotated", label: "Isometric, rotated" },
    ],
    projectLayer: false,
  },
  toggle("board.new.pixelCoordinates", BOARD, "New board: use pixel coordinates", "Whether the new-board questions start with pixel coordinates on, as in your last new board.", false),
  { id: "board.new.width", group: BOARD, label: "New board: width", description: "The width in tiles the new-board questions start with.", type: "number", default: 20, min: 1, max: 1000, integer: true, projectLayer: false },
  { id: "board.new.height", group: BOARD, label: "New board: height", description: "The height in tiles the new-board questions start with.", type: "number", default: 15, min: 1, max: 1000, integer: true, projectLayer: false },
  { id: "board.new.layers", group: BOARD, label: "New board: layers", description: "The number of layers the new-board questions start with.", type: "number", default: 2, min: 1, max: 64, integer: true, projectLayer: false },
  {
    id: "board.startLocationDisplay",
    group: BOARD,
    label: "Show the player start",
    description:
      "Where the board editor draws the player's start cross: only on the board the game begins on, or on every board. A game can set this for everyone who edits it.",
    type: "enum",
    default: "initial",
    options: [
      { value: "initial", label: "Only on the first board" },
      { value: "every", label: "On every board" },
    ],
    projectLayer: true,
  },
  colour("board.objectColor.program", BOARD, "Program marker colour", "The colour of program markers on a board.", "#ffff00"),
  colour("board.objectColor.item", BOARD, "Item marker colour", "The colour of item markers on a board.", "#00ffff"),
  colour("board.objectColor.sprite", BOARD, "Character marker colour", "The colour of character markers on a board.", "#ff00ff"),
  colour("board.objectColor.vector", BOARD, "Vector colour", "The colour of vector shapes on a board.", "#ff0000"),
];

const BY_ID = new Map(PREFERENCE_CATALOGUE.map((entry) => [entry.id, entry]));

/** The catalogue entry for `id`, or `undefined` when it names none. */
export function preferenceById(id: string): PreferenceEntry | undefined {
  return BY_ID.get(id);
}

/** What `validatePreference` says. A reason is a sentence safe to show beside the field. */
export type PreferenceValidation = { readonly ok: true; readonly value: SettingValue } | { readonly ok: false; readonly reason: string };

const COLOR = /^#[0-9a-fA-F]{6}$/;

/** Check `value` against the entry. Nothing is coerced: a value of the wrong kind is refused with the reason, never turned into one that fits. */
export function validatePreference(entry: PreferenceEntry, value: unknown): PreferenceValidation {
  const refuse = (reason: string): PreferenceValidation => ({ ok: false, reason });
  switch (entry.type) {
    case "boolean":
      return typeof value === "boolean" ? { ok: true, value } : refuse("Choose on or off.");
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) return refuse("Enter a number.");
      if (entry.integer && !Number.isInteger(value)) return refuse("Enter a whole number.");
      if (value < entry.min || value > entry.max) return refuse(`Enter a number from ${entry.min} to ${entry.max}.`);
      return { ok: true, value };
    case "string":
      if (typeof value !== "string") return refuse("Enter text.");
      if (value.length > entry.maxLength) return refuse(`Use at most ${entry.maxLength} characters.`);
      if (/[\u0000-\u001f]/.test(value)) return refuse("Use a single line of text.");
      return { ok: true, value };
    case "enum":
      return typeof value === "string" && entry.options.some((option) => option.value === value)
        ? { ok: true, value }
        : refuse(`Choose one of: ${entry.options.map((option) => option.label).join(", ")}.`);
    case "color":
      return typeof value === "string" && COLOR.test(value) ? { ok: true, value: value.toLowerCase() } : refuse("Enter a colour as # and six hexadecimal digits, such as #1a2b3c.");
    case "list":
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return refuse("Enter a list of text items.");
      if (value.length > entry.maxItems) return refuse(`Use at most ${entry.maxItems} items.`);
      return { ok: true, value: value as readonly string[] };
  }
}

/** Where an effective value comes from. */
export type PreferenceSource = "default" | "user" | "project";

/** A stored value the model did not use, said once (ADR 0022 D6.2, D6.3). */
export interface PreferenceProblem {
  readonly id: string;
  readonly layer: SettingsLayer;
  readonly reason: string;
}

/** One preference as a view shows it. */
export interface PreferenceRow {
  readonly entry: PreferenceEntry;
  /** The value in force: the project's when it has one the entry allows, else the user's, else the default. */
  readonly effective: SettingValue;
  /** The layer the effective value comes from. */
  readonly source: PreferenceSource;
  /** What each layer holds after validation; `null` when the layer holds nothing usable. */
  readonly layers: { readonly user: SettingValue | null; readonly project: SettingValue | null };
  /** `true` when the user's value differs from the default, so "reset" has something to do to the user layer. */
  readonly canResetUser: boolean;
  readonly canResetProject: boolean;
}

export interface PreferencesSnapshot {
  readonly rows: readonly PreferenceRow[];
  /** Every stored value ignored since the model opened, each reported once. */
  readonly problems: readonly PreferenceProblem[];
  /** Whether the host stores the project layer; when it does not, the project-layer controls say so. */
  readonly projectLayerAvailable: boolean;
}

/** What setting or resetting a value answers. */
export type PreferenceResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export interface Preferences {
  getSnapshot(): PreferencesSnapshot;
  subscribe(listener: () => void): () => void;
  /** Read every layer again from the host. Resolves when the snapshot is current. */
  refresh(): Promise<void>;
  /** Store `value` in `layer` after validating it. A refused value is stored nowhere and the snapshot is unchanged. */
  set(id: string, layer: SettingsLayer, value: unknown): Promise<PreferenceResult>;
  /** Remove the value from `layer`, so the next layer down shows through. */
  reset(id: string, layer: SettingsLayer): Promise<PreferenceResult>;
  /** The rows whose group, label, description or id contain every word of `query`, case-insensitively. An empty query lists every row. */
  search(query: string): readonly PreferenceRow[];
  dispose(): void;
}

export interface PreferencesOptions {
  readonly settings: SettingsService;
  /** Whether the host stores the project layer. Defaults to `true`. */
  readonly projectLayer?: boolean;
  /** The catalogue to use; `PREFERENCE_CATALOGUE` by default. */
  readonly catalogue?: readonly PreferenceEntry[];
}

/** Make the preferences model over a host's settings service. Call `refresh()` to load the stored layers. */
export function createPreferences(options: PreferencesOptions): Preferences {
  const catalogue = options.catalogue ?? PREFERENCE_CATALOGUE;
  const projectAvailable = options.projectLayer ?? true;
  const stored = new Map<string, { user: SettingValue | null; project: SettingValue | null }>();
  const problems: PreferenceProblem[] = [];
  const reported = new Set<string>();
  const listeners = new Set<() => void>();
  let disposed = false;
  let snapshot: PreferencesSnapshot = { rows: [], problems: [], projectLayerAvailable: projectAvailable };

  const report = (problem: PreferenceProblem, valueKey: string): void => {
    const key = `${problem.layer}\u0000${problem.id}\u0000${valueKey}`;
    if (reported.has(key)) return;
    reported.add(key);
    problems.push(problem);
  };

  /** Work out one entry's row from what the layers hold. A stored value that does not pass is reported once and not used. */
  const build = (entry: PreferenceEntry): PreferenceRow => {
    const layers = stored.get(entry.id) ?? { user: null, project: null };
    const usable: { user: SettingValue | null; project: SettingValue | null } = { user: null, project: null };
    for (const layer of ["user", "project"] as const) {
      const value = layers[layer];
      if (value === null) continue;
      if (layer === "project" && !entry.projectLayer) {
        report({ id: entry.id, layer, reason: `“${entry.label}” is a personal preference; the project's value is ignored.` }, JSON.stringify(value));
        continue;
      }
      const checked = validatePreference(entry, value);
      if (!checked.ok) {
        report({ id: entry.id, layer, reason: `The stored ${layer} value for “${entry.label}” is not valid (${checked.reason}); the default is used.` }, JSON.stringify(value));
        continue;
      }
      usable[layer] = checked.value;
    }
    const source: PreferenceSource = usable.project !== null ? "project" : usable.user !== null ? "user" : "default";
    const effective = usable.project ?? usable.user ?? entry.default;
    return { entry, effective, source, layers: usable, canResetUser: layers.user !== null, canResetProject: layers.project !== null };
  };

  const publish = (): void => {
    snapshot = { rows: catalogue.map(build), problems: [...problems], projectLayerAvailable: projectAvailable };
    for (const listener of [...listeners]) listener();
  };

  const entryFor = (id: string): PreferenceEntry | null => catalogue.find((entry) => entry.id === id) ?? null;
  const layerOpen = (layer: SettingsLayer): string | null => (layer === "project" && !projectAvailable ? "This host does not keep project preferences." : null);

  const write = async (entry: PreferenceEntry, layer: SettingsLayer, value: SettingValue | null): Promise<PreferenceResult> => {
    const saved = await options.settings.set(layer, entry.id, value);
    if (!saved.ok) return { ok: false, reason: `The ${layer} preference could not be saved: ${saved.error.message}` };
    const held = stored.get(entry.id) ?? { user: null, project: null };
    stored.set(entry.id, { ...held, [layer]: value });
    if (!disposed) publish();
    return { ok: true };
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    async refresh() {
      const layers: SettingsLayer[] = projectAvailable ? ["user", "project"] : ["user"];
      for (const entry of catalogue) {
        const held = { user: null as SettingValue | null, project: null as SettingValue | null };
        for (const layer of layers) {
          const read = await options.settings.get(layer, entry.id);
          if (read.ok) held[layer] = read.value;
        }
        stored.set(entry.id, held);
      }
      if (!disposed) publish();
    },
    async set(id, layer, value) {
      const entry = entryFor(id);
      if (entry === null) return { ok: false, reason: `There is no preference called “${id}”.` };
      const closed = layerOpen(layer);
      if (closed !== null) return { ok: false, reason: closed };
      if (layer === "project" && !entry.projectLayer) return { ok: false, reason: `“${entry.label}” is a personal preference and cannot be set for the project.` };
      const checked = validatePreference(entry, value);
      if (!checked.ok) return { ok: false, reason: checked.reason };
      return write(entry, layer, checked.value);
    },
    async reset(id, layer) {
      const entry = entryFor(id);
      if (entry === null) return { ok: false, reason: `There is no preference called “${id}”.` };
      const closed = layerOpen(layer);
      if (closed !== null) return { ok: false, reason: closed };
      return write(entry, layer, null);
    },
    search(query) {
      const words = query.toLowerCase().split(/\s+/).filter((word) => word !== "");
      return snapshot.rows.filter((row) => {
        const text = `${row.entry.group} ${row.entry.label} ${row.entry.description} ${row.entry.id}`.toLowerCase();
        return words.every((word) => text.includes(word));
      });
    },
    dispose() {
      disposed = true;
      listeners.clear();
    },
  };
}

/** The VS Code settings block the catalogue generates (ADR 0022 D6.4): every entry under `rpgToolkit.`, scope `window`. */
export interface VscodeConfiguration {
  readonly title: string;
  readonly properties: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

/** What `contributes.configuration` and `restrictedConfigurations` should hold for `catalogue`. */
export function vscodeContributions(catalogue: readonly PreferenceEntry[] = PREFERENCE_CATALOGUE): {
  readonly configuration: VscodeConfiguration;
  readonly restrictedConfigurations: readonly string[];
} {
  const properties: Record<string, Record<string, unknown>> = {};
  const restricted: string[] = [];
  for (const entry of catalogue) {
    const base: Record<string, unknown> = { description: `${entry.label}. ${entry.description}`, scope: "window" };
    switch (entry.type) {
      case "boolean": base.type = "boolean"; base.default = entry.default; break;
      case "number": base.type = entry.integer ? "integer" : "number"; base.default = entry.default; base.minimum = entry.min; base.maximum = entry.max; break;
      case "string": base.type = "string"; base.default = entry.default; base.maxLength = entry.maxLength; break;
      case "enum": base.type = "string"; base.default = entry.default; base.enum = entry.options.map((option) => option.value); base.enumDescriptions = entry.options.map((option) => option.label); break;
      case "color": base.type = "string"; base.default = entry.default; base.pattern = COLOR.source; base.patternErrorMessage = "Enter a colour as # and six hexadecimal digits."; break;
      case "list": base.type = "array"; base.default = [...entry.default]; base.items = { type: "string" }; base.maxItems = entry.maxItems; break;
    }
    const key = `rpgToolkit.${entry.id}`;
    properties[key] = base;
    // A project that is not trusted must not set a personal preference; shared code ignores it too (D6.3).
    if (!entry.projectLayer) restricted.push(key);
  }
  return { configuration: { title: "RPG Toolkit", properties }, restrictedConfigurations: restricted };
}
