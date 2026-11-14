import { ASSET_FOLDERS, asciiLower, foldPath, stripTypeFolder, toSlashes, type AssetKind } from "@tk-reawakened/core";
import type { DialogService, FileSystemService, OutsideFile, PlatformError } from "@tk-reawakened/platform-services";

/**
 * Reserved folders and relative links (T-05, `docs/spec/formats/README.md#paths-inside-files`). Each asset type has a
 * folder under the project folder; a file names another by its path **inside that folder**, with sub-folders kept
 * (`village\inn.brd` for `Boards/village/inn.brd`), and the legacy separator `\` so a legacy tool reads the link back.
 * A file chosen from outside the project is copied into the right folder first, and never over another file.
 */

/** Where a project's asset folders are: `""` when the type folders sit at the project root, else the project folder's path. */
export interface ProjectLayout {
  readonly projectFolder: string;
}

/** The project-relative path of the folder `kind` lives in, with `/` separators. */
export function reservedFolder(layout: ProjectLayout, kind: AssetKind): string {
  const base = toSlashes(layout.projectFolder).replace(/^\/+|\/+$/g, "");
  return base === "" ? ASSET_FOLDERS[kind] : `${base}/${ASSET_FOLDERS[kind]}`;
}

export type LinkOutcome =
  | { readonly inside: true; readonly reference: string }
  | { readonly inside: false };

/**
 * The link to store for the project file at `path` when it is used as an asset of `kind`: the path inside the type
 * folder, sub-folders kept, written with `\`. `inside: false` when the file is not under that folder, so the caller
 * copies it in instead of linking out of the folder.
 */
export function linkFor(layout: ProjectLayout, kind: AssetKind, path: string): LinkOutcome {
  const folder = foldPath(reservedFolder(layout, kind));
  const folded = foldPath(path);
  if (!folded.startsWith(`${folder}/`)) return { inside: false };
  const rest = toSlashes(path).slice(folder.length + 1);
  if (rest === "" || rest.endsWith("/")) return { inside: false };
  return { inside: true, reference: rest.split("/").join("\\") };
}

/** The project-relative path a stored reference of `kind` names (the inverse of `linkFor`). A leading type-folder prefix is tolerated. */
export function referencePath(layout: ProjectLayout, kind: AssetKind, reference: string): string {
  return `${reservedFolder(layout, kind)}/${stripTypeFolder(kind, reference)}`;
}

/** One file an asset picker can offer. */
export interface AssetCandidate {
  /** What would be stored: the path inside the type folder, with `\` between sub-folders. */
  readonly reference: string;
  /** The project-relative path of the file. */
  readonly path: string;
  /** The file's own name, for a list. */
  readonly name: string;
}

/** A folder or its files could not be read. */
export interface ListFailure {
  readonly path: string;
  readonly error: PlatformError;
}

/**
 * Every file of `kind`'s folder and its sub-folders whose extension is one of `extensions` (lower-case with the dot;
 * an empty list means every file), sorted by reference. A missing type folder is an empty list, not an error: a new
 * project has none yet. Any other failure is reported with the folder that could not be read.
 */
export async function listCandidates(
  fs: Pick<FileSystemService, "list">,
  layout: ProjectLayout,
  kind: AssetKind,
  extensions: readonly string[],
): Promise<{ readonly candidates: readonly AssetCandidate[]; readonly failures: readonly ListFailure[] }> {
  const candidates: AssetCandidate[] = [];
  const failures: ListFailure[] = [];
  const root = reservedFolder(layout, kind);
  const pending = [root];
  while (pending.length > 0) {
    const folder = pending.pop()!;
    const listed = await fs.list(folder);
    if (!listed.ok) {
      if (listed.error.code !== "not-found") failures.push({ path: folder, error: listed.error });
      continue;
    }
    for (const entry of listed.value) {
      const path = `${folder}/${entry.name}`;
      if (entry.kind === "directory") {
        pending.push(path);
        continue;
      }
      const dot = entry.name.lastIndexOf(".");
      const extension = dot <= 0 ? "" : asciiLower(entry.name.slice(dot));
      if (extensions.length > 0 && !extensions.includes(extension)) continue;
      const link = linkFor(layout, kind, path);
      if (link.inside) candidates.push({ reference: link.reference, path, name: entry.name });
    }
  }
  candidates.sort((a, b) => (a.reference < b.reference ? -1 : a.reference > b.reference ? 1 : 0));
  return { candidates, failures };
}

/** Why a file name cannot be copied into a folder as it is. `null` when it can. */
export function unusableName(name: string): string | null {
  if (name === "" || name === "." || name === "..") return `"${name}" is not a file name.`;
  if (name.includes("/") || name.includes("\\")) return `"${name}" has a folder separator; a copied file is one name inside the folder.`;
  if (name.includes("\u0000")) return "The file name has a NUL character, which a project path cannot hold.";
  return null;
}

/** `name` with ` (n)` before its extension: `hero.png`, 2 → `hero (2).png`. */
function numbered(name: string, n: number): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? `${name} (${n})` : `${name.slice(0, dot)} (${n})${name.slice(dot)}`;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

export type CopyInResult =
  | {
      readonly ok: true;
      /** The link to store. */
      readonly reference: string;
      /** The project-relative path the file is at now. */
      readonly path: string;
      /** False when the folder already held these exact bytes (or the user chose the file already there): nothing was written. */
      readonly copied: boolean;
    }
  | { readonly ok: false; readonly reason: "cancelled" }
  | { readonly ok: false; readonly reason: "failed"; readonly message: string };

/**
 * Copy `file` into `kind`'s folder (inside `subfolder` when given) and give the link to store (T-05).
 *
 * It never replaces a file. A folder that already holds the same bytes under the same name is simply linked. One that
 * holds different bytes asks (ADR 0022 D3.6 style: the question names the file and says what each answer does): use the
 * file already there, keep both (the copy gets ` (2)`, ` (3)`… before its extension), or cancel. A dismissed question is
 * a cancel, and nothing is written for a cancel or a failure.
 */
export async function copyIntoReservedFolder(
  services: { readonly fs: FileSystemService; readonly dialogs: Pick<DialogService, "ask"> },
  layout: ProjectLayout,
  kind: AssetKind,
  file: OutsideFile,
  subfolder = "",
): Promise<CopyInResult> {
  const fail = (message: string): CopyInResult => ({ ok: false, reason: "failed", message });
  const unusable = unusableName(file.name);
  if (unusable !== null) return fail(unusable);
  const sub = toSlashes(subfolder).replace(/^\/+|\/+$/g, "");
  if (sub !== "" && sub.split("/").some((part) => unusableName(part) !== null)) return fail(`"${subfolder}" is not a folder inside ${reservedFolder(layout, kind)}.`);
  const folder = sub === "" ? reservedFolder(layout, kind) : `${reservedFolder(layout, kind)}/${sub}`;

  const listed = await services.fs.list(folder);
  if (!listed.ok && listed.error.code !== "not-found") return fail(`Could not read ${folder}: ${listed.error.message}`);
  const names = new Map<string, string>();
  if (listed.ok) for (const entry of listed.value) names.set(foldPath(entry.name), entry.name);

  let name = file.name;
  const clash = names.get(foldPath(name));
  if (clash !== undefined) {
    const existingPath = `${folder}/${clash}`;
    const read = await services.fs.read(existingPath);
    if (!read.ok) return fail(`Could not read ${existingPath}: ${read.error.message}`);
    if (sameBytes(read.value, file.bytes)) {
      const link = linkFor(layout, kind, existingPath);
      return link.inside ? { ok: true, reference: link.reference, path: existingPath, copied: false } : fail(`${existingPath} is outside ${reservedFolder(layout, kind)}.`);
    }
    const answer = await services.dialogs.ask({
      message: `${existingPath} already exists and is a different file.`,
      detail: "Use the file already there, keep both (the new one gets a number in its name), or cancel and change nothing.",
      choices: [
        { id: "use-existing", label: "Use the existing file" },
        { id: "keep-both", label: "Keep both" },
        { id: "cancel", label: "Cancel" },
      ],
      cancel: "cancel",
    });
    if (answer === "cancel") return { ok: false, reason: "cancelled" };
    if (answer === "use-existing") {
      const link = linkFor(layout, kind, existingPath);
      return link.inside ? { ok: true, reference: link.reference, path: existingPath, copied: false } : fail(`${existingPath} is outside ${reservedFolder(layout, kind)}.`);
    }
    let counter = 2;
    while (names.has(foldPath(numbered(file.name, counter)))) counter += 1;
    name = numbered(file.name, counter);
  }

  const path = `${folder}/${name}`;
  const written = await services.fs.write(path, file.bytes);
  if (!written.ok) return fail(`Could not copy ${file.name} to ${path}: ${written.error.message}`);
  const link = linkFor(layout, kind, path);
  return link.inside ? { ok: true, reference: link.reference, path, copied: true } : fail(`${path} is outside ${reservedFolder(layout, kind)}.`);
}
