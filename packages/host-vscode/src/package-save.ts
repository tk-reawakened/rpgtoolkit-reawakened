import { packageDescriptorFor, type PreparedGamePackage } from "@tk-reawakened/editor-model";

export interface PackageSavePort<Destination> {
  chooseDestination(suggestedFileName: string): Promise<Destination | undefined>;
  fileName(destination: Destination): string;
  sibling(destination: Destination, fileName: string): Destination;
  describe(destination: Destination): string;
  exists(destination: Destination): Promise<boolean>;
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
  const packageName = port.fileName(chosen);
  const descriptor = packageDescriptorFor(prepared, packageName);
  if (!descriptor.ok) return failed(`${descriptor.message} Nothing was written.`);
  const descriptorDestination = port.sibling(chosen, `${packageName}.json`);
  const existing: Destination[] = [];
  for (const destination of [chosen, descriptorDestination]) {
    try { if (await port.exists(destination)) existing.push(destination); }
    catch (error) { return failed(`Could not check ${port.describe(destination)}: ${reason(error)}. Nothing was written.`); }
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
