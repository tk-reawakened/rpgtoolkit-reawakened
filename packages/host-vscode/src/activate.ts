import type { ExtensionContext } from "vscode";
import { registerGameSettings, registerNewBoard, registerNewProject } from "./extension.ts";
import { registerProgramCommands } from "./program-commands.ts";
import { registerCreatorTests } from "./creator-tests.ts";

export function activate(context: ExtensionContext): void {
  const generation = registerGameSettings(context);
  registerNewBoard(context, generation);
  registerProgramCommands(context, generation);
  registerCreatorTests(context, generation);
  registerNewProject(context);
}

export function deactivate(): void {}
