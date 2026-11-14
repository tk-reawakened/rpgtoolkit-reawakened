import {
  BinaryReader,
  deriveGameId,
  derivePackageIdentity,
  foldPath,
  loadPackage,
  PACKAGE_LIMITS,
  readDistributionManifest,
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

function isExcluded(path: string, mainPath: string, kind: "file" | "directory"): boolean {
  const folded = foldPath(path);
  const segments = folded.split("/");
  if (segments[0] === RESERVED_HISTORY_FOLDER) return true;
  if (segments[0] === "saved") return true;
  if (segments[0] === "main" && segments.length > 1 && folded !== foldPath(mainPath)) return true;
  if (kind === "directory") return false;
  const basename = segments.at(-1) ?? "";
  if (basename.endsWith(".spec.prg")) return true;
  const dot = basename.lastIndexOf(".");
  return dot >= 0 && EDITOR_ONLY_EXTENSIONS.has(basename.slice(dot));
}

const INSTALL_DESCRIPTOR_FIELDS = ["schema", "file", "sha256", "size", "gameId", "title", "version"] as const;

async function previousExportGameId(
  descriptorFile: PackageFile,
  packageFile: PackageFile,
  packageExport: PackageExportService,
): Promise<string | null> {
  if (!descriptorFile.path.toLowerCase().endsWith(".tpk.json")) return null;
  const packageName = packageFile.path.slice(packageFile.path.lastIndexOf("/") + 1);
  if (foldPath(descriptorFile.path) !== foldPath(`${packageFile.path}.json`)) return null;

  let descriptor: unknown;
  try { descriptor = JSON.parse(utf8Decode(descriptorFile.bytes)); }
  catch { return null; }
  if (
    typeof descriptor !== "object" ||
    descriptor === null ||
    Array.isArray(descriptor) ||
    Object.keys(descriptor).length !== INSTALL_DESCRIPTOR_FIELDS.length ||
    !INSTALL_DESCRIPTOR_FIELDS.every((field) => Object.hasOwn(descriptor, field))
  ) return null;
  const record = descriptor as Record<(typeof INSTALL_DESCRIPTOR_FIELDS)[number], unknown>;
  if (
    record.schema !== 1 ||
    record.file !== packageName ||
    typeof record.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(record.sha256) ||
    record.size !== packageFile.bytes.byteLength ||
    typeof record.gameId !== "string" ||
    typeof record.title !== "string" ||
    record.title.trim().length === 0 ||
    typeof record.version !== "string" ||
    record.version.trim().length === 0
  ) return null;

  try {
    const digest = await packageExport.sha256(packageFile.bytes);
    if (!digest.ok || digest.value !== record.sha256) return null;
  } catch {
    return null;
  }
  const loaded = loadPackage({ kind: "tpk", name: packageName, bytes: packageFile.bytes });
  if (!loaded.ok) return null;
  const manifest = readDistributionManifest(loaded.value);
  if (!manifest.ok) return null;
  const gameFiles = loaded.value.files.filter((file) => foldPath(file.path) !== "manifest.json");
  const mainFile = gameFiles.find((file) => foldPath(file.path) === foldPath(manifest.value.main));
  if (mainFile === undefined) return null;
  const main = readMainFile(new BinaryReader(mainFile.bytes, manifest.value.main));
  if (!main.ok || main.value.gameTitle.trim() !== record.title) return null;
  const gameId = deriveGameId(mainFile.bytes, derivePackageIdentity(gameFiles));
  return gameId === record.gameId ? gameId : null;
}

function folderKindFailure(path: string): string {
  return `The project folder ${path || "root"} changed while the package inventory was being read; retry preflight.`;
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
    const before = await fs.stat(folder.path);
    if (!before.ok) return failure(`Could not check ${folder.path || "the project root"} before listing it: ${before.error.message}`);
    if (before.value.kind === "link") return failure(`The project contains a symbolic link at ${folder.path || "the project root"}. This host cannot follow symbolic links safely, so the game was not packaged (L23).`);
    if (before.value.kind !== "directory") return failure(folderKindFailure(folder.path));
    const listing = await fs.list(folder.path);
    if (!listing.ok) return failure(`Could not inventory ${folder.path || "the project root"}: ${listing.error.message}`);
    const after = await fs.stat(folder.path);
    if (!after.ok) return failure(`Could not check ${folder.path || "the project root"} after listing it: ${after.error.message}`);
    if (after.value.kind === "link") return failure(`The project contains a symbolic link at ${folder.path || "the project root"}. This host cannot follow symbolic links safely, so the game was not packaged (L23).`);
    if (after.value.kind !== "directory") return failure(folderKindFailure(folder.path));
    for (const entry of listing.value) {
      entriesSeen += 1;
      if (entriesSeen > PACKAGE_LIMITS.maxEntries) return failure(`The project exceeds the package entry limit (${PACKAGE_LIMITS.maxEntries}, L2).`);
      if (!safeEntryName(entry.name)) return failure(`The project contains an unsafe path entry in ${folder.path || "the project root"}.`);
      const path = folder.path === "" ? entry.name : `${folder.path}/${entry.name}`;
      if (entry.kind === "link") return failure(`The project contains a symbolic link at ${path}. This host cannot follow symbolic links safely, so the game was not packaged (L23).`);
      const excluded = folder.excluded || isExcluded(path, mainPath, entry.kind);
      if (entry.kind === "directory") {
        pending.push({ path, excluded });
      } else if (excluded) {
        excludedFiles.push(path);
      } else {
        const stat = await fs.stat(path);
        if (!stat.ok) return failure(`Could not check ${path} before reading it: ${stat.error.message}`);
        if (stat.value.kind === "link") return failure(`The project contains a symbolic link at ${path}. This host cannot follow symbolic links safely, so the game was not packaged (L23).`);
        if (stat.value.kind !== "file") return failure(`${path} changed from a file while the package inventory was being read.`);
        if (!Number.isSafeInteger(stat.value.size) || stat.value.size < 0) return failure(`The host returned an invalid size for ${path}.`);
        if (stat.value.size > PACKAGE_LIMITS.maxEntryUncompressedBytes) return failure(`${path} exceeds the per-file package limit (${PACKAGE_LIMITS.maxEntryUncompressedBytes} bytes, L3).`);
        if (totalBytes + stat.value.size > PACKAGE_LIMITS.maxTotalUncompressedBytes) {
          return failure(`The project exceeds the total package size limit (${PACKAGE_LIMITS.maxTotalUncompressedBytes} bytes, L4).`);
        }
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

/** Exclude only complete, current-project exports; unrelated or unverifiable package assets remain data. */
async function excludeVerifiedPreviousExports(
  collected: CollectedFiles,
  mainFile: PackageFile,
  packageExport: PackageExportService,
): Promise<CollectedFiles> {
  const byPath = new Map<string, PackageFile>(collected.files.map((file) => [foldPath(file.path), file]));
  const groups = new Map<string, Set<string>>();
  for (const descriptor of collected.files) {
    if (!descriptor.path.toLowerCase().endsWith(".tpk.json")) continue;
    const archive = byPath.get(foldPath(descriptor.path.slice(0, -".json".length)));
    if (archive === undefined) continue;
    const gameId = await previousExportGameId(descriptor, archive, packageExport);
    if (gameId === null) continue;
    const paths = groups.get(gameId) ?? new Set<string>();
    paths.add(descriptor.path);
    paths.add(archive.path);
    groups.set(gameId, paths);
  }

  const excludedPaths = new Set<string>();
  for (const [gameId, paths] of groups) {
    const projectFiles = collected.files.filter((file) => !paths.has(file.path));
    if (deriveGameId(mainFile.bytes, derivePackageIdentity(projectFiles)) === gameId) {
      for (const path of paths) excludedPaths.add(path);
    }
  }
  if (excludedPaths.size === 0) return collected;
  return {
    ok: true,
    files: collected.files.filter((file) => !excludedPaths.has(file.path)),
    excludedFiles: [...collected.excludedFiles, ...excludedPaths].sort((left, right) => left < right ? -1 : left > right ? 1 : 0),
  };
}

function requiredAssetPath(folder: "Prg" | "Boards" | "Chrs", reference: string): string | null {
  const kind = folder === "Prg" ? "programs" : folder === "Boards" ? "boards" : "characters";
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
  const inventory = await excludeVerifiedPreviousExports(collected, mainFile, exportService);
  if (main.gameTitle.trim().length === 0) return failure("Set a game title in the main file before packaging.");
  if (main.initBoard.trim().length === 0) return failure("Set an initial board in the main file before packaging.");

  const available = new Set(inventory.files.map(({ path }) => foldPath(path)));
  const requiredAssets: readonly (readonly [string, "Prg" | "Boards" | "Chrs", string])[] = [
    ...(main.startupPrg === "" ? [] : [["startup program", "Prg", main.startupPrg] as const]),
    ["initial board", "Boards", main.initBoard],
    ...(main.initChar.trim().length === 0 ? [] : [["initial character", "Chrs", main.initChar] as const]),
  ];
  for (const [label, folder, reference] of requiredAssets) {
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
    index: inventory.files.map(({ path }) => path),
  };
  const archive = writeDistributionPackage({ files: inventory.files, manifest });
  if (!archive.ok) return failure(`Package preflight failed: ${archive.error.message}`);

  const digest = await exportService.sha256(archive.value);
  if (!digest.ok) return failure(`Could not calculate the install descriptor's SHA-256: ${digest.error.message}`);
  if (!/^[0-9a-f]{64}$/.test(digest.value)) return failure("The host returned an invalid SHA-256 digest for the package.");

  const gameId = deriveGameId(mainFile.bytes, derivePackageIdentity(inventory.files));
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
      includedFiles: inventory.files.map(({ path }) => path),
      excludedFiles: inventory.excludedFiles,
    },
  };
}
