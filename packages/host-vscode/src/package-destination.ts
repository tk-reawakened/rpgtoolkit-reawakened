export interface PackageLocationUri {
  readonly scheme: string;
  readonly authority: string;
  readonly path: string;
}

const RESERVED_EXPORTS = ".tkr-exports/";
const REFUSAL = "Choose .tkr-exports under this project or save outside the project folder.";

/** Allow exports outside the project, or directly within its reserved export directory. */
export function validatePackageDestination(projectRoot: PackageLocationUri, destination: PackageLocationUri): string | undefined {
  if (projectRoot.scheme !== destination.scheme || projectRoot.authority !== destination.authority) return undefined;
  const root = projectRoot.path.replace(/\/$/, "");
  if (destination.path === root || !destination.path.startsWith(`${root}/`)) return undefined;
  const relativePath = destination.path.slice(root.length + 1);
  if (!relativePath.startsWith(RESERVED_EXPORTS) || relativePath.slice(RESERVED_EXPORTS.length).includes("/")) return REFUSAL;
  const fileName = relativePath.slice(RESERVED_EXPORTS.length);
  return fileName.length > 0 && fileName !== "." && fileName !== ".." ? undefined : REFUSAL;
}
