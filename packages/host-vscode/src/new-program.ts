import {
  createPreferences,
  createProgramFile,
  programPreferencesFrom,
  suggestProgramPath,
  type NewProgramStorage,
  type ProjectLayout,
} from "@tk-reawakened/editor-model";
import type { SettingsService } from "@tk-reawakened/platform-services";

/**
 * The new-program question (T-40) for a host with no form of its own: one input box, cancellable, that starts from the first
 * free name in the programs folder. The model decides what is valid and writes the file, starting with the header template
 * of the preferences; the host's input box only asks, so VS Code and the browser make the same program from the same answer.
 */
export interface NewProgramUi {
  /** Ask for a line of text; `undefined` when the user dismisses it. `validate` answers a problem to show, or `null`. */
  input(question: { readonly title: string; readonly prompt: string; readonly value: string; readonly validate: (value: string) => string | null }): Promise<string | undefined>;
}

export interface NewProgramEnvironment {
  readonly fs: NewProgramStorage;
  readonly layout: ProjectLayout;
  readonly settings: SettingsService;
  readonly ui: NewProgramUi;
}

export type NewProgramOutcome =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: "cancelled" | "refused"; readonly message: string };

/** Ask for the program's path (it starts as a suggestion) and create it with the header template. */
export async function runNewProgram(env: NewProgramEnvironment): Promise<NewProgramOutcome> {
  const preferences = createPreferences({ settings: env.settings, projectLayer: true });
  await preferences.refresh();
  try {
    const suggested = await suggestProgramPath(env.fs, env.layout);
    const chosen = await env.ui.input({
      title: "New program",
      prompt: "Path of the new program in the project",
      value: suggested,
      validate: (value) => (/\.prg$/i.test(value.trim()) && !value.trim().endsWith("/.prg") ? null : "A program's name ends in .prg."),
    });
    if (chosen === undefined) return { ok: false, reason: "cancelled", message: "No program was created." };
    const created = await createProgramFile(env.fs, chosen.trim(), programPreferencesFrom(preferences.getSnapshot()).headerTemplate);
    return created.ok ? { ok: true, path: created.path } : { ok: false, reason: "refused", message: created.message };
  } catch (error) {
    return { ok: false, reason: "refused", message: error instanceof Error ? error.message : String(error) };
  } finally {
    preferences.dispose();
  }
}
