import type { ExtensionContext } from "vscode";
import { registerGameSettings, registerNewBoard } from "./extension.ts";

export function activate(context: ExtensionContext): void {
  registerNewBoard(context, registerGameSettings(context));
}

export function deactivate(): void {}
