import type { ExtensionContext } from "vscode";
import { registerGameSettings } from "./extension.ts";

export function activate(context: ExtensionContext): void {
  registerGameSettings(context);
}

export function deactivate(): void {}
