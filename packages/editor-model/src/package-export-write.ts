import { utf8Decode, utf8Encode } from "@tk-reawakened/core";
import type { PreparedGamePackage } from "./package-export.ts";

export type PackageDescriptorOutcome =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly message: string };

const DESCRIPTOR_FIELDS = ["schema", "file", "sha256", "size", "gameId", "title", "version"] as const;

/** Return descriptor bytes naming the package's final user-chosen filename. */
export function packageDescriptorFor(prepared: PreparedGamePackage, packageFileName: string): PackageDescriptorOutcome {
  if (!packageFileName.toLowerCase().endsWith(".tpk") || packageFileName.includes("/") || packageFileName.includes("\\") || packageFileName === ".tpk") {
    return { ok: false, message: "Choose a .tpk file name for the package." };
  }
  let value: unknown;
  try { value = JSON.parse(utf8Decode(prepared.descriptor.bytes)); }
  catch { return { ok: false, message: "The install descriptor is not valid UTF-8 JSON." }; }
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).length !== DESCRIPTOR_FIELDS.length || !DESCRIPTOR_FIELDS.every((field) => Object.hasOwn(value, field))) {
    return { ok: false, message: "The install descriptor does not match the seven-field contract." };
  }
  const record = { ...(value as Record<string, unknown>), file: packageFileName };
  return { ok: true, bytes: utf8Encode(`${JSON.stringify(record, null, 2)}\n`) };
}
