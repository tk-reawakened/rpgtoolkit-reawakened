/**
 * The running-project wire contract (docs/spec/engine/rpgcode-tooling.md#tool-1-project).
 *
 * The client sends one complete snapshot of the selected main file and its
 * program inventory as the `rpgcode/project` notification. This module imports
 * nothing, so a language client can build a snapshot without bundling the
 * compiler, and the server and every client agree on one shape.
 */

/** The notification a client sends with a new project snapshot. */
export const PROJECT_NOTIFICATION = "rpgcode/project";

/** One inventory file: its root-relative path in its original spelling, its document URI and its bytes. */
export type ProjectSnapshotFile = {
  readonly path: string;
  readonly uri: string;
  /** The file's bytes, base64-encoded. */
  readonly bytes: string;
};

export type ProjectSnapshot = {
  /** Increases with every snapshot a client sends; the server keeps the highest. */
  readonly revision: number;
  /** The selected `.gam` file, or `null` when no running project is selected. */
  readonly main: { readonly uri: string; readonly bytes: string } | null;
  /** The project root ({@link projectRootUri}). */
  readonly rootUri?: string;
  readonly files?: readonly ProjectSnapshotFile[];
  /** The host also enumerated assets that may contain script hooks. */
  readonly hookInventoryComplete?: boolean;
  /** `tkr-lint.json` at the root, or `null` when it is absent. */
  readonly lintConfig?: { readonly uri: string; readonly text: string } | null;
  /** Why the client could not read the complete project; every document is then unassessed. */
  readonly problem?: string;
};

/** Whether a root-relative path names a program the inventory carries (`.prg` or `.rnc`, ASCII case-insensitive). */
export function isProgramPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".prg") || lower.endsWith(".rnc");
}

/** Project-relative asset paths that may hold embedded RPGCode. */
export function isHookAssetPath(path: string): boolean {
  const folders = ["boards", "item", "chrs", "enemy", "spcmove", "statuse"];
  const parts = path.replace(/\\/g, "/").toLowerCase().split("/");
  if (parts.length < 2) return false;
  if (parts[0] !== "game") return folders.includes(parts[0]!);
  return parts.slice(2, -1).some((part) => folders.includes(part));
}

/**
 * The project root of a main file's URI: the parent of a folder named `Main`
 * (ASCII case-insensitive), otherwise the folder holding the `.gam`. The URI's
 * scheme and spelling are kept, so a virtual workspace stays virtual. The
 * result ends with `/`.
 */
export function projectRootUri(mainUri: string): string {
  const cut = mainUri.search(/[?#]/);
  const path = cut < 0 ? mainUri : mainUri.slice(0, cut);
  const folder = path.slice(0, path.lastIndexOf("/") + 1);
  const trimmed = folder.slice(0, -1);
  const name = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  if (name.toLowerCase() === "main") return trimmed.slice(0, trimmed.lastIndexOf("/") + 1);
  return folder;
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Base64 without a platform API, so the same code runs in Node, a worker and a browser. */
export function encodeBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += ALPHABET[(triple >> 18) & 63]! + ALPHABET[(triple >> 12) & 63]!;
    out += i + 1 < bytes.length ? ALPHABET[(triple >> 6) & 63]! : "=";
    out += i + 2 < bytes.length ? ALPHABET[triple & 63]! : "=";
  }
  return out;
}

/** The bytes of a base64 string, or `undefined` when it is not base64. */
export function decodeBase64(text: string): Uint8Array | undefined {
  if (text.length % 4 !== 0) return undefined;
  const padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  const out = new Uint8Array((text.length / 4) * 3 - padding);
  let at = 0;
  for (let i = 0; i < text.length; i += 4) {
    let triple = 0;
    for (let j = 0; j < 4; j += 1) {
      const char = text[i + j]!;
      const value = char === "=" && i + j >= text.length - padding ? 0 : ALPHABET.indexOf(char);
      if (value < 0) return undefined;
      triple = (triple << 6) | value;
    }
    if (at < out.length) out[at++] = (triple >> 16) & 255;
    if (at < out.length) out[at++] = (triple >> 8) & 255;
    if (at < out.length) out[at++] = triple & 255;
  }
  return out;
}
