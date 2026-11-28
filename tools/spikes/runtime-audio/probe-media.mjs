import { resolveAsset } from "@tk-reawakened/core";

/** Resolve a game media reference in the loaded package's own canonical index, just as core play does. */
export function findProbeMedia(loaded, reference) {
  const resolved = resolveAsset(loaded.index, { kind: "package" }, "media", reference);
  if (!resolved.ok) return null;
  const index = loaded.index.keys.indexOf(resolved.value);
  const file = loaded.files[index];
  if (file === undefined) throw new Error(`Package index returned ${resolved.value} without a corresponding file`);
  return { key: resolved.value, path: file.path, bytes: file.bytes };
}
