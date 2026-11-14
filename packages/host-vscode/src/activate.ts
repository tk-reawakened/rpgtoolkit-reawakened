import type { ExtensionContext } from "vscode";
import { registerGameSettings, registerNewBoard } from "./extension.ts";

export function activate(context: ExtensionContext): void {
  registerGameSettings(context);
  registerNewBoard(context);
}

export function deactivate(): void {}
