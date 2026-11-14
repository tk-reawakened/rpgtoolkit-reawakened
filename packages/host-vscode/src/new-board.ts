import {
  BOARD_COORD_SYSTEMS,
  asksBeforeCreating,
  createBoardFile,
  createPreferences,
  listCandidates,
  newBoardSettingsFrom,
  readBoardTemplate,
  rememberNewBoard,
  uniqueBoardName,
  validateNewBoard,
  type BoardCoordSystem,
  type NewBoardSettings,
  type NewBoardStorage,
  type ProjectLayout,
} from "@tk-reawakened/editor-model";
import type { SettingsService } from "@tk-reawakened/platform-services";

/**
 * The new-board questions (T-20) for a host with no form of its own: one question after another, each answerable from the
 * keyboard, each cancellable. The model decides what is valid and writes the file; the host's input box and pick list only
 * show and ask, so VS Code and the browser make the same board from the same answers. Cancelling any question creates
 * nothing.
 */
export interface NewBoardUi {
  /** Ask for a line of text; `undefined` when the user dismisses it. `validate` answers a problem to show, or `null`. */
  input(question: { readonly title: string; readonly prompt: string; readonly value: string; readonly validate: (value: string) => string | null }): Promise<string | undefined>;
  /** Ask for one of `items`; `undefined` when the user dismisses it. */
  pick(question: { readonly title: string; readonly items: readonly { readonly id: string; readonly label: string; readonly description?: string }[] }): Promise<string | undefined>;
}

export interface NewBoardEnvironment {
  readonly fs: NewBoardStorage;
  readonly layout: ProjectLayout;
  readonly settings: SettingsService;
  readonly ui: NewBoardUi;
}

export type NewBoardOutcome =
  | { readonly ok: true; readonly path: string; /** A sentence when the choices could not be remembered. */ readonly warning: string | null }
  | { readonly ok: false; readonly reason: "cancelled" | "refused"; readonly message: string };

const cancelled: NewBoardOutcome = { ok: false, reason: "cancelled", message: "No board was created." };

/** Ask the questions (or skip them when the preference says so) and create the board. */
export async function runNewBoard(env: NewBoardEnvironment): Promise<NewBoardOutcome> {
  const preferences = createPreferences({ settings: env.settings, projectLayer: true });
  await preferences.refresh();
  try {
    const remembered = newBoardSettingsFrom(preferences.getSnapshot());
    let settings: NewBoardSettings;
    if (asksBeforeCreating(preferences.getSnapshot())) {
      const asked = await ask(env, remembered);
      if (asked === null) return cancelled;
      settings = asked;
    } else {
      settings = { ...remembered, name: await uniqueBoardName(env.fs, env.layout) };
    }
    const created = await createBoardFile(env.fs, env.layout, settings);
    if (!created.ok) return { ok: false, reason: "refused", message: created.message };
    return { ok: true, path: created.path, warning: await rememberNewBoard(preferences, settings) };
  } catch (error) {
    return { ok: false, reason: "refused", message: error instanceof Error ? error.message : String(error) };
  } finally {
    preferences.dispose();
  }
}

async function ask(env: NewBoardEnvironment, remembered: NewBoardSettings): Promise<NewBoardSettings | null> {
  const { ui } = env;
  const title = "New board";
  const field = (name: keyof NewBoardSettings, current: NewBoardSettings) => (value: string): string | null =>
    validateNewBoard({ ...current, ...{ [name]: name === "name" || name === "backgroundImage" ? value : Number(value) } as Partial<NewBoardSettings> }).find((problem) => problem.field === name)?.message ?? null;

  const name = await ui.input({ title, prompt: "Name of the new board", value: "", validate: field("name", { ...remembered, name: "" }) });
  if (name === undefined) return null;
  let settings: NewBoardSettings = { ...remembered, name };

  const candidates = await listCandidates(env.fs, env.layout, "boards", [".brd"]);
  if (candidates.candidates.length > 0) {
    const chosen = await ui.pick({
      title: `${title}: start from`,
      items: [{ id: "", label: "A blank board" }, ...candidates.candidates.map((candidate) => ({ id: candidate.path, label: candidate.reference, description: "use as a template" }))],
    });
    if (chosen === undefined) return null;
    if (chosen !== "") {
      const described = await readBoardTemplate(env.fs, chosen);
      if (!described.ok) throw new Error(described.message);
      settings = { ...settings, ...described.settings, template: chosen };
    }
  }

  const system = await ui.pick({
    title: `${title}: layout`,
    items: BOARD_COORD_SYSTEMS.map((entry) => ({ id: entry.value, label: entry.label, ...(entry.value === settings.coordSystem ? { description: "current" } : {}) })),
  });
  if (system === undefined) return null;
  const pixels = await ui.pick({
    title: `${title}: coordinates`,
    items: [
      { id: "tiles", label: "Tile coordinates", ...(settings.pixelCoordinates ? {} : { description: "current" }) },
      { id: "pixels", label: "Use pixel coordinates", ...(settings.pixelCoordinates ? { description: "current" } : {}) },
    ],
  });
  if (pixels === undefined) return null;
  settings = { ...settings, coordSystem: system as BoardCoordSystem, pixelCoordinates: pixels === "pixels" };

  for (const [key, prompt] of [["width", "Width in tiles"], ["height", "Height in tiles"], ["layers", "Number of layers"]] as const) {
    const answer = await ui.input({ title, prompt, value: String(settings[key]), validate: field(key, settings) });
    if (answer === undefined) return null;
    settings = { ...settings, [key]: Number(answer) };
  }
  const background = await ui.input({ title, prompt: "Background image (leave empty for none)", value: settings.backgroundImage, validate: field("backgroundImage", settings) });
  if (background === undefined) return null;
  return { ...settings, backgroundImage: background };
}
