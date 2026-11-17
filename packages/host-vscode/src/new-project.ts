import {
  STARTER_DEFINITIONS,
  createNewProject,
  suggestedMainFile,
  validateNewProject,
  type NewProjectProblem,
  type NewProjectSettings,
  type NewProjectStorage,
  type StarterDefinition,
  type WizardHistory,
} from "@tk-reawakened/editor-model";

/**
 * The new-project questions (T-04) for a host with no form of its own: one question after another, each answerable from the
 * keyboard, each cancellable. The model decides what is valid and writes the project; the host's input box, pick list and
 * folder dialog only show and ask, so VS Code and the browser make the same project from the same answers. Dismissing any
 * question, or the folder dialog, creates nothing.
 */
export interface NewProjectUi {
  /** Ask for a line of text; `undefined` when the user dismisses it. `validate` answers a problem to show, or `null`. */
  input(question: { readonly title: string; readonly prompt: string; readonly value: string; readonly validate: (value: string) => string | null }): Promise<string | undefined>;
  /**
   * Ask which of `items` to copy in; none is chosen at first, and `undefined` means the user dismissed it (an empty list is
   * an answer: a blank project). An item with `available: false` is listed with its `detail` reason; picking it is refused
   * by the model, not dropped.
   */
  pickMany(question: {
    readonly title: string;
    readonly items: readonly { readonly id: string; readonly label: string; readonly description: string; readonly detail: string; readonly available: boolean }[];
  }): Promise<readonly string[] | undefined>;
}

/** A folder the person chose, as the file system the project is written to and as the host's own handle to it. */
export interface NewProjectDestination<Handle> {
  readonly storage: NewProjectStorage;
  readonly handle: Handle;
  /** The new project's own history, so the whole creation is one restorable group (ADR 0022 D12.10 item 6). */
  readonly history?: WizardHistory;
}

export interface NewProjectEnvironment<Handle> {
  readonly ui: NewProjectUi;
  /** Ask for the destination folder; `undefined` when the user dismisses the dialog. */
  readonly chooseDestination: () => Promise<NewProjectDestination<Handle> | undefined>;
  /** The starter items to offer and create; the catalogue by default. */
  readonly starters?: readonly StarterDefinition[];
}

export type NewProjectOutcome<Handle> =
  | { readonly ok: true; readonly handle: Handle; readonly mainPath: string; readonly written: readonly string[] }
  | { readonly ok: false; readonly reason: "cancelled" | "refused"; readonly message: string };

const cancelled: NewProjectOutcome<never> = { ok: false, reason: "cancelled", message: "No project was created." };

export async function runNewProject<Handle>(env: NewProjectEnvironment<Handle>): Promise<NewProjectOutcome<Handle>> {
  const starters = env.starters ?? STARTER_DEFINITIONS;
  const { ui } = env;
  const title = "New project";
  const message = (problems: readonly NewProjectProblem[], field: keyof NewProjectSettings): string | null => problems.find((problem) => problem.field === field)?.message ?? null;

  const gameName = await ui.input({ title, prompt: "Game name", value: "", validate: (value) => message(validateNewProject({ gameName: value, mainFile: "x.gam", starters: [] }, starters), "gameName") });
  if (gameName === undefined) return cancelled;
  const mainFile = await ui.input({
    title,
    prompt: "Main file name (kept in the Main folder)",
    value: suggestedMainFile(gameName),
    validate: (value) => message(validateNewProject({ gameName, mainFile: value, starters: [] }, starters), "mainFile"),
  });
  if (mainFile === undefined) return cancelled;
  const picked = await ui.pickMany({
    title: `${title}: starter contents (nothing is copied unless you tick it)`,
    items: starters.map((item) => ({
      id: item.id,
      label: item.label,
      description: item.unavailable === null && item.contribute !== null ? item.writes : "Not available",
      detail: item.unavailable === null && item.contribute !== null ? `${item.description} Provenance: ${item.provenance}` : item.unavailable ?? "No material is available.",
      available: item.unavailable === null && item.contribute !== null,
    })),
  });
  if (picked === undefined) return cancelled;

  const settings: NewProjectSettings = { gameName, mainFile, starters: picked };
  // Refused before the folder dialog, so a mistake is said while the person is still answering questions.
  const problems = validateNewProject(settings, starters);
  if (problems.length > 0) return { ok: false, reason: "refused", message: problems[0]!.message };
  const destination = await env.chooseDestination();
  if (destination === undefined) return cancelled;

  try {
    const created = await createNewProject(destination.storage, settings, starters, destination.history);
    if (!created.ok) return { ok: false, reason: "refused", message: created.message };
    return { ok: true, handle: destination.handle, mainPath: created.mainPath, written: created.written };
  } catch (error) {
    return { ok: false, reason: "refused", message: error instanceof Error ? error.message : String(error) };
  }
}
