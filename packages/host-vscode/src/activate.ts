import type { ExtensionContext } from "vscode";
import { registerGameSettings, registerNewBoard, registerNewProject } from "./extension.ts";

export function activate(context: ExtensionContext): void {
  registerNewBoard(context, registerGameSettings(context));
  registerNewProject(context);
}

export function deactivate(): void {}
