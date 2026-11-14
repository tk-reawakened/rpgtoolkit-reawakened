import { foldPath, utf8Decode, utf8Encode } from "@tk-reawakened/core";
import type { PlatformServices } from "@tk-reawakened/platform-services";
import type { PreparedGamePackage } from "./package-export.ts";

export type PublishPackageOutcome =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly message: string };

function existsError(message: string): PublishPackageOutcome {
  return { ok: false, message };
}

const publicationTails = new Map<string, Promise<void>>();

async function serializePublication<T>(path: string, action: () => Promise<T>): Promise<T> {
  const previous = publicationTails.get(path) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  publicationTails.set(path, queued);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (publicationTails.get(path) === queued) publicationTails.delete(path);
  }
}

async function cleanup(fs: PlatformServices["fs"], paths: readonly string[]): Promise<string[]> {
  const remaining: string[] = [];
  for (const path of paths) {
    try {
      const result = await fs.delete(path);
      if (!result.ok && result.error.code !== "not-found") remaining.push(`${path}: ${result.error.message}`);
    } catch (error) {
      remaining.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return remaining;
}

function cleanupMessage(remaining: readonly string[]): string {
  return remaining.length === 0 ? "" : ` Cleanup failed; partial output remains at ${remaining.join("; ")}.`;
}

async function checkAbsent(
  fs: PlatformServices["fs"],
  paths: readonly string[],
): Promise<PublishPackageOutcome | null> {
  for (const path of paths) {
    const stat = await fs.stat(path);
    if (stat.ok) return existsError(`${path} already exists; choose a different output name so existing files are not changed.`);
    if (stat.error.code !== "not-found") return existsError(`Could not check ${path}: ${stat.error.message}`);
  }
  return null;
}

function publishWithoutRename(selected: string): PublishPackageOutcome {
  return existsError(
    `Cannot safely publish ${selected}: this host cannot atomically rename or reserve both output files. Download the package and install descriptor instead; the project was not changed.`,
  );
}

/**
 * Save the package and its sibling install descriptor through the project filesystem (ADR 0022 D5). Hosts with rename
 * stage both files under unique names before publishing; without rename and a host-level exclusive reservation, publication
 * is refused rather than risk replacing files created after the preflight check.
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
  return serializePublication(foldPath(selected), async () => {
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
    const suffix = (globalThis as typeof globalThis & { readonly crypto: { randomUUID(): string } }).crypto.randomUUID();
    const packageTempPath = `${selected}.${suffix}.tkr-package-tmp`;
    const descriptorTempPath = `${descriptorPath}.${suffix}.tkr-package-tmp`;
    const absent = await checkAbsent(services.fs, [selected, descriptorPath, packageTempPath, descriptorTempPath]);
    if (absent !== null) return absent;

    const renameProbe = await services.fs.rename(packageTempPath, descriptorTempPath);
    if (!renameProbe.ok && renameProbe.error.code === "unavailable") {
      return publishWithoutRename(selected);
    }
    if (renameProbe.ok || renameProbe.error.code !== "not-found") {
      return existsError(`Could not determine whether package output can be renamed: ${renameProbe.ok ? "the host unexpectedly moved a nonexistent probe file" : renameProbe.error.message}`);
    }

    const packageTemp = await services.fs.write(packageTempPath, prepared.package.bytes);
    if (!packageTemp.ok) {
      const remaining = await cleanup(services.fs, [packageTempPath, descriptorTempPath]);
      return existsError(`Could not write the temporary package: ${packageTemp.error.message}.${cleanupMessage(remaining)}`);
    }
    const descriptorTemp = await services.fs.write(descriptorTempPath, descriptorBytes);
    if (!descriptorTemp.ok) {
      const remaining = await cleanup(services.fs, [packageTempPath, descriptorTempPath]);
      return existsError(`Could not write the temporary install descriptor: ${descriptorTemp.error.message}.${cleanupMessage(remaining)}`);
    }

    const packageRename = await services.fs.rename(packageTempPath, selected);
    if (!packageRename.ok) {
      const remaining = await cleanup(services.fs, [packageTempPath, descriptorTempPath]);
      if (packageRename.error.code === "unavailable" && remaining.length === 0) {
        return publishWithoutRename(selected);
      }
      return existsError(`Could not publish the package: ${packageRename.error.message}.${cleanupMessage(remaining)}`);
    }

    const descriptorRename = await services.fs.rename(descriptorTempPath, descriptorPath);
    if (!descriptorRename.ok) {
      const rollback = await cleanup(services.fs, [selected, descriptorTempPath]);
      return existsError(`Could not publish the install descriptor: ${descriptorRename.error.message}.${cleanupMessage(rollback)}`);
    }
    return { ok: true, path: selected };
  });
}
