/**
 * The save-area identity a command may write under (AD-17).
 *
 * The engine hands commands its derived `GameId`, or `null` when it has none
 * (a scene engine, which has no main file). No command invents a namespace: a
 * missing identity is a located script error, never a shared `default` area.
 */
import { ScriptError } from "./errors.ts";
import type { CommandView } from "./plugin.ts";

export function requireGameId(view: CommandView): string {
  if (view.gameId === null) {
    throw new ScriptError(
      "save.no-game-identity",
      "this game has no save area: the host supplied no game identity, and a scene engine has no main file (docs/spec/formats/save-game.md#reawakened-full-engine-save-and-load)",
    );
  }
  return view.gameId;
}
