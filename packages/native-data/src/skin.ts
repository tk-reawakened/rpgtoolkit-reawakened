import { isMap, isScalar, LineCounter, parseDocument, type Node, type Pair } from "yaml";
import { readDocument } from "./document.ts";
import { applySplices, rangeOf, scalarText } from "./splice.ts";
import { validatePluginData } from "./plugin-data.ts";
import { parseVersion } from "./version.ts";

export const SKIN_CONTRACT = "skin";
export const SKIN_VERSION = "1.0.0-pre.1";

export interface Skin {
  readonly contract: typeof SKIN_CONTRACT;
  /** The version is retained exactly as the author wrote it, including a build suffix. */
  readonly version: string;
  readonly label?: string;
  readonly windowImage: string;
  readonly buttonImage: string;
}

export interface SkinProblem {
  readonly kind: "stamp" | "shape" | "plugin-block" | "edit";
  readonly path: string;
  readonly message: string;
  readonly line: number | null;
}

export type SkinReadResult =
  | { readonly ok: true; readonly skin: Skin; readonly source: string }
  | { readonly ok: false; readonly problems: readonly SkinProblem[] };

export type SkinEditResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly problems: readonly SkinProblem[] };

export type SkinImageField = "windowImage" | "buttonImage";

const ROOT_KEYS = ["contract", "version", "tags", "metadata", "label", "windowImage", "buttonImage", "pluginData"] as const;
const IMAGE_EXTENSION = /\.(?:bmp|gif|jpe?g|png)$/i;

/** The reference spelling of docs/spec/formats/native-skin.md#document-shape: a path inside `bitmap/`, `/`-separated, no empty, `.` or `..` part. */
function validImageReference(reference: string): boolean {
  if (reference !== reference.trim() || /[\\\r\n]/.test(reference) || !IMAGE_EXTENSION.test(reference)) return false;
  const parts = reference.split("/");
  return parts.length >= 2
    && parts[0]!.toLowerCase() === "bitmap"
    && parts.slice(1).every((part) => part !== "" && part !== "." && part !== "..");
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const describe = (value: unknown): string => value === null ? "null" : Array.isArray(value) ? "a list" : typeof value === "object" ? "a mapping" : typeof value === "string" ? "text" : typeof value;

function problem(path: string, message: string, kind: SkinProblem["kind"] = "shape", line: number | null = null): SkinProblem {
  return { kind, path, message, line };
}

function jsonValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(jsonValue);
  return isRecord(value) && Object.values(value).every(jsonValue);
}

/** Read one `.tkrskin` document, retaining the source that all edits splice into. */
export function readSkin(text: string): SkinReadResult {
  const stamp = readDocument({ path: "(skin)", text }, [], ROOT_KEYS);
  if (stamp.stampReports.length > 0) {
    return { ok: false, problems: stamp.stampReports.map((report) => problem(report.key ?? "(document)", report.problem === "unreadable" ? `document unreadable: ${report.reason}` : `stamp ${report.problem}: ${report.reason}`, "stamp", report.line)) };
  }

  const lines = new LineCounter();
  const document = parseDocument(text, { version: "1.2", schema: "core", lineCounter: lines });
  const yamlProblems: SkinProblem[] = document.errors.map((error) => problem("(document)", `YAML error: ${error.message.split("\n")[0]!.replace(/:$/, "")}`, "shape", error.linePos?.[0]?.line ?? null));
  if (yamlProblems.length > 0) return { ok: false, problems: yamlProblems };
  if (!isMap(document.contents)) return { ok: false, problems: [problem("(document)", "the document is not a mapping")] };

  const pluginProblems = validatePluginData(document, text, lines, ROOT_KEYS);
  if (pluginProblems.length > 0) {
    return { ok: false, problems: pluginProblems.map((entry) => problem(entry.pluginId === null ? "pluginData" : `pluginData.${entry.pluginId}`, `${entry.kind}: ${entry.reason} (found ${JSON.stringify(entry.found)})`, "plugin-block", entry.line)) };
  }

  const raw: unknown = document.toJS();
  if (!isRecord(raw)) return { ok: false, problems: [problem("(document)", "the document is not a mapping")] };
  const errors: SkinProblem[] = [];
  for (const key of Object.keys(raw)) {
    if (!(ROOT_KEYS as readonly string[]).includes(key)) errors.push(problem(key, "unknown top-level key"));
  }
  if (raw.contract !== SKIN_CONTRACT) errors.push(problem("contract", `must be ${SKIN_CONTRACT}`));
  if (typeof raw.version !== "string" || !parseVersion(raw.version).ok || !raw.version.startsWith(`${SKIN_VERSION}+`) && raw.version !== SKIN_VERSION) {
    errors.push(problem("version", `must be ${SKIN_VERSION} with an optional build suffix`));
  }
  if (raw.tags !== undefined && (!Array.isArray(raw.tags) || !raw.tags.every((tag) => typeof tag === "string" && tag.trim() !== ""))) {
    errors.push(problem("tags", "must be a list of non-empty text values"));
  }
  if (raw.metadata !== undefined && (!isRecord(raw.metadata) || !jsonValue(raw.metadata))) errors.push(problem("metadata", "must be a mapping of JSON values"));
  if (raw.label !== undefined && (typeof raw.label !== "string" || raw.label.trim() === "")) errors.push(problem("label", `must be non-empty text, not ${describe(raw.label)}`));
  for (const field of ["windowImage", "buttonImage"] as const) {
    const reference = raw[field];
    if (typeof reference !== "string" || !validImageReference(reference)) {
      errors.push(problem(field, "must be a non-empty bitmap/ image path with a supported image extension"));
    }
  }
  if (errors.length > 0) return { ok: false, problems: errors };

  return {
    ok: true,
    source: text,
    skin: {
      contract: SKIN_CONTRACT,
      version: raw.version as string,
      ...(raw.label === undefined ? {} : { label: raw.label as string }),
      windowImage: raw.windowImage as string,
      buttonImage: raw.buttonImage as string,
    },
  };
}

/** Replace one existing single-line image reference in place; every other source byte stays unchanged. */
export function setSkinImage(text: string, field: SkinImageField, reference: string): SkinEditResult {
  const current = readSkin(text);
  if (!current.ok) return current;
  if (!validImageReference(reference)) {
    return { ok: false, problems: [problem(field, "must be a non-empty bitmap/ image path with a supported image extension", "edit")] };
  }
  if (current.skin[field] === reference) return { ok: false, problems: [problem(field, "the reference did not change", "edit")] };

  const document = parseDocument(text, { version: "1.2", schema: "core" });
  const root = document.contents;
  if (!isMap(root)) return { ok: false, problems: [problem("(document)", "the document is not a mapping", "edit")] };
  const pair = root.items.find((item) => isScalar(item.key) && item.key.value === field) as Pair | undefined;
  const value = pair?.value as Node | null | undefined;
  if (value === null || value === undefined || !isScalar(value) || value.type === "BLOCK_FOLDED" || value.type === "BLOCK_LITERAL") {
    return { ok: false, problems: [problem(field, "the image reference cannot be safely replaced in place", "edit")] };
  }
  const [start, end] = rangeOf(value);
  if (text.slice(start, end).includes("\n")) return { ok: false, problems: [problem(field, "the image reference spans multiple lines and cannot be safely replaced", "edit")] };
  const edited = applySplices(text, [{ start, end, text: scalarText(reference, value) }]);
  const verified = readSkin(edited);
  return verified.ok ? { ok: true, text: edited } : { ok: false, problems: verified.problems };
}
