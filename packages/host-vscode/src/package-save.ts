import { packageDescriptorFor, type PreparedGamePackage } from "@tk-reawakened/editor-model";

export type PackageDestinationKind = "missing" | "file" | "directory" | "link" | "other";

export interface PackageSavePort<Destination> {
  chooseDestination(suggestedFileName: string): Promise<Destination | undefined>;
  fileName(destination: Destination): string;
  sibling(destination: Destination, fileName: string): Destination;
  describe(destination: Destination): string;
  validateDestination(destination: Destination): Promise<string | undefined>;
  confirmReplace(existing: readonly Destination[]): Promise<boolean>;
  write(destination: Destination, bytes: Uint8Array): Promise<void>;
}

export type PackageSaveOutcome =
  | { readonly ok: true; readonly message: string }
  | { readonly ok: false; readonly cancelled: boolean; readonly message: string };

function failed(message: string): PackageSaveOutcome { return { ok: false, cancelled: false, message }; }
function reason(error: unknown): string { return error instanceof Error && error.message.length > 0 ? error.message : "the host reported no reason"; }

/** Save the reviewed package and descriptor as a sibling pair using host Save As and overwrite confirmation. */
export async function savePackageWithSaveAs<Destination>(port: PackageSavePort<Destination>, prepared: PreparedGamePackage): Promise<PackageSaveOutcome> {
  const chosen = await port.chooseDestination(prepared.package.fileName);
  if (chosen === undefined) return { ok: false, cancelled: true, message: "Package export was cancelled; nothing was written." };
  let destinationProblem: string | undefined;
  try { destinationProblem = await port.validateDestination(chosen); }
  catch (error) { return failed(`Could not validate ${port.describe(chosen)}: ${reason(error)}. Nothing was written.`); }
  if (destinationProblem !== undefined) return failed(`${destinationProblem} Nothing was written.`);
  const packageName = port.fileName(chosen);
  const descriptor = packageDescriptorFor(prepared, packageName);
  if (!descriptor.ok) return failed(`${descriptor.message} Nothing was written.`);
  const descriptorDestination = port.sibling(chosen, `${packageName}.json`);
  const existing: Destination[] = [];
  for (const destination of [chosen, descriptorDestination]) {
    let kind: PackageDestinationKind;
    try { kind = await port.inspect(destination); }
    catch (error) { return failed(`Could not check ${port.describe(destination)}: ${reason(error)}. Nothing was written.`); }
    if (kind === "link") return failed(`Refusing to save through symbolic link ${port.describe(destination)}. Nothing was written.`);
    if (kind !== "missing" && kind !== "file") return failed(`Cannot save package output to ${port.describe(destination)} because it is not a regular file. Nothing was written.`);
    if (kind === "file") existing.push(destination);
  }
  if (existing.length > 0 && !(await port.confirmReplace(existing))) {
    return { ok: false, cancelled: true, message: "Package export was cancelled; existing files were left unchanged." };
  }
  try { await port.write(chosen, prepared.package.bytes); }
  catch (error) { return failed(`Could not save ${port.describe(chosen)}: ${reason(error)}. The package may be incomplete; the install descriptor was not written.`); }
  try { await port.write(descriptorDestination, descriptor.bytes); }
  catch (error) { return failed(`The package was saved to ${port.describe(chosen)}, but the install descriptor could not be saved to ${port.describe(descriptorDestination)}: ${reason(error)}. The export is incomplete.`); }
  return { ok: true, message: `Package saved to ${port.describe(chosen)} and install descriptor saved to ${port.describe(descriptorDestination)}.` };
}
