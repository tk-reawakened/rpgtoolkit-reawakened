import type { PreparedGameSetup } from "@tk-reawakened/editor-model";
import type { PackageDestinationKind, PackageSaveOutcome } from "./package-save.ts";

/**
 * What a host must provide to save a setup ZIP (`docs/spec/formats/packaging-and-paths.md#reawakened-setup-delivery`,
 * ADR 0045 5C). `replace` stages beside the destination and returns a warning if a replaced file's backup could not
 * be removed. Its rename operations must never overwrite an existing path.
 */
export interface SetupSavePort<Destination> {
  chooseDestination(suggestedFileName: string): Promise<Destination | undefined>;
  fileName(destination: Destination): string;
  describe(destination: Destination): string;
  validateDestination(destination: Destination): Promise<string | undefined>;
  inspect(destination: Destination): Promise<PackageDestinationKind>;
  confirmReplace(existing: Destination): Promise<boolean>;
  replace(destination: Destination, bytes: Uint8Array, replaceExisting: boolean): Promise<string | null>;
}

/** What a host needs to publish one finished file beside its destination. */
export interface SetupWritePort<Destination> {
  write(staging: Destination, bytes: Uint8Array): Promise<void>;
  /** Move only if destination does not exist; reject rather than replacing it. */
  rename(staging: Destination, destination: Destination): Promise<void>;
  remove(staging: Destination): Promise<void>;
  stagingName(destination: Destination): string;
  sibling(destination: Destination, name: string): Destination;
  describe(destination: Destination): string;
}

/**
 * Stage the complete archive before publishing. For confirmed replacement, first move the old file to a unique
 * operation-owned backup; publish without overwrite, then remove that backup. If publication fails, restore the
 * backup without overwrite. A refused restoration leaves the backup intact and its exact path is reported.
 */
export async function replaceSetupFile<Destination>(
  port: SetupWritePort<Destination>,
  destination: Destination,
  bytes: Uint8Array,
  replaceExisting: boolean,
): Promise<string | null> {
  const stagingName = port.stagingName(destination);
  const staging = port.sibling(destination, stagingName);
  const cleanStaging = async (): Promise<void> => {
    try { await port.remove(staging); } catch { /* The owned partial staging file may not exist. */ }
  };
  try {
    await port.write(staging, bytes);
  } catch (error) {
    await cleanStaging();
    throw error;
  }

  if (!replaceExisting) {
    try {
      await port.rename(staging, destination);
      return null;
    } catch (error) {
      await cleanStaging();
      throw error;
    }
  }

  const backup = port.sibling(destination, `${stagingName}.previous`);
  try {
    await port.rename(destination, backup);
  } catch (error) {
    await cleanStaging();
    throw new Error(
      `Could not move the existing setup to backup path ${port.describe(backup)}: ${reason(error)}. The move may have completed before the host reported failure; check both the destination and this recovery path.`,
      { cause: error },
    );
  }

  try {
    await port.rename(staging, destination);
  } catch (publishError) {
    try {
      await port.rename(backup, destination);
    } catch (restoreError) {
      await cleanStaging();
      throw new Error(
        `Could not publish the new setup file: ${reason(publishError)}. Could not restore the previous file: ${reason(restoreError)}. The previous setup may remain at recovery path ${port.describe(backup)}; check that path and the destination.`,
        { cause: publishError },
      );
    }
    await cleanStaging();
    throw publishError;
  }

  try {
    await port.remove(backup);
    return null;
  } catch (error) {
    return `Could not confirm cleanup of the previous setup backup at ${port.describe(backup)}: ${reason(error)}. Check whether the backup remains at that path.`;
  }
}

function failed(message: string): PackageSaveOutcome { return { ok: false, cancelled: false, message }; }
function cancelled(message: string): PackageSaveOutcome { return { ok: false, cancelled: true, message }; }
function reason(error: unknown): string { return error instanceof Error && error.message.length > 0 ? error.message : "the host reported no reason"; }

/**
 * Save the reviewed setup ZIP through host Save As. Cancelling writes nothing; replacing an existing setup ZIP confirms
 * first and only swaps in the new archive after it was written in full.
 */
export async function saveSetupWithSaveAs<Destination>(port: SetupSavePort<Destination>, setup: PreparedGameSetup): Promise<PackageSaveOutcome> {
  try {
    const chosen = await port.chooseDestination(setup.artifact.fileName);
    if (chosen === undefined) return cancelled("Setup export was cancelled; nothing was written.");
    let destinationProblem: string | undefined;
    try { destinationProblem = await port.validateDestination(chosen); }
    catch (error) { return failed(`Could not validate ${port.describe(chosen)}: ${reason(error)}. Nothing was written.`); }
    if (destinationProblem !== undefined) return failed(`${destinationProblem} Nothing was written.`);
    let kind: PackageDestinationKind;
    try { kind = await port.inspect(chosen); }
    catch (error) { return failed(`Could not check ${port.describe(chosen)}: ${reason(error)}. Nothing was written.`); }
    if (kind === "link") return failed(`Refusing to save the setup through symbolic link ${port.describe(chosen)}. Nothing was written.`);
    if (kind !== "missing" && kind !== "file") return failed(`Cannot save the setup to ${port.describe(chosen)} because it is not a regular file. Nothing was written.`);
    if (kind === "file" && !(await port.confirmReplace(chosen))) {
      return cancelled("Setup export was cancelled; the existing setup file was left unchanged.");
    }
    let warning: string | null;
    try { warning = await port.replace(chosen, setup.artifact.bytes, kind === "file"); }
    catch (error) { return failed(`Could not save ${port.describe(chosen)}: ${reason(error)}.`); }
    return {
      ok: true,
      message: `Setup saved to ${port.describe(chosen)}. It contains ${setup.package.fileName}, ${setup.descriptor.fileName} and ${setup.instructions.fileName}. Nothing was signed and no installer runs.${warning === null ? "" : ` ${warning}`}`,
    };
  } catch (error) {
    return failed(`Setup export failed: ${reason(error)}. Nothing was written.`);
  }
}

