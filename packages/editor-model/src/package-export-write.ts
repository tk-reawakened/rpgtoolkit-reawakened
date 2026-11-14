import { utf8Decode, utf8Encode } from "@tk-reawakened/core";
import type { PreparedGamePackage } from "./package-export.ts";

export type PackageDescriptorOutcome =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly message: string };

const DESCRIPTOR_FIELDS = ["schema", "file", "sha256", "size", "gameId", "title", "version"] as const;

/**
 * The install descriptor bytes for a package the author saves under `packageFileName`.
 *
 * A host that lets the author choose the package's file name (a Save As dialog) must name that file in the descriptor,
 * because a registering host validates the descriptor against the file it names. Only the seven-field `file` value
 * changes; the digest, size, identity, title and version stay exactly as prepared for the reviewed archive bytes.
 */
export function packageDescriptorFor(prepared: PreparedGamePackage, packageFileName: string): PackageDescriptorOutcome {
  if (
    !packageFileName.toLowerCase().endsWith(".tpk") ||
    packageFileName.includes("/") ||
    packageFileName.includes("\\") ||
    packageFileName === ".tpk"
  ) {
    return { ok: false, message: "Choose a .tpk file name for the package." };
  }
  let descriptorValue: unknown;
  try {
    descriptorValue = JSON.parse(utf8Decode(prepared.descriptor.bytes));
  } catch {
    return { ok: false, message: "The install descriptor is not valid UTF-8 JSON." };
  }
  if (
    typeof descriptorValue !== "object" ||
    descriptorValue === null ||
    Array.isArray(descriptorValue) ||
    Object.keys(descriptorValue).length !== DESCRIPTOR_FIELDS.length ||
    !DESCRIPTOR_FIELDS.every((field) => Object.hasOwn(descriptorValue, field))
  ) {
    return { ok: false, message: "The install descriptor does not match the seven-field contract." };
  }
  const record = { ...(descriptorValue as Record<string, unknown>), file: packageFileName };
  return { ok: true, bytes: utf8Encode(`${JSON.stringify(record, null, 2)}\n`) };
}
