import { utf8Decode, utf8Encode } from "@tk-reawakened/core";
import { platformError, type FileSystemService } from "@tk-reawakened/platform-services";
import { markHistoryPreview } from "./binary-document.ts";
import { HISTORY_FOLDER, type DocumentHistoryStore } from "./document-history.ts";
import { createDocumentIdentity } from "./identity.ts";
import { kindForPath, type AnyDocument } from "./kinds.ts";

/**
 * Pieces the history view needs and that are not storage: a read-only document over saved bytes (ADR 0022 D12.10 item 13),
 * a line comparison for text, and the ignore offer (item 11).
 */

export type HistoryPreviewOpen = { readonly ok: true; readonly document: AnyDocument } | { readonly ok: false; readonly message: string };

/**
 * Open `bytes` as a document of the kind `path` names, read-only and bound to no file: it never edits, never saves and
 * never reads the project, so showing a saved version cannot change anything. A view of the same editor mounts it.
 */
export function openHistoryPreview(projectId: string, path: string, bytes: Uint8Array, description: string): HistoryPreviewOpen {
  const kind = kindForPath(path);
  if (kind === null) return { ok: false, message: `${path} is not a file type the editor opens, so there is no editor to preview it in.` };
  const unavailable = async () => platformError("unavailable", "A history preview is not bound to the project.");
  const opened = kind.create({ readProject: unavailable, writeProject: unavailable }, createDocumentIdentity(projectId, path), bytes.slice());
  if (!opened.ok) return { ok: false, message: `That version of ${path} is not a file this editor reads: ${opened.error.error.message}` };
  markHistoryPreview(opened.document, `Saved version, ${description}. It is shown read-only; restoring it is a separate step.`);
  return { ok: true, document: opened.document };
}

export interface LineChange {
  readonly kind: "same" | "removed" | "added";
  readonly text: string;
}

/** The text of `bytes` when they are valid UTF-8, else `null` (a binary document has no line diff, D12.6). */
export function textOf(bytes: Uint8Array): string | null {
  try { return utf8Decode(bytes); } catch { return null; }
}

/** The most cells of the line table one comparison may use; beyond it the panel says the files are too large to compare. */
export const MAX_DIFF_CELLS = 4_000_000;

/**
 * A line comparison of two program texts: the longest common subsequence of lines, so the result reads as a diff.
 * `null` when the texts are too large to compare in memory (a row-by-column table of their lines), so a huge pair of
 * programs can never freeze the history panel or exhaust the host's memory.
 */
export function diffLines(before: string, after: string): readonly LineChange[] | null {
  const a = before.split("\n");
  const b = after.split("\n");
  const rows = a.length + 1;
  const cols = b.length + 1;
  if (rows * cols > MAX_DIFF_CELLS) return null;
  const table = new Uint32Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] = a[i] === b[j] ? table[(i + 1) * cols + j + 1]! + 1 : Math.max(table[(i + 1) * cols + j]!, table[i * cols + j + 1]!);
    }
  }
  const changes: LineChange[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { changes.push({ kind: "same", text: a[i]! }); i += 1; j += 1; }
    else if (table[(i + 1) * cols + j]! >= table[i * cols + j + 1]!) { changes.push({ kind: "removed", text: a[i]! }); i += 1; }
    else { changes.push({ kind: "added", text: b[j]! }); j += 1; }
  }
  while (i < a.length) { changes.push({ kind: "removed", text: a[i]! }); i += 1; }
  while (j < b.length) { changes.push({ kind: "added", text: b[j]! }); j += 1; }
  return changes;
}

const IGNORE_FILE = ".gitignore";
const IGNORE_LINE = `${HISTORY_FOLDER}/`;

export type IgnoreOffer = { readonly offer: false } | { readonly offer: true; readonly file: string; readonly line: string };

const ignores = (text: string): boolean => text.split(/\r?\n/).some((raw) => {
  const line = raw.trim().replace(/^\//, "").replace(/\/$/, "");
  return line === HISTORY_FOLDER || line === `${HISTORY_FOLDER}/*` || line === `${HISTORY_FOLDER}/**`;
});

/**
 * Whether the history view should offer to ignore the history folder (D12.10 item 11): the project root holds a `.git`
 * entry, and the project's `.gitignore` (when there is one) does not already ignore it. Nothing is written by asking.
 */
export async function ignoreOffer(fs: Pick<FileSystemService, "list" | "read">): Promise<IgnoreOffer> {
  const root = await fs.list("");
  if (!root.ok || !root.value.some((entry) => entry.name === ".git")) return { offer: false };
  const current = await fs.read(IGNORE_FILE);
  if (current.ok) {
    const text = textOf(current.value);
    if (text === null || ignores(text)) return { offer: false };
  } else if (current.error.code !== "not-found") return { offer: false };
  return { offer: true, file: IGNORE_FILE, line: IGNORE_LINE };
}

/** Append the ignore line after the user accepted the offer; existing lines are never rewritten. */
export async function acceptIgnoreOffer(fs: Pick<FileSystemService, "read" | "write">): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }> {
  const current = await fs.read(IGNORE_FILE);
  let text = "";
  if (current.ok) {
    const decoded = textOf(current.value);
    if (decoded === null) return { ok: false, message: `${IGNORE_FILE} is not text, so nothing was added.` };
    text = decoded;
  } else if (current.error.code !== "not-found") return { ok: false, message: current.error.message };
  if (ignores(text)) return { ok: true };
  const separator = text === "" || text.endsWith("\n") ? "" : "\n";
  const written = await fs.write(IGNORE_FILE, utf8Encode(`${text}${separator}${IGNORE_LINE}\n`));
  return written.ok ? { ok: true } : { ok: false, message: written.error.message };
}

/**
 * Keep what a delete is about to remove (D12.10, reason `before-delete`): every covered file at `path`, or below it when it
 * is a folder. The delete must not go ahead when this fails. Files history does not cover are counted, not hidden.
 */
export async function keepBeforeDelete(
  store: Pick<DocumentHistoryStore, "keep">,
  fs: Pick<FileSystemService, "list" | "read">,
  path: string,
  isFolder: boolean,
): Promise<{ readonly ok: true; readonly kept: number; readonly uncovered: readonly string[] } | { readonly ok: false; readonly message: string }> {
  const pending = [{ path, folder: isFolder }];
  let kept = 0;
  const uncovered: string[] = [];
  while (pending.length > 0) {
    const item = pending.pop()!;
    if (item.folder) {
      const listed = await fs.list(item.path);
      if (!listed.ok) return { ok: false, message: `Could not list ${item.path} to keep its documents in history first: ${listed.error.message}` };
      for (const entry of listed.value) pending.push({ path: `${item.path}/${entry.name}`, folder: entry.kind === "directory" });
      continue;
    }
    const read = await fs.read(item.path);
    if (!read.ok) return { ok: false, message: `Could not read ${item.path} to keep it in history first: ${read.error.message}` };
    try {
      const outcome = await store.keep(item.path, read.value, "before-delete");
      if (outcome.outcome === "uncovered") uncovered.push(item.path); else kept += 1;
    } catch (error) { return { ok: false, message: `${item.path} could not be kept in history, so nothing was deleted: ${error instanceof Error ? error.message : String(error)}` }; }
  }
  return { ok: true, kept, uncovered };
}
