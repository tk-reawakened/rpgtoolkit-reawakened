import type { PreparedGameSetup } from "@tk-reawakened/editor-model";
import type { PackageDestinationKind, PackageSaveOutcome } from "./package-save.ts";

/**
 * What a host must provide to save a setup ZIP (`docs/spec/formats/packaging-and-paths.md#reawakened-setup-delivery`,
 * ADR 0045 5C). `replace` must write the whole archive beside the destination before it takes the destination's place,
 * so a failure or cancellation preserves any earlier setup file.
 */
export interface SetupSavePort<Destination> {
  chooseDestination(suggestedFileName: string): Promise<Destination | undefined>;
  fileName(destination: Destination): string;
  describe(destination: Destination): string;
  validateDestination(destination: Destination): Promise<string | undefined>;
  inspect(destination: Destination): Promise<PackageDestinationKind>;
  confirmReplace(existing: Destination): Promise<boolean>;
  replace(destination: Destination, bytes: Uint8Array): Promise<void>;
}

/** What a host needs to publish one finished file beside its destination. */
export interface SetupWritePort<Destination> {
  write(staging: Destination, bytes: Uint8Array): Promise<void>;
  rename(staging: Destination, destination: Destination): Promise<void>;
  remove(staging: Destination): Promise<void>;
  stagingName(destination: Destination): string;
  sibling(destination: Destination, name: string): Destination;
}

/**
 * Write `bytes` to an operation-owned staging name and only then rename it over `destination`. A failed write removes
 * just that staging file, so the destination keeps whatever it held (`packaging-and-paths.md#reawakened-setup-delivery`:
 * "stage before replacing an existing setup artefact").
 */
export async function replaceSetupFile<Destination>(
  port: SetupWritePort<Destination>,
  destination: Destination,
  bytes: Uint8Array,
): Promise<void> {
  const staging = port.sibling(destination, port.stagingName(destination));
  try {
    await port.write(staging, bytes);
    await port.rename(staging, destination);
  } catch (error) {
    // The staging name belongs to this save, whether the write failed part-way or the rename was refused.
    try { await port.remove(staging); } catch { /* Removing a staging file that never appeared is not a second failure. */ }
    throw error;
  }
}

function failed(message: string): PackageSaveOutcome { return { ok: false, cancelled: false, message }; }
function cancelled(message: string): PackageSaveOutcome { return { ok: false, cancelled: true, message }; }
function reason(error: unknown): string { return error instanceof Error && error.message.length > 0 ? error.message : "the host reported no reason"; }

/**
 * Save the reviewed setup ZIP through host Save As. Cancelling writes nothing; replacing an existing setup ZIP confirms
 * first and only swaps in the new archive after it was written in full, so the previous ZIP survives a failure.
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
    try { await port.replace(chosen, setup.artifact.bytes); }
    catch (error) { return failed(`Could not save ${port.describe(chosen)}: ${reason(error)}. The previous setup file, if any, was left unchanged.`); }
    return {
      ok: true,
      message: `Setup saved to ${port.describe(chosen)}. It contains ${setup.package.fileName}, ${setup.descriptor.fileName} and ${setup.instructions.fileName}. Nothing was signed and no installer runs.`,
    };
  } catch (error) {
    return failed(`Setup export failed: ${reason(error)}. Nothing was written.`);
  }
}
