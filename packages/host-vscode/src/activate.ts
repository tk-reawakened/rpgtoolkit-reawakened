import type { ExtensionContext } from "vscode";
import { registerGameSettings, registerNewBoard } from "./extension.ts";
import { registerProgramCommands } from "./program-commands.ts";

export function activate(context: ExtensionContext): void {
  const generation = registerGameSettings(context);
  registerNewBoard(context, generation);
  registerProgramCommands(context, generation);
}

export function deactivate(): void {}
