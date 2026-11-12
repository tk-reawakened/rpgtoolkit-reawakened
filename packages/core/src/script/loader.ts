/**
 * The source-loading seam: how a script names a `.prg` file and how its bytes
 * reach the compiler without the core touching a file system (G2).
 *
 * A host gives the core an `AssetIndex` (the paths it can serve), the
 * `AssetRoot` they are rooted at and a `read` port that returns a file's bytes.
 * Names resolve through the one asset resolver, so `Prg/` and its subfolders,
 * the backslash/slash equivalence and the ASCII-only fold are the same rule the
 * format readers use (docs/spec/engine/rpgcode-modules-and-objects.md#includes,
 * docs/spec/formats/README.md#paths-inside-files). Bytes are Windows-1252
 * text; a file whose first byte is `0x00` is a pre-compiled program and is
 * refused, because the instruction format is not supported
 * (docs/spec/formats/rpgcode-program.md §9.1, docs/spec/engine/rpgcode-language.md).
 */

import { fnv1a64 } from "../canon/fnv1a.ts";
import { decodeCp1252 } from "../formats/binary/cp1252.ts";
import type { MainFile } from "../formats/main-file/model.ts";
import type { AssetIndex, AssetRoot } from "../formats/resolver/model.ts";
import { resolveAsset } from "../formats/resolver/resolver.ts";
import type { AssetKey } from "../ports/keys.ts";
import { PROGRAM_COMPILED, ScriptError } from "./errors.ts";
import type { ScriptDialect } from "./program.ts";

/** What the compiler needs to load program files: an index, its root and a byte port. */
export type ProgramLoader = {
  readonly index: AssetIndex;
  readonly root: AssetRoot;
  readonly dialect?: ScriptDialect;
  /** The bytes of the canonical `key`, or `undefined` when the host cannot serve it. */
  readonly read: (key: AssetKey) => Uint8Array | undefined;
};

/** docs/spec/engine/rpgcode-dialects.md#reawakened-project-script-dialect */
export function projectScriptDialect(main: Pick<MainFile, "major" | "minor">): ScriptDialect {
  return main.major === 2 && main.minor <= 2 ? "tk2" : "tk3";
}

/** A loaded source file: its canonical key, decoded text and the hash of its bytes. */
export type LoadedSource = {
  readonly key: AssetKey;
  readonly text: string;
  readonly hash: string;
};

/** The canonical key of the program `name` names under `Prg/`, or `undefined` when the index lacks it. */
export function resolveProgram(loader: ProgramLoader, name: string): AssetKey | undefined {
  const resolved = resolveAsset(loader.index, loader.root, "programs", name);
  return resolved.ok ? resolved.value : undefined;
}

/**
 * Read the program `name`. `undefined` when the name resolves to nothing or the
 * host serves no bytes for it; a compiled program is refused (§9.1).
 */
export function readProgram(loader: ProgramLoader, name: string): LoadedSource | undefined {
  const key = resolveProgram(loader, name);
  if (key === undefined) return undefined;
  const bytes = loader.read(key);
  if (bytes === undefined) return undefined;
  if (bytes.length > 0 && bytes[0] === 0) {
    throw new ScriptError(
      PROGRAM_COMPILED,
      `"${name}" is a compiled program (its first byte is 0x00), which is not supported; re-save the source (docs/spec/formats/rpgcode-program.md §9.1)`,
    );
  }
  return { key, text: decodeCp1252(bytes, 0, bytes.length), hash: fnv1a64(bytes) };
}
