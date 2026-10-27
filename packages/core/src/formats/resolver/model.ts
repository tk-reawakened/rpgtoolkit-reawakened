/**
 * The asset index and the roots a reference resolves from (docs/spec/formats/README.md#paths-inside-files,
 * AD-5).
 *
 * The core never touches a file system (G2): a runner gives it an `AssetIndex`
 * — the relative paths the host can serve — and the resolver turns a logical
 * reference into a canonical `AssetKey` over that list. The layout rules are
 * docs/spec/formats/README.md#paths-inside-files's: backslash and slash are equivalent, matching is case-insensitive, and
 * a reference is relative to the folder of its asset type.
 */

import type { AssetKey } from "../../ports/keys.ts";

/**
 * A package or a game folder — where an index's paths are rooted (AD-5, docs/spec/formats/packaging-and-paths.md.
 *
 * A reference resolves under `<root>/Game/<projectPath>/` for a game folder,
 * but for a package the project folder is the package root and the main file's
 * `projectPath` is ignored(docs/spec/formats/packaging-and-paths.md, AD-5).
 */
export type AssetRoot = PackageAssetRoot | GameAssetRoot;

/** A package root: the index's paths are the package's, and `projectPath` is ignored(docs/spec/formats/packaging-and-paths.md). */
export interface PackageAssetRoot {
  readonly kind: "package";
  /**
   * The host's canonical identity for the package: its archive name and version,
   * or a digest over the package's contents (AD-17). `deriveGameId` hashes it, so
   * two packages whose paths and main file match but whose other files differ
   * still get separate save areas. Core never reads the whole package, so only
   * the host can supply this; omit it only when the host cannot tell such
   * packages apart.
   */
  readonly identity?: string;
}

/** A game-folder root: references resolve under `<root>/Game/<projectPath>/`(docs/spec/formats/README.md#paths-inside-files). */
export interface GameAssetRoot {
  readonly kind: "game";
  /** The main file's `projectPath`; leading and trailing separators are ignored(docs/spec/formats/README.md#paths-inside-files). */
  readonly projectPath: string;
}

/** The package asset root, shared so callers need not build one (AD-5). */
export const PACKAGE_ROOT: PackageAssetRoot = { kind: "package" };

/**
 * The paths a running game's assets live at, as the host supplies them (AD-5).
 *
 * `paths` are relative to `AssetRoot`: a game folder lists
 * `Game/<project>/Boards/…` and `Main/<game>.gam`; a package lists the archive's
 * own paths. `keys` are the canonical, case-folded lookup keys parallel to
 * `paths`, and `byKey` is the lookup itself. Build one with
 * `createAssetIndex`.
 */
export interface AssetIndex {
  /** The package's paths, with `\` normalised to `/` (order preserved). */
  readonly paths: readonly string[];
  /** The canonical `AssetKey` of each path, parallel to `paths`. */
  readonly keys: readonly AssetKey[];
  /** Case-folded key to canonical key. */
  readonly byKey: ReadonlyMap<string, AssetKey>;
}
