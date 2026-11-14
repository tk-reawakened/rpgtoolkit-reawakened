import {
  BinaryReader,
  deriveGameId,
  derivePackageIdentity,
  foldPath,
  PACKAGE_LIMITS,
  readMainFile,
  stripTypeFolder,
  utf8Decode,
  utf8Encode,
  type PackageFile,
  writeDistributionPackage,
} from "@tk-reawakened/core";
import type { FileSystemService, PackageExportService, PlatformServices } from "@tk-reawakened/platform-services";
import type { DocumentWorkspace } from "./workspace.ts";

const RESERVED_HISTORY_FOLDER = ".tkr-history";
const EDITOR_ONLY_EXTENSIONS = new Set([".tkrscn", ".tkrtile", ".tkrpack"]);

/** The writer still enforces package limits; inventory also stops before it accumulates an oversized project. */
interface CollectedFiles {
  readonly ok: true;
  readonly files: readonly PackageFile[];
  readonly excludedFiles: readonly string[];
}

type FileCollectionOutcome = CollectedFiles | { readonly ok: false; readonly message: string };

export interface PackageArtifact {
  readonly fileName: string;
  readonly bytes: Uint8Array;
}

export interface PreparedGamePackage {
  readonly package: PackageArtifact;
  readonly descriptor: PackageArtifact;
  readonly includedFiles: readonly string[];
  readonly excludedFiles: readonly string[];
}

export type PackageExportOutcome =
  | { readonly ok: true; readonly value: PreparedGamePackage }
  | { readonly ok: false; readonly message: string };

export interface PrepareGamePackageOptions {
  readonly workspace: DocumentWorkspace;
  readonly services: Pick<PlatformServices, "fs" | "packageExport">;
  readonly mainPath: string;
  /** The release version is author-entered; the legacy `.gam` format has no version field. */
  readonly version: string;
}

function failure(message: string): { readonly ok: false; readonly message: string } {
  return { ok: false, message };
}

function isExcluded(path: string, mainPath: string): boolean {
  const folded = foldPath(path);
  const segments = folded.split("/");
  if (segments[0] === RESERVED_HISTORY_FOLDER) return true;
  if (segments[0] === "saved") return true;
  if (segments[0] === "main" && segments.length > 1 && folded !== foldPath(mainPath)) return true;
  const basename = segments.at(-1) ?? "";
  if (basename.endsWith(".spec.prg")) return true;
  const dot = basename.lastIndexOf(".");
  return dot >= 0 && EDITOR_ONLY_EXTENSIONS.has(basename.slice(dot));
}

function safeEntryName(name: string): boolean {
  return name.length > 0 && name !== "." && name !== ".." && !name.includes("/") && !name.includes("\\");
}

async function collectFiles(fs: FileSystemService, mainPath: string): Promise<FileCollectionOutcome> {
  const pending: { readonly path: string; readonly excluded: boolean }[] = [{ path: "", excluded: false }];
  const files: PackageFile[] = [];
  const excludedFiles: string[] = [];
  let entriesSeen = 0;
  let totalBytes = 0;

  while (pending.length > 0) {
    const folder = pending.pop()!;
    const listing = await fs.list(folder.path);
    if (!listing.ok) return failure(`Could not inventory ${folder.path || "the project root"}: ${listing.error.message}`);
    for (const entry of listing.value) {
      entriesSeen += 1;
      if (entriesSeen > PACKAGE_LIMITS.maxEntries) return failure(`The project exceeds the package entry limit (${PACKAGE_LIMITS.maxEntries}, L2).`);
      if (!safeEntryName(entry.name)) return failure(`The project contains an unsafe path entry in ${folder.path || "the project root"}.`);
      const path = folder.path === "" ? entry.name : `${folder.path}/${entry.name}`;
      const excluded = folder.excluded || isExcluded(path, mainPath);
      if (entry.kind === "directory") {
        pending.push({ path, excluded });
      } else if (excluded) {
        excludedFiles.push(path);
      } else {
        const read = await fs.read(path);
        if (!read.ok) return failure(`Could not read ${path}: ${read.error.message}`);
        if (read.value.byteLength > PACKAGE_LIMITS.maxEntryUncompressedBytes) return failure(`${path} exceeds the per-file package limit (${PACKAGE_LIMITS.maxEntryUncompressedBytes} bytes, L3).`);
        totalBytes += read.value.byteLength;
        if (totalBytes > PACKAGE_LIMITS.maxTotalUncompressedBytes) return failure(`The project exceeds the total package size limit (${PACKAGE_LIMITS.maxTotalUncompressedBytes} bytes, L4).`);
        files.push({ path, bytes: read.value });
      }
    }
  }
  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  excludedFiles.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  return { ok: true, files, excludedFiles };
}

function requiredAssetPath(folder: "Prg" | "Boards", reference: string): string | null {
  const kind = folder === "Prg" ? "programs" : "boards";
  const stripped = stripTypeFolder(kind, reference).replaceAll(String.fromCharCode(92), "/");
  if (stripped.length === 0 || stripped.startsWith("/") || stripped.split("/").some((part) => part === ".." || part === "")) return null;
  return `${folder}/${stripped}`;
}

/**
 * Save open documents, preflight the complete project, and use the core's distribution writer. Exclusions and format
 * limits follow docs/spec/formats/packaging-and-paths.md; test-only programs follow ADR 0022 D9 / TOOL-5.
 */
export async function prepareGamePackage(options: PrepareGamePackageOptions): Promise<PackageExportOutcome> {
  const version = options.version.trim();
  if (version.length === 0) return failure("Enter a release version before packaging the game.");
  if (version.length > 128) return failure("The release version must be 128 characters or fewer.");
  if (!foldPath(options.mainPath).startsWith("main/") || !foldPath(options.mainPath).endsWith(".gam")) {
    return failure("Choose a .gam main file from the project's Main folder.");
  }
  const exportService: PackageExportService | undefined = options.services.packageExport;
  if (exportService === undefined) return failure("This host does not provide package export support.");

  const saves = await options.workspace.saveAll();
  const saveFailures = saves.filter(({ result }) => !result.ok);
  if (saveFailures.length > 0) {
    return failure(`Save open documents before packaging: ${saveFailures.map(({ result }) => result.ok ? "" : result.failure.message).join("; ")}`);
  }

  const collected = await collectFiles(options.services.fs, options.mainPath);
  if (!collected.ok) return collected;
  const mainFile = collected.files.find(({ path }) => foldPath(path) === foldPath(options.mainPath));
  if (mainFile === undefined) return failure(`The selected main file ${options.mainPath} is missing or excluded.`);
  const mainResult = readMainFile(new BinaryReader(mainFile.bytes, options.mainPath));
  if (!mainResult.ok) return failure(`Could not read ${options.mainPath}: ${mainResult.error.message}`);
  const main = mainResult.value;
  if (main.gameTitle.trim().length === 0) return failure("Set a game title in the main file before packaging.");
  if (main.startupPrg.trim().length === 0) return failure("Set a startup program in the main file before packaging.");
  if (main.initBoard.trim().length === 0) return failure("Set an initial board in the main file before packaging.");

  const available = new Set(collected.files.map(({ path }) => foldPath(path)));
  for (const [label, folder, reference] of [
    ["startup program", "Prg", main.startupPrg],
    ["initial board", "Boards", main.initBoard],
  ] as const) {
    const expected = requiredAssetPath(folder, reference);
    if (expected === null || !available.has(foldPath(expected))) {
      return failure(`The ${label} “${reference}” is missing from the package inventory.`);
    }
  }

  const packageBase = main.gameTitle.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "game";
  const packageName = `${packageBase}.tpk`;
  const manifest = {
    schema: 1,
    main: mainFile.path,
    index: collected.files.map(({ path }) => path),
  };
  const archive = writeDistributionPackage({ files: collected.files, manifest });
  if (!archive.ok) return failure(`Package preflight failed: ${archive.error.message}`);

  const digest = await exportService.sha256(archive.value);
  if (!digest.ok) return failure(`Could not calculate the install descriptor's SHA-256: ${digest.error.message}`);
  if (!/^[0-9a-f]{64}$/.test(digest.value)) return failure("The host returned an invalid SHA-256 digest for the package.");

  const gameId = deriveGameId(mainFile.bytes, derivePackageIdentity(collected.files));
  const descriptor = {
    schema: 1,
    file: packageName,
    sha256: digest.value,
    size: archive.value.byteLength,
    gameId,
    title: main.gameTitle.trim(),
    version,
  };
  const descriptorBytes = utf8Encode(`${JSON.stringify(descriptor, null, 2)}\n`);
  const decodedDescriptor: unknown = JSON.parse(utf8Decode(descriptorBytes));
  const descriptorFields = ["schema", "file", "sha256", "size", "gameId", "title", "version"];
  if (
    typeof decodedDescriptor !== "object" ||
    decodedDescriptor === null ||
    Object.keys(decodedDescriptor).length !== descriptorFields.length ||
    !descriptorFields.every((field) => Object.hasOwn(decodedDescriptor, field))
  ) {
    return failure("The generated install descriptor did not match the seven-field contract.");
  }
  return {
    ok: true,
    value: {
      package: { fileName: packageName, bytes: archive.value },
      descriptor: { fileName: `${packageName}.json`, bytes: descriptorBytes },
      includedFiles: collected.files.map(({ path }) => path),
      excludedFiles: collected.excludedFiles,
    },
  };
}
