import { utf8Encode, writeZipArchive } from "@tk-reawakened/core";
import { packageDescriptorFor } from "./package-export-write.ts";
import type { PackageArtifact, PreparedGamePackage } from "./package-export.ts";

export interface PreparedGameSetup {
  readonly artifact: PackageArtifact;
  readonly package: PackageArtifact;
  readonly descriptor: PackageArtifact;
  readonly instructions: PackageArtifact;
}

export type GameSetupOutcome =
  | { readonly ok: true; readonly value: PreparedGameSetup }
  | { readonly ok: false; readonly message: string };

const INSTRUCTIONS = `RPG Toolkit Reawakened game setup\n\nThis ZIP contains the game package, its install descriptor, and these instructions. It is not an installer and includes no player executable.\n\nTo install: open the compatible RPG Toolkit Reawakened player, choose Install, and select this setup ZIP. The player verifies the descriptor and registers a copy of the package in its own library. Then choose the game and select Play.\n\nTo remove: choose Remove for the game in the player. The player removes its library registration and package copy. Saves are not removed.\n\nThis setup is unsigned. Installation requires no administrator privileges, runs no scripts, and downloads nothing. A browser editor can create and download this ZIP, but cannot install or sign it.\n`;

/** Bundle the already-reviewed 12.9 package and descriptor without rereading or changing project files. */
export function prepareGameSetup(prepared: PreparedGamePackage): GameSetupOutcome {
  const descriptor = packageDescriptorFor(prepared, prepared.package.fileName);
  if (!descriptor.ok) return descriptor;
  const descriptorArtifact: PackageArtifact = {
    fileName: `${prepared.package.fileName}.json`,
    bytes: descriptor.bytes,
  };
  const instructions: PackageArtifact = {
    fileName: "README.txt",
    bytes: utf8Encode(INSTRUCTIONS),
  };
  const archive = writeZipArchive([
    { path: prepared.package.fileName, bytes: prepared.package.bytes },
    { path: descriptorArtifact.fileName, bytes: descriptorArtifact.bytes },
    { path: instructions.fileName, bytes: instructions.bytes },
  ]);
  if (!archive.ok) return { ok: false, message: `Could not build the setup ZIP: ${archive.error.message}` };
  const stem = prepared.package.fileName.replace(/\.tpk$/i, "");
  return {
    ok: true,
    value: {
      artifact: { fileName: `${stem}.setup.zip`, bytes: archive.value },
      package: prepared.package,
      descriptor: descriptorArtifact,
      instructions,
    },
  };
}
