import { createDocumentIdentity, createFontFile, fontDestinationProblem, projectLayoutOfMain, suggestFontPath, type ProjectLayout } from "@tk-reawakened/editor-model";
import type { FileSystemService } from "@tk-reawakened/platform-services";

/**
 * The new-font question (T-65) for a host with no form of its own: one input box, cancellable, that starts from the first
 * free name in the game's `Font` folder. The model decides what is valid and writes the file; the host's input box only
 * asks, so VS Code and the browser make the same font from the same answer.
 */
export interface NewFontUi {
  /** Ask for a line of text; `undefined` when the user dismisses it. `validate` answers a problem to show, or `null`. */
  input(question: { readonly title: string; readonly prompt: string; readonly value: string; readonly validate: (value: string) => string | null }): Promise<string | undefined>;
}

/** The services a new font needs: the listing, the write, and the main file's reading (to find the game's own folder). */
export type NewFontFileSystem = Pick<FileSystemService, "list" | "write" | "readProject">;

export interface NewFontEnvironment {
  readonly fs: NewFontFileSystem;
  readonly projectId: string;
  /** The game the host has open, when it knows one: its main file. A project with several games asks instead. */
  readonly activeGame?: string;
  readonly ui: NewFontUi;
}

export type NewFontOutcome =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: "cancelled" | "refused"; readonly message: string };

/** One game of the project: its main file and the layout that file gives (its project folder, or the root). */
export interface FontGame {
  readonly main: string;
  readonly layout: ProjectLayout;
}

/**
 * Every game of the project — each `.gam` file, with the layout its own main file names. A project may hold several, so the
 * caller picks one rather than taking whichever the listing reached first.
 */
export async function fontGames(fs: Pick<FileSystemService, "list" | "readProject">, projectId: string): Promise<FontGame[]> {
  const pending = [""];
  const seen = new Set<string>();
  const games: FontGame[] = [];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    if (seen.has(directory)) continue;
    seen.add(directory);
    const listing = await fs.list(directory);
    if (!listing.ok) continue;
    for (const entry of listing.value) {
      const path = directory === "" ? entry.name : `${directory}/${entry.name}`;
      if (entry.kind === "directory") pending.push(path);
      else if (entry.kind === "file" && /\.gam$/i.test(path)) games.push({ main: path, layout: await projectLayoutOfMain(fs, projectId, path) });
    }
  }
  return games.sort((left, right) => left.main.localeCompare(right.main));
}

/** Ask for the font's path (it starts as a suggestion) and create it with all 256 glyphs empty. */
export async function runNewFont(env: NewFontEnvironment): Promise<NewFontOutcome> {
  try {
    const games = await fontGames(env.fs, env.projectId);
    const gameNamed = (path: string): FontGame | undefined => {
      const key = createDocumentIdentity(env.projectId, path.trim().replace(/[/\\]+$/, "")).key;
      return games.find((game) => createDocumentIdentity(env.projectId, game.main).key === key);
    };
    const active = env.activeGame === undefined ? undefined : gameNamed(env.activeGame);
    let game: FontGame | undefined = active;
    if (game === undefined && games.length > 1) {
      // More than one game and none named: ask, instead of writing into whichever game the listing reached first.
      const names = games.map((candidate) => candidate.main);
      const answer = await env.ui.input({
        title: "New font: which game?",
        prompt: `This project has ${games.length} games. Type the one the font belongs to: ${names.join(", ")}.`,
        value: names[0] ?? "",
        validate: (value) => (gameNamed(value) === undefined ? `Type one of: ${names.join(", ")}.` : null),
      });
      if (answer === undefined) return { ok: false, reason: "cancelled", message: "No font was created." };
      game = gameNamed(answer);
      if (game === undefined) return { ok: false, reason: "cancelled", message: "No font was created." };
    }
    const layout: ProjectLayout = game?.layout ?? games[0]?.layout ?? { projectFolder: "" };
    const suggested = await suggestFontPath(env.fs, layout);
    const chosen = await env.ui.input({
      title: "New font",
      prompt: `A folder named Font in ${layout.projectFolder === "" ? "the project" : layout.projectFolder}. An external application could create this path after the check and before writing; the write may replace that file.`,
      value: suggested,
      validate: (value) => fontDestinationProblem(value.trim(), layout),
    });
    if (chosen === undefined) return { ok: false, reason: "cancelled", message: "No font was created." };
    const created = await createFontFile(env.fs, chosen.trim(), layout);
    return created.ok ? { ok: true, path: created.path } : { ok: false, reason: "refused", message: created.message };
  } catch (error) {
    return { ok: false, reason: "refused", message: error instanceof Error ? error.message : String(error) };
  }
}
