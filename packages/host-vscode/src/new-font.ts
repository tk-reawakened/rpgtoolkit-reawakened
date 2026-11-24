import { createFontFile, suggestFontPath, type NewFontStorage, type ProjectLayout } from "@tk-reawakened/editor-model";

/**
 * The new-font question (T-65) for a host with no form of its own: one input box, cancellable, that starts from the first
 * free name in the project's `Font` folder. The model decides what is valid and writes the file; the host's input box only
 * asks, so VS Code and the browser make the same font from the same answer.
 */
export interface NewFontUi {
  /** Ask for a line of text; `undefined` when the user dismisses it. `validate` answers a problem to show, or `null`. */
  input(question: { readonly title: string; readonly prompt: string; readonly value: string; readonly validate: (value: string) => string | null }): Promise<string | undefined>;
}

export interface NewFontEnvironment {
  readonly fs: NewFontStorage;
  readonly layout: ProjectLayout;
  readonly ui: NewFontUi;
}

export type NewFontOutcome =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: "cancelled" | "refused"; readonly message: string };

/** Ask for the font's path (it starts as a suggestion) and create it with all 256 glyphs empty. */
export async function runNewFont(env: NewFontEnvironment): Promise<NewFontOutcome> {
  try {
    const suggested = await suggestFontPath(env.fs, env.layout);
    const chosen = await env.ui.input({
      title: "New font",
      prompt: "A folder named Font in the project. An external application could create this path after the check and before writing; the write may replace that file.",
      value: suggested,
      validate: (value) => (/\.fnt$/i.test(value.trim()) && !value.trim().endsWith("/.fnt") ? null : "A font's name ends in .fnt."),
    });
    if (chosen === undefined) return { ok: false, reason: "cancelled", message: "No font was created." };
    const created = await createFontFile(env.fs, chosen.trim());
    return created.ok ? { ok: true, path: created.path } : { ok: false, reason: "refused", message: created.message };
  } catch (error) {
    return { ok: false, reason: "refused", message: error instanceof Error ? error.message : String(error) };
  }
}
