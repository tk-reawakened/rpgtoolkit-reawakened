import { FIRST_PARTY_PLUGINS, commandDocumentation, encodeCp1252, foldAscii, foldPath, type CommandParamDocumentation, type ResolvedPlugin } from "@tk-reawakened/core";
import type { FileSystemService } from "@tk-reawakened/platform-services";
import type { EditTextCommand } from "./program-document.ts";
import { reservedFolder, unusableName, type ProjectLayout } from "./reserved-folders.ts";

/**
 * What both hosts need to edit a program besides its text (story 11.7, docs/spec/engine/rpgcode-tooling.md#tool-10):
 * the command quick reference and how a chosen command is inserted, and the header template of a new program. Pure and
 * DOM-free, and independent of the language server, so each works when the server is absent.
 */

/** One row of the quick reference: a public command name or alias (T-40 "Quick reference"). */
export interface CommandReferenceEntry {
  readonly name: string;
  readonly canonicalName: string;
  /** The command this name is another spelling of, or `null` for the canonical name. */
  readonly aliasOf: string | null;
  /** The call as it is written: optional parameters in brackets, `&` before a by-reference one, `...` after a variadic one. */
  readonly syntax: string;
  /** What the command does, in one sentence for someone writing a game; `null` when nothing is documented. */
  readonly summary: string | null;
  readonly groups: readonly string[];
  /** The names of the required parameters, which inserting the command writes. */
  readonly required: readonly string[];
}

function parameterSyntax(parameter: CommandParamDocumentation): string {
  const written = `${parameter.byRef ? "&" : ""}${parameter.name}${parameter.variadic ? "..." : ""}`;
  return parameter.optional ? `[${written}]` : written;
}

/** Every public command and alias with its syntax, ordered by ASCII-folded name. */
export function commandReference(plugins: readonly ResolvedPlugin[] = FIRST_PARTY_PLUGINS.map((definition) => ({ definition }))): readonly CommandReferenceEntry[] {
  // A name a later pack layers over an earlier one is listed once, by its first definition.
  const seen = new Set<string>();
  const entries = commandDocumentation(plugins)
    .filter((doc) => doc.access === "public" && !seen.has(foldAscii(doc.name)) && seen.add(foldAscii(doc.name)))
    .map((doc): CommandReferenceEntry => ({
      name: doc.name,
      canonicalName: doc.canonicalName,
      aliasOf: doc.name === doc.canonicalName ? null : doc.canonicalName,
      syntax: `${doc.name}(${doc.params.map(parameterSyntax).join(", ")})`,
      summary: doc.summary,
      groups: doc.groups,
      required: doc.params.filter((parameter) => !parameter.optional && !parameter.variadic).map((parameter) => parameter.name),
    }));
  return entries.sort((left, right) => {
    const a = foldAscii(left.name);
    const b = foldAscii(right.name);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

/** The entries whose name, syntax, summary or group contains every word of `query` (ASCII case-folded). */
export function filterCommandReference(entries: readonly CommandReferenceEntry[], query: string): readonly CommandReferenceEntry[] {
  const words = foldAscii(query).split(/\s+/).filter((word) => word !== "");
  if (words.length === 0) return entries;
  return entries.filter((entry) => {
    const haystack = foldAscii(`${entry.name} ${entry.syntax} ${entry.summary ?? ""} ${entry.groups.join(" ")}`);
    return words.every((word) => haystack.includes(word));
  });
}

/** What inserting a command writes, and which part of it the author overtypes. */
export interface CommandInsertion {
  /** `name(` + the names of the required parameters + `)`. */
  readonly text: string;
  /** The span of `text` to select after inserting: the parameter text, or the empty span between the brackets. */
  readonly select: { readonly from: number; readonly to: number };
}

/** The text a chosen quick-reference entry inserts (TOOL-10). */
export function commandInsertion(entry: CommandReferenceEntry): CommandInsertion {
  const parameters = entry.required.join(", ");
  const open = entry.name.length + 1;
  return { text: `${entry.name}(${parameters})`, select: { from: open, to: open + parameters.length } };
}

/** The header a new program starts with when the preference is unset (`program.headerTemplate`). */
export const DEFAULT_HEADER_TEMPLATE = "// {file}\n\n";

/** The most characters the preference holds. */
export const MAX_HEADER_TEMPLATE_LENGTH = 500;

/** The program's file name (`intro.prg`) of a project-relative `path`. */
function fileNameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * Expand a header template for the program at `path`: `{file}` is the file name, `{name}` the file name without its
 * extension and `{path}` the project-relative path. Any other `{…}` stays as written, so no template can fail, and line
 * breaks are `LF`.
 */
export function expandHeaderTemplate(template: string, path: string): string {
  const file = fileNameOf(path);
  const dot = file.lastIndexOf(".");
  const name = dot <= 0 ? file : file.slice(0, dot);
  const values: Readonly<Record<string, string>> = { file, name, path };
  return template.replace(/\r\n|\r/g, "\n").replace(/\{(file|name|path)\}/g, (_, key: string) => values[key]!);
}

/** The edit command that puts the expanded header at the start of the program; `null` when the template expands to nothing. */
export function insertHeaderCommand(template: string, path: string): EditTextCommand | null {
  const text = expandHeaderTemplate(template, path);
  return text === "" ? null : { type: "edit-text", label: "Insert header", edits: [{ from: 0, to: 0, text }] };
}

/** The edit command that inserts a quick-reference command in place of `from`-`to` (the selection, or the cursor). */
export function insertCommandEdit(entry: CommandReferenceEntry, from: number, to: number): { readonly command: EditTextCommand; readonly select: CommandInsertion["select"] } {
  const insertion = commandInsertion(entry);
  return { command: { type: "edit-text", label: `Insert ${entry.name}`, edits: [{ from, to, text: insertion.text }] }, select: { from: from + insertion.select.from, to: from + insertion.select.to } };
}

export type NewProgramStorage = Pick<FileSystemService, "list" | "write">;

export type CreateProgramResult =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: "invalid" | "exists" | "failed"; readonly message: string };

/** The file name for `name`: a `.prg` extension is added when it is missing. */
export function programFileName(name: string): string {
  const trimmed = name.trim();
  return /\.prg$/i.test(trimmed) ? trimmed : `${trimmed}.prg`;
}

/** The project-relative path of the program `name` in the project's programs folder. */
export function programPathIn(layout: ProjectLayout, name: string): string {
  return `${reservedFolder(layout, "programs")}/${programFileName(name)}`;
}

/**
 * The first of `untitled.prg`, `untitled 2.prg`, … that is not in the programs folder, for suggesting a name to someone
 * making a program; names are compared without regard to A-Z case.
 */
export async function suggestProgramPath(fs: Pick<FileSystemService, "list">, layout: ProjectLayout): Promise<string> {
  const folder = reservedFolder(layout, "programs");
  const listed = await fs.list(folder);
  const taken = new Set(listed.ok ? listed.value.map((entry) => foldPath(entry.name)) : []);
  for (let counter = 1; ; counter += 1) {
    const name = counter === 1 ? "untitled.prg" : `untitled ${counter}.prg`;
    if (!taken.has(foldPath(name))) return `${folder}/${name}`;
  }
}

/**
 * Create the program at `path` (a project-relative path ending in `.prg`), starting with the expanded header template
 * (T-40). Nothing is written when the path is unusable or a file of that name (compared without regard to A-Z case)
 * already exists: a new program never replaces a file.
 */
export async function createProgramFile(fs: NewProgramStorage, path: string, headerTemplate: string): Promise<CreateProgramResult> {
  const slash = path.lastIndexOf("/");
  const folder = path.slice(0, Math.max(slash, 0));
  const fileName = path.slice(slash + 1);
  const unusable = unusableName(fileName) ?? (/\.prg$/i.test(fileName) && fileName.length > 4 ? null : "A program's name ends in .prg.");
  if (unusable !== null) return { ok: false, reason: "invalid", message: unusable };
  const listed = await fs.list(folder);
  if (!listed.ok && listed.error.code !== "not-found") return { ok: false, reason: "failed", message: `Could not read ${folder === "" ? "the project folder" : folder}: ${listed.error.message}` };
  if (listed.ok && listed.value.some((entry) => foldPath(entry.name) === foldPath(fileName))) {
    return { ok: false, reason: "exists", message: `${path} already exists (names are compared without regard to A-Z case). Nothing was created; choose another name.` };
  }
  const text = expandHeaderTemplate(headerTemplate, path).replace(/\n/g, "\r\n");
  const encoded = encodeCp1252(text);
  if (!encoded.ok) return { ok: false, reason: "invalid", message: `The header template cannot be written: ${encoded.error.message}. Nothing was created.` };
  const written = await fs.write(path, encoded.value);
  if (!written.ok) return { ok: false, reason: "failed", message: `Could not create ${path}: ${written.error.message}` };
  return { ok: true, path };
}
