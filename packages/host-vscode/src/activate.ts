import type { ExtensionContext } from "vscode";
import { registerGameSettings, registerNewProject } from "./extension.ts";
import { registerProgramCommands } from "./program-commands.ts";
import { registerCreatorTests } from "./creator-tests.ts";

export function activate(context: ExtensionContext): void {
  const generation = registerGameSettings(context);
  registerProgramCommands(context, generation);
  registerCreatorTests(context, generation);
  registerNewProject(context);
}

export function deactivate(): void {}
