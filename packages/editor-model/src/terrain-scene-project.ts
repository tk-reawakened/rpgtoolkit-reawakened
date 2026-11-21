import { decodeTexture, utf8Decode, type DecodedTexture } from "@tk-reawakened/core";
import { documentId, foldId, readAssetPack, readScene, readTerrainTileset, readTile, readTileset, type NativeTile, type NativeTileSample, type Scene, type TerrainTileset, type Tileset } from "@tk-reawakened/native-data";
import type { FileSystemService } from "@tk-reawakened/platform-services";
import { buildScene, type SceneBuildResult } from "./scene-build.ts";
import { previewBuiltScene, type SceneBuildPreview } from "./scene-build-preview.ts";
import type { BoardPreviewOptions, PreviewStorage } from "./board-preview.ts";
import type { SceneTileCrop } from "./scene-tile-slots.ts";
import type { SceneBuildCheck, SceneBuildOutput, SceneBuildWriteResult } from "./scene-build-ownership.ts";

type ProjectFs = Pick<FileSystemService, "list" | "read">;
type Ownership = {
  readonly check: (scene: string, outputs: readonly SceneBuildOutput[]) => Promise<{ readonly ok: true; readonly check: SceneBuildCheck } | { readonly ok: false; readonly message: string }>;
  readonly write: (review: SceneBuildCheck, outputs: readonly SceneBuildOutput[], authorizedPaths?: readonly string[]) => Promise<SceneBuildWriteResult>;
};
type Problem = { readonly path: string; readonly message: string };
type ManagedSample = Extract<NativeTileSample, { readonly source: string }>;
type Built = Extract<SceneBuildResult, { readonly ok: true }>;
type InventoryWithFiles = Extract<TerrainSceneProjectInventory, { readonly ok: true }> & {
  readonly files: ReadonlyMap<string, string>;
  readonly nativeTiles: ReadonlyMap<string, NativeTile>;
  readonly embeddedTilesets: ReadonlyMap<string, Tileset>;
};
type InventoryFailure = Extract<TerrainSceneProjectInventory, { readonly ok: false }>;

export type TerrainSceneProjectInventory =
  | { readonly ok: true; readonly tilesets: ReadonlyMap<string, TerrainTileset>; readonly tiles: readonly string[] }
  | { readonly ok: false; readonly problems: readonly Problem[] };
export type TerrainSceneProjectPreparation =
  | { readonly ok: true; readonly scene: Scene; readonly built: Built; readonly check: SceneBuildCheck }
  | { readonly ok: false; readonly problems: readonly Problem[] };

const identity = (path: string): string => foldId(documentId(path));
const safePath = (path: string): boolean => path.length > 0 && !path.startsWith("/") && !path.includes("\\") && !/^[A-Za-z]:/.test(path) && !/[\u0000-\u001f\u007f]/.test(path) && path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** Inventory every native tileset so ownership conflicts cannot be hidden by an incomplete palette. */
async function inventory(fs: ProjectFs): Promise<InventoryWithFiles | InventoryFailure> {
  const paths: string[] = [];
  const pending = [""];
  while (pending.length > 0) {
    const folder = pending.pop()!;
    const listing = await fs.list(folder);
    if (!listing.ok) return { ok: false, problems: [{ path: folder, message: `Cannot inventory project: ${listing.error.message}` }] };
    for (const entry of listing.value) {
      if (!safePath(entry.name) || entry.name.includes("/")) return { ok: false, problems: [{ path: folder, message: "The project contains an unsafe directory entry." }] };
      const path = folder === "" ? entry.name : `${folder}/${entry.name}`;
      if (entry.kind === "link") return { ok: false, problems: [{ path, message: "Cannot safely inventory a symbolic link." }] };
      if (entry.kind === "directory") pending.push(path);
      else paths.push(path);
    }
  }
  paths.sort();
  const files = new Map<string, string>();
  const tilesets = new Map<string, TerrainTileset>();
  const nativeTiles = new Map<string, NativeTile>();
  const embeddedTilesets = new Map<string, Tileset>();
  const problems: Problem[] = [];
  for (const path of paths) {
    const key = identity(path);
    const previous = files.get(key);
    if (previous !== undefined) { problems.push({ path, message: `Project path collides with ${previous}.` }); continue; }
    files.set(key, path);
    if (!key.endsWith(".tkrtle") && !key.endsWith(".tkrtst")) continue;
    const read = await fs.read(path);
    if (!read.ok) { problems.push({ path, message: `Cannot read native document: ${read.error.message}` }); continue; }
    try {
      const text = utf8Decode(read.value);
      if (key.endsWith(".tkrtle")) {
        const parsed = readTile(text);
        if (parsed.ok) nativeTiles.set(path, parsed.tile);
        else for (const problem of parsed.problems) problems.push({ path, message: `${problem.path}: ${problem.message}` });
        continue;
      }
      const parsed = readTerrainTileset(text);
      if (parsed.ok) { tilesets.set(path, parsed.tileset); continue; }
      const embedded = readTileset(text);
      if (embedded.ok) embeddedTilesets.set(key, embedded.tileset);
      else for (const problem of parsed.problems) problems.push({ path, message: `${problem.path}: ${problem.message}` });
    } catch (error) { problems.push({ path, message: `Cannot read native document: ${message(error)}` }); }
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, tilesets, tiles: [...nativeTiles.keys()], files, nativeTiles, embeddedTilesets };
}

/** Project-wide tileset and standalone tile choices, with parse and inventory failures surfaced. */
export async function loadTerrainSceneProjectInventory(fs: ProjectFs): Promise<TerrainSceneProjectInventory> {
  const result = await inventory(fs);
  return result.ok ? { ok: true, tilesets: result.tilesets, tiles: result.tiles } : result;
}

type ProjectBuildInputs = {
  readonly fs: ProjectFs;
  readonly scenePath: string;
  readonly sceneText?: string;
  readonly resolveManagedCrop?: (sample: ManagedSample) => Promise<SceneTileCrop | null>;
};
type ProjectBuild = { readonly ok: true; readonly scene: Scene; readonly built: Built } | InventoryFailure;

async function compileSceneProject(options: ProjectBuildInputs): Promise<ProjectBuild> {
  const { fs, scenePath } = options;
  if (!safePath(scenePath)) return { ok: false, problems: [{ path: scenePath, message: "Scene path must be project-relative." }] };
  let text = options.sceneText;
  if (text === undefined) {
    const read = await fs.read(scenePath);
    if (!read.ok) return { ok: false, problems: [{ path: scenePath, message: `Cannot read scene: ${read.error.message}` }] };
    try { text = utf8Decode(read.value); }
    catch (error) { return { ok: false, problems: [{ path: scenePath, message: `Cannot decode scene: ${message(error)}` }] }; }
  }
  const parsed = readScene(text);
  if (!parsed.ok) return { ok: false, problems: parsed.problems.map((problem) => ({ path: scenePath, message: `${problem.path}: ${problem.message}` })) };
  const project = await inventory(fs);
  if (!project.ok) return project;
  const images = new Map<string, DecodedTexture>();
  const readFile = async (path: string): Promise<Uint8Array> => {
    const canonical = documentId(path);
    if (!safePath(canonical)) throw new Error(`Invalid project path ${path}.`);
    const actual = project.files.get(identity(canonical));
    if (actual === undefined) throw new Error(`File ${path} was not found in the project.`);
    const result = await fs.read(actual);
    if (!result.ok) throw new Error(`Cannot read ${actual}: ${result.error.message}`);
    return result.value;
  };
  const built = await buildScene({
    scene: parsed.scene,
    scenePath,
    resolveTileset: async (path) => project.embeddedTilesets.get(identity(path)) ?? null,
    async resolvePack(path) {
      const result = readAssetPack(utf8Decode(await readFile(path)));
      if (!result.ok) throw new Error(`${path}: ${result.problems.map((problem) => `${problem.path}: ${problem.message}`).join("; ")}`);
      return result.assetPack;
    },
    readSource: async (path) => project.files.has(identity(path)) ? readFile(path) : null,
    terrain: {
      tilesets: project.tilesets,
      loadTile: async (path) => project.nativeTiles.get(project.files.get(identity(path)) ?? "") ?? null,
      async resolveCrop(sample) {
        if ("source" in sample) {
          if (options.resolveManagedCrop === undefined) throw new Error(`Managed source ${sample.source} requires an available managed crop resolver.`);
          const crop = await options.resolveManagedCrop(sample);
          if (crop === null) throw new Error(`Cannot resolve managed source ${sample.source}, frame ${sample.frame}, region ${sample.region}.`);
          return crop;
        }
        const key = identity(sample.file);
        let image = images.get(key);
        if (image === undefined) {
          const bytes = await readFile(sample.file);
          if (bytes.length >= 4 && bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 56) throw new Error(`GIF frame selection is not specified for ${sample.file}.`);
          const decoded = decodeTexture(bytes, sample.file);
          if (!decoded.ok) throw new Error(`Cannot decode ${sample.file}: ${decoded.error.message}`);
          if (decoded.warnings.length > 0) throw new Error(`Cannot decode ${sample.file} without warnings: ${decoded.warnings.join("; ")}`);
          image = decoded.value;
          images.set(key, image);
        }
        return { image, rect: sample.rect };
      },
    },
  });
  return built.ok ? { ok: true, scene: parsed.scene, built } : built;
}

/** Prepare the same build as Play and preview, checking destinations before a save can write. */
export async function prepareTerrainSceneProject(options: ProjectBuildInputs & { readonly ownership: Ownership }): Promise<TerrainSceneProjectPreparation> {
  const compiled = await compileSceneProject(options);
  if (!compiled.ok) return compiled;
  const checked = await options.ownership.check(options.scenePath, compiled.built.outputs);
  return checked.ok ? { ...compiled, check: checked.check } : { ok: false, problems: [{ path: options.scenePath, message: checked.message }] };
}

/** Render the project build in memory; no ownership check or persistence is needed to verify its picture. */
export async function previewTerrainSceneProject(
  options: ProjectBuildInputs & { readonly fs: ProjectFs & PreviewStorage; readonly projectId: string },
  previewOptions: BoardPreviewOptions = {},
): Promise<SceneBuildPreview> {
  const compiled = await compileSceneProject(options);
  return compiled.ok ? previewBuiltScene(options.fs, options.projectId, options.scenePath, compiled.built, previewOptions) : compiled;
}

/** Write only the exact reviewed outputs; conflicts require explicit path authorization. */
export function writePreparedTerrainSceneProject(prepared: Extract<TerrainSceneProjectPreparation, { readonly ok: true }>, ownership: Ownership, authorizedPaths: readonly string[] = []): Promise<SceneBuildWriteResult> {
  return ownership.write(prepared.check, prepared.built.outputs, authorizedPaths);
}
