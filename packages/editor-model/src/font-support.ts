import { ASSET_FOLDERS, foldPath } from "@tk-reawakened/core";
import type { FileSystemService } from "@tk-reawakened/platform-services";
import { newFontBytes } from "./font-document.ts";
import { reservedFolder, unusableName, type ProjectLayout } from "./reserved-folders.ts";
import { resolveDocumentPath } from "./workspace.ts";

/**
 * What both hosts need to make a bitmap font (T-65 "New font"): the file name and the first free path in the project's
 * `Font` folder, and the write that makes the file. Pure, DOM-free and independent of the editor, so a host with a
 * dialog and one with a single input box ask the same question.
 */

export type NewFontStorage = Pick<FileSystemService, "list" | "write">;

export type CreateFontResult =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: "invalid" | "exists" | "failed"; readonly message: string };

/** The file name for `name`: a `.fnt` extension is added when it is missing. */
export function fontFileName(name: string): string {
  const trimmed = name.trim();
  return /\.fnt$/i.test(trimmed) ? trimmed : `${trimmed}.fnt`;
}

/**
 * The first of `new-font.fnt`, `new-font 2.fnt`, … that is not in the project's `Font` folder, to suggest to someone
 * making a font; names are compared without regard to A-Z case.
 */
export async function suggestFontPath(fs: Pick<FileSystemService, "list">, layout: ProjectLayout): Promise<string> {
  const folder = reservedFolder(layout, "fonts");
  const listed = await fs.list(folder);
  const taken = new Set(listed.ok ? listed.value.map((entry) => foldPath(entry.name)) : []);
  for (let counter = 1; ; counter += 1) {
    const name = counter === 1 ? "new-font.fnt" : `new-font ${counter}.fnt`;
    if (!taken.has(foldPath(name))) return `${folder}/${name}`;
  }
}

/** Why `path` cannot hold a new font in the selected game's reserved `Font` folder, or `null`. */
export function fontDestinationProblem(path: string, layout: ProjectLayout): string | null {
  const parts = path.split("/");
  const fileName = parts.at(-1) ?? "";
  const folder = parts.at(-2) ?? "";
  if (parts.length < 2 || foldPath(folder) !== foldPath(ASSET_FOLDERS.fonts)) return `A font goes in a ${ASSET_FOLDERS.fonts} folder, such as ${ASSET_FOLDERS.fonts}/${fileName || "new-font.fnt"}.`;
  const target = reservedFolder(layout, "fonts");
  if (foldPath(path.slice(0, path.lastIndexOf("/"))) !== foldPath(target)) return `A font for this game goes in ${target}.`;
  const unusable = unusableName(fileName);
  if (unusable !== null) return unusable;
  return /\.fnt$/i.test(fileName) && fileName.length > 4 ? null : "A font's name ends in .fnt.";
}

/**
 * Create the font at `path` with all 256 glyphs empty, never over a file. Existing path components keep their stored
 * spelling. The host write is not an atomic exclusive create, so a file another program makes between the check and the
 * write can be replaced.
 */
export async function createFontFile(fs: NewFontStorage, path: string, layout: ProjectLayout): Promise<CreateFontResult> {
  const invalid = fontDestinationProblem(path, layout);
  if (invalid !== null) return { ok: false, reason: "invalid", message: invalid };
  const resolved = await resolveDocumentPath(fs, path);
  const exists = (): CreateFontResult => ({ ok: false, reason: "exists", message: `${path} already exists (names are compared without regard to A-Z case). Nothing was created; choose another name.` });
  if (!resolved.ok) {
    if (resolved.kind === "case-conflict") return exists();
    return { ok: false, reason: "failed", message: `Could not read the Font folder: ${resolved.error.message}` };
  }
  if (resolved.exists) return exists();
  const written = await fs.write(resolved.path, newFontBytes());
  if (!written.ok) return { ok: false, reason: "failed", message: `Could not create ${resolved.path}: ${written.error.message}` };
  return { ok: true, path: resolved.path };
}
