import type { ExtensionContext } from "vscode";
import { registerGameSettings, registerNewProject } from "./extension.ts";
import { registerProgramCommands } from "./program-commands.ts";
import { registerFontCommands } from "./font-commands.ts";
import { registerCreatorTests } from "./creator-tests.ts";
import { registerVisualEvents } from "./visual-events.ts";
import { registerVisualFixtures } from "./visual-fixtures.ts";

export function activate(context: ExtensionContext): void {
  const generation = registerGameSettings(context);
  registerProgramCommands(context, generation);
  registerFontCommands(context, generation);
  registerCreatorTests(context, generation);
  registerVisualEvents(context);
  registerVisualFixtures(context);
  registerNewProject(context);
}

export function deactivate(): void {}
