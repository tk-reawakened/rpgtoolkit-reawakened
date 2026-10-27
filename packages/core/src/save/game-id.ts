/**
 * The AD-17 save-area identity (`GameId`).
 *
 * `GameId` is a hash of the game's host-supplied identity plus the main file's
 * actual bytes, and prefixes every sandboxed blob path. Core exports both
 * derivations so every runner computes the same value from the bytes it already
 * holds (a package loader has the whole file list; a folder host reads them).
 *
 * **Encoding.** Every field is length-prefixed (`<length>:<text>` or
 * `<length>:<bytes>`), so the encoding is injective: no path, content hash or
 * identity can be re-split into a different record. A delimiter-joined form
 * would let `["ab", "c"]` and `["a", "bc"]` collide.
 *
 * The identity is *not* a content hash on its own: the host chooses it for a
 * game folder (its project path is the natural choice), and `derivePackageIdentity`
 * computes it for a package. Core only folds in the main file bytes so two games
 * that ship a same-named main file stay apart.
 */
import { fnv1a64 } from "../canon/fnv1a.ts";

/** One file of a package, as the loader has it. */
export type PackageIdentityFile = {
  readonly path: string;
  readonly bytes: Uint8Array;
};

/** `text` as an unambiguous, length-prefixed field. */
function field(text: string): string {
  return `${text.length}:${text}`;
}

/** `bytes` as an unambiguous, length-prefixed field (hashed, then length-prefixed). */
function byteField(bytes: Uint8Array): string {
  const hash = fnv1a64(bytes);
  return `${hash.length}:${hash}`;
}

/**
 * The canonical identity of a loaded package: a hash over its files' sorted,
 * length-prefixed `(path, content hash)` records. Sorted by UTF-16 code unit,
 * so archive order does not change the value; two packages whose paths and main
 * file match but whose other files differ get different identities.
 */
export function derivePackageIdentity(files: readonly PackageIdentityFile[]): string {
  const records = files
    .map((file) => `${field(file.path)}${byteField(file.bytes)}`)
    .sort();
  return fnv1a64(records.map(field).join(""));
}

/**
 * AD-17's `GameId`: the host's game identity folded with the main file's actual
 * bytes. The host supplies `gameIdentity` — `derivePackageIdentity` for a
 * package, a host-chosen stable string for a folder — and core never invents one.
 */
export function deriveGameId(mainBytes: Uint8Array, gameIdentity: string): string {
  return fnv1a64(`${field(gameIdentity)}${byteField(mainBytes)}`);
}
