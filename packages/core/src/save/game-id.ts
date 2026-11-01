/**
 * The AD-17 save-area identity (`GameId`).
 *
 * `GameId` is a hash of the game's host-supplied identity plus the main file's
 * actual bytes, and prefixes every sandboxed blob path. Core exports both
 * derivations so every runner computes the same value from the bytes it already
 * holds (a package loader has the whole file list; a folder host reads them).
 *
 * **Encoding.** Every field is length-prefixed (`<length>:<text>` or
 * `<length>:<hash>`), so the pre-hash encoding is unambiguous: no path, content
 * hash or identity can be re-split into a different record, and `["ab", "c"]`
 * never encodes as `["a", "bc"]`.
 *
 * **Guarantee and its limit.** The digests are `fnv1a64` — a fast 64-bit,
 * non-cryptographic hash, and the project's one hash (AD-11). Distinct inputs
 * are *expected* to give distinct identities, but 64 bits cannot guarantee it:
 * by the birthday bound, two packages collide with probability near 1 in 2 for
 * about 2^32 distinct packages, and far less for any realistic library, but a
 * collision remains possible in principle. This is save-slot separation for a
 * single-player runtime, not a security boundary; a host that needs
 * collision-resistance must supply its own stronger identity (a SHA-256 of the
 * archive, say) as `gameIdentity`, which this module then folds in unchanged.
 *
 * The identity is still not a content hash on its own: the host chooses it for a
 * game folder (its project path is the natural choice), and
 * `derivePackageIdentity` computes it for a package. Core only folds in the main
 * file bytes so two games that ship a same-named main file stay apart.
 */
import { fnv1a64 } from "../canon/fnv1a.ts";

/** One file of a package, as the loader has it. */
export type PackageIdentityFile = {
  readonly path: string;
  readonly bytes: Uint8Array;
};

/** `text` as an unambiguous, length-prefixed field. A non-string is a programmer error, not a save area. */
function field(text: string): string {
  if (typeof text !== "string") throw new TypeError("a game identity field must be a string");
  return `${text.length}:${text}`;
}

/** A content hash as an unambiguous, length-prefixed field. */
function hashField(hash: string): string {
  if (typeof hash !== "string") throw new TypeError("a game identity content hash must be a string");
  return `${hash.length}:${hash}`;
}

/**
 * One file's record of the package identity, from its path and the `fnv1a64` hash of its bytes. A host that cannot
 * hold every file at once hashes each file as it passes and keeps only this record, then folds the records with
 * `foldPackageIdentity`; the result equals `derivePackageIdentity` over the same files.
 */
export function packageIdentityRecord(path: string, contentHash: string): string {
  return `${field(path)}${hashField(contentHash)}`;
}

/** Fold per-file records (`packageIdentityRecord`, in any order) into the package identity. */
export function foldPackageIdentity(records: readonly string[]): string {
  return fnv1a64([...records].sort().map(field).join(""));
}

/** A missing, empty or non-string identity is rejected rather than becoming a wrong save area. */
function requireIdentity(gameIdentity: string): void {
  if (typeof gameIdentity !== "string" || gameIdentity === "") {
    throw new TypeError("deriveGameId needs the host's non-empty game identity");
  }
}

/**
 * The canonical identity of a loaded package: a hash over its files' sorted,
 * length-prefixed `(path, content hash)` records. Sorted by UTF-16 code unit,
 * so archive order does not change the value; two packages whose paths and main
 * file match but whose other files differ have different records, and therefore
 * different identities unless the 64-bit digests collide (see the file comment).
 */
export function derivePackageIdentity(files: readonly PackageIdentityFile[]): string {
  return foldPackageIdentity(files.map((file) => packageIdentityRecord(file.path, fnv1a64(file.bytes))));
}

/**
 * AD-17's `GameId`: the host's game identity folded with the main file's actual
 * bytes. The host supplies `gameIdentity` — `derivePackageIdentity` for a
 * package, a host-chosen stable string for a folder — and core never invents one.
 * A missing, empty or non-string identity is rejected here rather than becoming
 * a wrong save area.
 */
export function deriveGameId(mainBytes: Uint8Array, gameIdentity: string): string {
  requireIdentity(gameIdentity);
  return deriveGameIdFromContentHash(fnv1a64(mainBytes), gameIdentity);
}

/** `deriveGameId` from the `fnv1a64` hash of the main file's bytes, for a host that no longer holds the bytes. */
export function deriveGameIdFromContentHash(mainContentHash: string, gameIdentity: string): string {
  requireIdentity(gameIdentity);
  return fnv1a64(`${field(gameIdentity)}${hashField(mainContentHash)}`);
}
