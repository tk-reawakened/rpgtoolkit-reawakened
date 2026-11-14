import { packageDescriptorFor, type PreparedGamePackage } from "@tk-reawakened/editor-model";

/**
 * What the Save As flow needs from VS Code. `Destination` is the host's file address; this module never inspects it, so
 * it runs in Node tests without VS Code.
 */
export interface PackageSavePort<Destination> {
  /** Ask the author where to save the package; `undefined` when they cancel. The host's dialog owns the choice. */
  chooseDestination(suggestedFileName: string): Promise<Destination | undefined>;
  /** The last path segment of a destination. */
  fileName(destination: Destination): string;
  /** A file beside `destination`, named `fileName`. */
  sibling(destination: Destination, fileName: string): Destination;
  /** A short name for a destination, for messages. */
  describe(destination: Destination): string;
  /** Whether something is already there; throws when that cannot be told. */
  exists(destination: Destination): Promise<boolean>;
  /** Ask the author whether to replace files that already exist. */
  confirmReplace(existing: readonly Destination[]): Promise<boolean>;
  write(destination: Destination, bytes: Uint8Array): Promise<void>;
}

export type PackageSaveOutcome =
  | { readonly ok: true; readonly message: string }
  | { readonly ok: false; readonly cancelled: boolean; readonly message: string };

function failed(message: string): PackageSaveOutcome {
  return { ok: false, cancelled: false, message };
}

function reason(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : "the host reported no reason";
}

/**
 * Save a reviewed package and its install descriptor where the author chooses, through the host's own Save As dialog.
 *
 * VS Code gives this extension no way to publish into a project folder that is guaranteed not to replace a file another
 * window creates meanwhile or to follow a directory link swapped in underneath it, so the extension does not claim to.
 * The author picks the destination; the descriptor goes beside it under the name the package actually has; and a
 * destination that already holds a file is replaced only after the author says so. A failure after the first write
 * is reported with exactly what was saved.
 */
export async function savePackageWithSaveAs<Destination>(
  port: PackageSavePort<Destination>,
  prepared: PreparedGamePackage,
): Promise<PackageSaveOutcome> {
  const chosen = await port.chooseDestination(prepared.package.fileName);
  if (chosen === undefined) return { ok: false, cancelled: true, message: "Package export was cancelled; nothing was written." };
  const packageName = port.fileName(chosen);
  const descriptor = packageDescriptorFor(prepared, packageName);
  if (!descriptor.ok) return failed(`${descriptor.message} Nothing was written.`);
  const descriptorDestination = port.sibling(chosen, `${packageName}.json`);

  const existing: Destination[] = [];
  for (const destination of [chosen, descriptorDestination]) {
    try {
      if (await port.exists(destination)) existing.push(destination);
    } catch (error) {
      return failed(`Could not check ${port.describe(destination)}: ${reason(error)}. Nothing was written.`);
    }
  }
  if (existing.length > 0 && !(await port.confirmReplace(existing))) {
    return { ok: false, cancelled: true, message: "Package export was cancelled; existing files were left unchanged." };
  }

  try {
    await port.write(chosen, prepared.package.bytes);
  } catch (error) {
    return failed(`Could not save ${port.describe(chosen)}: ${reason(error)}. The package may be incomplete; the install descriptor was not written.`);
  }
  try {
    await port.write(descriptorDestination, descriptor.bytes);
  } catch (error) {
    return failed(
      `The package was saved to ${port.describe(chosen)}, but the install descriptor could not be saved to ${port.describe(descriptorDestination)}: ${reason(error)}. The export is incomplete.`,
    );
  }
  return { ok: true, message: `Package saved to ${port.describe(chosen)} and install descriptor saved to ${port.describe(descriptorDestination)}.` };
}
