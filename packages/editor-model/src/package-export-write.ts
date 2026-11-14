import { utf8Decode, utf8Encode } from "@tk-reawakened/core";
import type { PlatformServices } from "@tk-reawakened/platform-services";
import type { PreparedGamePackage } from "./package-export.ts";

export type PublishPackageOutcome =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly message: string };

function existsError(message: string): PublishPackageOutcome {
  return { ok: false, message };
}

/**
 * Save the package and its sibling install descriptor through the project filesystem (ADR 0022 D5). Existing output is
 * never overwritten; both temporary writes complete before either final name appears.
 */
export async function publishGamePackage(
  services: Pick<PlatformServices, "fs" | "dialogs">,
  sourceMainPath: string,
  prepared: PreparedGamePackage,
): Promise<PublishPackageOutcome> {
  const selected = await services.dialogs.pickSavePath({ document: sourceMainPath, suggested: prepared.package.fileName });
  if (selected === null) return { ok: false, message: "Package export was cancelled; the project was not changed." };
  if (!selected.toLowerCase().endsWith(".tpk") || selected.startsWith("/") || selected.includes("\\") || selected.split("/").some((part) => part === "" || part === "." || part === "..")) {
    return existsError("Choose a safe project-relative .tpk destination.");
  }
  const packageName = selected.slice(selected.lastIndexOf("/") + 1);
  const descriptorPath = `${selected}.json`;
  const packageTempPath = `${selected}.tkr-package-tmp`;
  const descriptorTempPath = `${descriptorPath}.tkr-package-tmp`;
  for (const path of [selected, descriptorPath, packageTempPath, descriptorTempPath]) {
    const stat = await services.fs.stat(path);
    if (stat.ok) return existsError(`${path} already exists; choose a different output name so existing files are not changed.`);
    if (stat.error.code !== "not-found") return existsError(`Could not check ${path}: ${stat.error.message}`);
  }
  let descriptorValue: unknown;
  try {
    descriptorValue = JSON.parse(utf8Decode(prepared.descriptor.bytes));
  } catch {
    return existsError("The install descriptor is not valid UTF-8 JSON.");
  }
  const descriptorFields = ["schema", "file", "sha256", "size", "gameId", "title", "version"];
  if (
    typeof descriptorValue !== "object" ||
    descriptorValue === null ||
    Object.keys(descriptorValue).length !== descriptorFields.length ||
    !descriptorFields.every((field) => Object.hasOwn(descriptorValue, field))
  ) {
    return existsError("The install descriptor does not match the seven-field contract.");
  }
  const descriptorRecord = descriptorValue as Record<string, unknown>;
  descriptorRecord["file"] = packageName;
  const descriptorBytes = utf8Encode(`${JSON.stringify(descriptorRecord, null, 2)}\n`);


  const packageTemp = await services.fs.write(packageTempPath, prepared.package.bytes);
  if (!packageTemp.ok) return existsError(`Could not write the temporary package: ${packageTemp.error.message}`);
  const descriptorTemp = await services.fs.write(descriptorTempPath, descriptorBytes);
  if (!descriptorTemp.ok) {
    const cleanup = await services.fs.delete(packageTempPath);
    const detail = cleanup.ok ? "" : ` The temporary package remains at ${packageTempPath}: ${cleanup.error.message}`;
    return existsError(`Could not write the temporary install descriptor: ${descriptorTemp.error.message}.${detail}`);
  }

  const packageRename = await services.fs.rename(packageTempPath, selected);
  if (!packageRename.ok) {
    const packageCleanup = await services.fs.delete(packageTempPath);
    const descriptorCleanup = await services.fs.delete(descriptorTempPath);
    const remaining = [
      packageCleanup.ok ? null : `${packageTempPath}: ${packageCleanup.error.message}`,
      descriptorCleanup.ok ? null : `${descriptorTempPath}: ${descriptorCleanup.error.message}`,
    ].filter((path): path is string => path !== null);
    const detail = remaining.length === 0 ? "" : ` Temporary output remains at ${remaining.join(" and ")}.`;
    return existsError(`Could not publish the package: ${packageRename.error.message}.${detail}`);
  }

  const descriptorRename = await services.fs.rename(descriptorTempPath, descriptorPath);
  if (!descriptorRename.ok) {
    const rollback = await services.fs.delete(selected);
    const descriptorCleanup = await services.fs.delete(descriptorTempPath);
    const details = [
      rollback.ok ? "The incomplete package was removed." : `The package remains at ${selected} because rollback failed: ${rollback.error.message}`,
      descriptorCleanup.ok ? null : `The temporary descriptor remains at ${descriptorTempPath}: ${descriptorCleanup.error.message}`,
    ].filter((detail): detail is string => detail !== null);
    return existsError(`Could not publish the install descriptor: ${descriptorRename.error.message}. ${details.join(" ")}`);
  }
  return { ok: true, path: selected };
}
