import type { ExtensionContext } from "vscode";
import { registerGameSettings, registerNewProject } from "./extension.ts";
import { registerProgramCommands } from "./program-commands.ts";

export function activate(context: ExtensionContext): void {
  const generation = registerGameSettings(context);
  registerProgramCommands(context, generation);
  registerNewProject(context);
}

export function deactivate(): void {}
