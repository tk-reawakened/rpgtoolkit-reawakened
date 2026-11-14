import { DEFAULT_MOVEMENT_SCAN_CODES, type MainFile } from "../formats/main-file/model.ts";
import type { Diagnostic } from "../ports/engine.ts";

// Main-file rows 45, 60 and 61 (docs/spec/formats/main-file.md#layout).
const MOVEMENT_DIRECTIONS = ["right", "southeast", "down", "southwest", "left", "northwest", "up", "northeast"] as const;

// DirectInput offsets paired with the host-independent physical key codes in the input port
// (docs/spec/formats/main-file.md#layout row 61). Exported so the editor captures a movement key as the same offset
// the player resolves.
export const DIRECT_INPUT_PHYSICAL_KEYS: Readonly<Record<number, string>> = {
  0x01: "Escape",
  0x02: "Digit1", 0x03: "Digit2", 0x04: "Digit3", 0x05: "Digit4", 0x06: "Digit5",
  0x07: "Digit6", 0x08: "Digit7", 0x09: "Digit8", 0x0a: "Digit9", 0x0b: "Digit0",
  0x0c: "Minus", 0x0d: "Equal", 0x0e: "Backspace", 0x0f: "Tab",
  0x10: "KeyQ", 0x11: "KeyW", 0x12: "KeyE", 0x13: "KeyR", 0x14: "KeyT",
  0x15: "KeyY", 0x16: "KeyU", 0x17: "KeyI", 0x18: "KeyO", 0x19: "KeyP",
  0x1a: "BracketLeft", 0x1b: "BracketRight", 0x1c: "Enter", 0x1d: "ControlLeft",
  0x1e: "KeyA", 0x1f: "KeyS", 0x20: "KeyD", 0x21: "KeyF", 0x22: "KeyG",
  0x23: "KeyH", 0x24: "KeyJ", 0x25: "KeyK", 0x26: "KeyL",
  0x27: "Semicolon", 0x28: "Quote", 0x29: "Backquote", 0x2a: "ShiftLeft", 0x2b: "Backslash",
  0x2c: "KeyZ", 0x2d: "KeyX", 0x2e: "KeyC", 0x2f: "KeyV", 0x30: "KeyB", 0x31: "KeyN", 0x32: "KeyM",
  0x33: "Comma", 0x34: "Period", 0x35: "Slash", 0x36: "ShiftRight", 0x37: "NumpadMultiply",
  0x38: "AltLeft", 0x39: "Space", 0x3a: "CapsLock",
  0x3b: "F1", 0x3c: "F2", 0x3d: "F3", 0x3e: "F4", 0x3f: "F5",
  0x40: "F6", 0x41: "F7", 0x42: "F8", 0x43: "F9", 0x44: "F10",
  0x45: "NumLock", 0x46: "ScrollLock",
  0x47: "Numpad7", 0x48: "Numpad8", 0x49: "Numpad9", 0x4a: "NumpadSubtract",
  0x4b: "Numpad4", 0x4c: "Numpad5", 0x4d: "Numpad6", 0x4e: "NumpadAdd",
  0x4f: "Numpad1", 0x50: "Numpad2", 0x51: "Numpad3", 0x52: "Numpad0", 0x53: "NumpadDecimal",
  0x56: "IntlBackslash", 0x57: "F11", 0x58: "F12",
  0x64: "F13", 0x65: "F14", 0x66: "F15",
  0x70: "KanaMode", 0x79: "Convert", 0x7b: "NonConvert", 0x7d: "IntlYen", 0x8d: "NumpadEqual",
  0x9c: "NumpadEnter", 0x9d: "ControlRight",
  0xb3: "NumpadComma", 0xb5: "NumpadDivide", 0xb7: "PrintScreen", 0xb8: "AltRight",
  0xc5: "Pause", 0xc7: "Home", 0xc8: "ArrowUp", 0xc9: "PageUp",
  0xcb: "ArrowLeft", 0xcd: "ArrowRight", 0xcf: "End", 0xd0: "ArrowDown", 0xd1: "PageDown",
  0xd2: "Insert", 0xd3: "Delete", 0xdb: "MetaLeft", 0xdc: "MetaRight", 0xdd: "ContextMenu",
};

type Direction = typeof MOVEMENT_DIRECTIONS[number];
export type MainFileMovementSettings = {
  readonly keyboardEnabled: boolean;
  readonly pointerEnabled: boolean;
  readonly diagonalsEnabled: boolean;
  readonly controllerEnabled: boolean;
  readonly keys: ReadonlyMap<string, readonly Direction[]>;
};

export function mainFileMovementSettings(main: MainFile, file: string, binary = true): {
  readonly settings: MainFileMovementSettings;
  readonly diagnostics: readonly Diagnostic[];
} {
  const hasMovementRows = binary && main.minor >= 9;
  const controls = hasMovementRows ? main.movementControls : 5;
  const scanCodes = hasMovementRows ? main.movementScanCodes : DEFAULT_MOVEMENT_SCAN_CODES;
  const diagnostics: Diagnostic[] = [];
  const keys = new Map<string, Direction[]>();
  for (const [slot, direction] of MOVEMENT_DIRECTIONS.entries()) {
    const scanCode = scanCodes[slot] ?? 0;
    if (scanCode === 0) continue;
    const code = DIRECT_INPUT_PHYSICAL_KEYS[scanCode];
    if (code === undefined) {
      diagnostics.push({
        code: "input.unsupported-scan-code", file, line: 0,
        message: `movement direction ${direction} uses unsupported DirectInput scan code 0x${scanCode.toString(16)}`,
      });
      continue;
    }
    const directions = keys.get(code) ?? [];
    directions.push(direction);
    keys.set(code, directions);
  }
  return {
    settings: {
      keyboardEnabled: (controls & 1) !== 0,
      pointerEnabled: (controls & 2) !== 0,
      diagonalsEnabled: (controls & 4) !== 0,
      controllerEnabled: !binary || main.minor < 3 || main.useJoystick !== 0,
      keys,
    },
    diagnostics,
  };
}
