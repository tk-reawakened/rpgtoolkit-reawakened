import type { ReadOnlyReason, Rejection } from "./binary-document.ts";

/**
 * Shared field rules of the special move and status effect documents (`docs/spec/formats/battle-data.md#battle-data-editor-rules`).
 * A stored string ends at its first NUL, so a value holding one is refused whole; the writer refuses text the Windows-1252
 * code page cannot store, which `refuse` reports through its read-back.
 */

const INT_LIMITS = { i16: [-32_768, 32_767], i32: [-2_147_483_648, 2_147_483_647] } as const;

/** Whether `value` is a whole number the stored field of `width` can hold. */
export function fitsInt(value: unknown, width: keyof typeof INT_LIMITS): value is number {
  const [low, high] = INT_LIMITS[width];
  return typeof value === "number" && Number.isInteger(value) && value >= low && value <= high;
}

/** Whether `value` is text a stored string can hold (no NUL). */
export function storableText(value: unknown): value is string {
  return typeof value === "string" && !value.includes("\u0000");
}

export function invalid(message: string): Rejection {
  return { reason: "invalid", message };
}

/** Why a Toolkit 2 text file (`minor` 0) can only be viewed: the writer implements binary `minor` 2-3 and the editor never converts on open. */
export function textFormReason(what: string): ReadOnlyReason {
  return {
    code: "no-same-version-writer",
    message: `This Toolkit 2 text ${what} has no same-version writer and is read-only. It will not be converted on open.`,
  };
}

export function intRangeMessage(label: string, width: keyof typeof INT_LIMITS): string {
  const [low, high] = INT_LIMITS[width];
  return `${label} must be a whole number from ${low} to ${high}.`;
}
