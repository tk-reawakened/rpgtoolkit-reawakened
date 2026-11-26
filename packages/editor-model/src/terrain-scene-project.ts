import { decodeTexture, utf8Decode, utf8Encode, type DecodedTexture } from "@tk-reawakened/core";
import { documentId, foldId, readAssetPack, readScene, readTile, readTileset, type NativeTile, type NativeTileSample, type Scene, type Tileset } from "@tk-reawakened/native-data";
import type { FileSystemService } from "@tk-reawakened/platform-services";
import { buildScene, type SceneBuildResult } from "./scene-build.ts";
import { previewBuiltScene, type SceneBuildPreview } from "./scene-build-preview.ts";
import type { BoardPreviewOptions, PreviewStorage } from "./board-preview.ts";
import type { SceneTileCrop } from "./scene-tile-slots.ts";
import type { SceneBuildCheck, SceneBuildOutput, SceneBuildWriteResult } from "./scene-build-ownership.ts";
import { projectLayoutForDocumentPath } from "./reserved-folders.ts";
import type { TerrainScenePack } from "./scene-pack-placements.ts";
import { inspectTerrainRoles, type TerrainRoleReport } from "./terrain-matcher.ts";

type ProjectFs = Pick<FileSystemService, "list" | "read">;
type Ownership = {
  readonly check: (scene: string, outputs: readonly SceneBuildOutput[]) => Promise<{ readonly ok: true; readonly check: SceneBuildCheck } | { readonly ok: false; readonly message: string }>;
  readonly write: (review: SceneBuildCheck, outputs: readonly SceneBuildOutput[], authorizedPaths?: readonly string[], verifyInputs?: () => Promise<Verification>) => Promise<SceneBuildWriteResult>;
};
type Problem = { readonly path: string; readonly message: string };
type ManagedSample = Extract<NativeTileSample, { readonly source: string }>;
type Built = Extract<SceneBuildResult, { readonly ok: true }>;
type InventoryWithFiles = {
  readonly ok: true;
  readonly tilesets: ReadonlyMap<string, Tileset>;
  readonly files: ReadonlyMap<string, string>;
  readonly nativeTiles: ReadonlyMap<string, NativeTile>;
};
type InventoryFailure = Extract<TerrainSceneProjectInventory, { readonly ok: false }>;

/** The tilesets the scene view offers: each native terrain with the rule coverage its own matcher reports. */
export type TerrainSceneTileset = {
  readonly path: string;
  /**
   * Everything in the tileset document a build reads from it - the tiles, every terrain's full recipe (outside policy, seed,
   * variant weights, rules) and the output binding. Two reads with the same roles but another seed or weight differ here,
   * so a preview built from the earlier one is not shown as current.
   */
  readonly revision: string;
  readonly terrains: readonly { readonly id: string; readonly label: string; readonly roles: TerrainRoleReport }[];
};

/** Describe each tileset's terrains for the scene view, reading the same recipes the build resolves. */
export function terrainSceneTilesets(tilesets: ReadonlyMap<string, Tileset>): readonly TerrainSceneTileset[] {
  return [...tilesets].map(([path, tileset]) => ({
    path,
    revision: JSON.stringify(tileset),
    terrains: (tileset.terrains ?? []).map((terrain) => ({ id: terrain.id, label: terrain.name, roles: inspectTerrainRoles(terrain) })),
  }));
}

/** What a scene view shows from one inventory read; a failed read shows nothing as current and says why. */
export type TerrainSceneAssetsData = {
  readonly tilesets: readonly TerrainSceneTileset[];
  readonly assetTiles: readonly { readonly label: string; readonly tile: { readonly tile: string } }[];
  readonly packs: readonly TerrainScenePack[];
  readonly problems: readonly string[];
};

export function terrainSceneAssets(inventory: TerrainSceneProjectInventory): TerrainSceneAssetsData {
  if (!inventory.ok) {
    // The older roles are not kept on screen as if they were still the recipe: a failed read clears them.
    return { tilesets: [], assetTiles: [], packs: [], problems: inventory.problems.map(({ path, message }) => `${path}: ${message}`) };
  }
  return {
    tilesets: terrainSceneTilesets(inventory.tilesets),
    assetTiles: inventory.tiles.map((tile) => ({ label: tile, tile: { tile } })),
    packs: inventory.packs,
    problems: [],
  };
}

export type TerrainSceneProjectInventory =
  | { readonly ok: true; readonly tilesets: ReadonlyMap<string, Tileset>; readonly tiles: readonly string[]; readonly packs: readonly TerrainScenePack[]; readonly packProblems: readonly Problem[] }
  | { readonly ok: false; readonly problems: readonly Problem[] };
export type TerrainSceneProjectPreparation =
  | (CompiledSceneProject & { readonly check: SceneBuildCheck })
  | { readonly ok: false; readonly problems: readonly Problem[] };

const identity = (path: string): string => foldId(documentId(path));
const safePath = (path: string): boolean => path.length > 0 && !path.startsWith("/") && !path.includes("\\") && !/^[A-Za-z]:/.test(path) && !/[\u0000-\u001f\u007f]/.test(path) && path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
const message = (error: unknown): string => error instanceof Error ? error.message : String(error);
const tilesetGame = (path: string): string => identity(/^Game\/[^/]+(?=\/)/i.exec(path)?.[0] ?? "");

type InventoryPaths = { readonly ok: true; readonly files: ReadonlyMap<string, string> };

async function projectFiles(fs: ProjectFs): Promise<InventoryPaths | InventoryFailure> {
  const files = new Map<string, string>();
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
      else {
        const key = identity(path);
        const previous = files.get(key);
        if (previous !== undefined) return { ok: false, problems: [{ path, message: `Project path collides with ${previous}.` }] };
        files.set(key, path);
      }
    }
  }
  return { ok: true, files };
}

/** Inventory the build's tileset and standalone tile inputs. Packs are read only when a scene uses them. */
async function inventory(fs: ProjectFs, gameFolder: string, readFile: (path: string) => Promise<Uint8Array>): Promise<InventoryWithFiles | InventoryFailure> {
  const project = await projectFiles(fs);
  if (!project.ok) return project;
  const { files } = project;
  const tilesets = new Map<string, Tileset>();
  const nativeTiles = new Map<string, NativeTile>();
  const problems: Problem[] = [];
  const game = identity(gameFolder);
  for (const path of [...files.values()].sort()) {
    const key = identity(path);
    if (!key.endsWith(".tkrtle") && !key.endsWith(".tkrtst")) continue;
    if (key.endsWith(".tkrtst") && tilesetGame(path) !== game) continue;
    try {
      const text = utf8Decode(await readFile(path));
      if (key.endsWith(".tkrtle")) {
        const parsed = readTile(text);
        if (parsed.ok) nativeTiles.set(path, parsed.tile);
        else for (const problem of parsed.problems) problems.push({ path, message: `${problem.path}: ${problem.message}` });
        continue;
      }
      const parsed = readTileset(text);
      if (parsed.ok) tilesets.set(path, parsed.tileset);
      else for (const problem of parsed.problems) problems.push({ path, message: `${problem.path}: ${problem.message}` });
    } catch (error) { problems.push({ path, message: `Cannot read native document: ${message(error)}` }); }
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, tilesets, files, nativeTiles };
}

/**
 * Browse the packs this scene can use without turning a broken pack into a build dependency: the
 * packs in this game, plus any pack the saved or current scene already names, even in another game.
 * A pack that is only reachable through a placement is marked `external`, so the picker can resolve
 * and open it without offering it as a new authoring choice.
 */
export async function loadTerrainSceneProjectInventory(fs: ProjectFs, scenePath: string, sceneText?: string): Promise<TerrainSceneProjectInventory> {
  const { projectFolder } = projectLayoutForDocumentPath(scenePath);
  const result = await inventory(fs, projectFolder, (path) => readProjectFile(fs, path));
  if (!result.ok) return result;
  const members = new Set([...result.tilesets.values()].flatMap(({ tiles }) => tiles.map(({ tile }) => identity(tile))));
  const references = new Set<string>();
  let text = sceneText;
  if (text === undefined) {
    const saved = result.files.get(identity(scenePath)) ?? scenePath;
    try { text = utf8Decode(await readProjectFile(fs, saved)); }
    catch { text = undefined; }
  }
  if (text !== undefined) {
    const parsed = readScene(text);
    if (parsed.ok) for (const placement of parsed.scene.placedPacks ?? []) references.add(identity(placement.pack));
  }
  const packs: TerrainScenePack[] = [];
  const packProblems: Problem[] = [];
  const game = identity(projectFolder);
  for (const path of [...result.files.values()].sort()) {
    const key = identity(path);
    if (!key.endsWith(".tkrpack")) continue;
    const ownGame = tilesetGame(path) === game;
    if (!ownGame && !references.has(key)) continue;
    try {
      const parsed = readAssetPack(utf8Decode(await readProjectFile(fs, path)));
      if (parsed.ok) {
        const { name, projection, assets } = parsed.assetPack;
        packs.push({ path, name, projection, ...(ownGame ? {} : { external: true }), assets: assets.map(({ id, name, kind, anchor }) => ({ id, name, kind, anchor })) });
      } else {
        for (const problem of parsed.problems) packProblems.push({ path, message: `${problem.path}: ${problem.message}` });
      }
    } catch (error) { packProblems.push({ path, message: `Cannot read native document: ${message(error)}` }); }
  }
  return { ok: true, tilesets: result.tilesets, tiles: [...result.nativeTiles.keys()].filter((path) => members.has(identity(path))), packs, packProblems };
}

type ProjectBuildInputs = {
  readonly fs: ProjectFs;
  readonly scenePath: string;
  readonly sceneText?: string;
  readonly resolveManagedCrop?: (sample: ManagedSample) => Promise<SceneTileCrop | null>;
};
type Verification = { readonly ok: true } | { readonly ok: false; readonly message: string };
type CompiledSceneProject = {
  readonly ok: true;
  readonly scene: Scene;
  readonly built: Built;
  readonly inputs: ReadonlyMap<string, Uint8Array>;
  readonly files: ReadonlyMap<string, string>;
  readonly verifyInputs: () => Promise<Verification>;
};

export function sameSceneBuildBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

async function readProjectFile(fs: ProjectFs, path: string): Promise<Uint8Array> {
  const read = await fs.read(path);
  if (!read.ok) throw new Error(read.error.message);
  return read.value;
}

export async function compileSceneProject(options: ProjectBuildInputs): Promise<CompiledSceneProject | InventoryFailure> {
  const { fs, scenePath } = options;
  if (!safePath(scenePath)) return { ok: false, problems: [{ path: scenePath, message: "Scene path must be project-relative." }] };
  const inputs = new Map<string, Uint8Array>();
  const observe = async (path: string): Promise<Uint8Array> => {
    const present = inputs.get(path);
    if (present !== undefined) return present;
    const bytes = await readProjectFile(fs, path);
    inputs.set(path, bytes);
    return bytes;
  };
  const { projectFolder } = projectLayoutForDocumentPath(scenePath);
  const project = await inventory(fs, projectFolder, observe);
  if (!project.ok) return project;
  const actualScenePath = project.files.get(identity(scenePath)) ?? scenePath;
  let text: string;
  try {
    if (options.sceneText === undefined) text = utf8Decode(await observe(actualScenePath));
    else {
      text = options.sceneText;
      inputs.set(actualScenePath, utf8Encode(text));
    }
  } catch (error) {
    return { ok: false, problems: [{ path: scenePath, message: `Cannot read scene: ${message(error)}` }] };
  }
  const parsed = readScene(text);
  if (!parsed.ok) return { ok: false, problems: parsed.problems.map((problem) => ({ path: scenePath, message: `${problem.path}: ${problem.message}` })) };
  const images = new Map<string, DecodedTexture>();
  const readFile = async (path: string): Promise<Uint8Array> => {
    const canonical = documentId(path);
    if (!safePath(canonical)) throw new Error(`Invalid project path ${path}.`);
    const actual = project.files.get(identity(canonical));
    if (actual === undefined) throw new Error(`File ${path} was not found in the project.`);
    return observe(actual);
  };
  const built = await buildScene({
    scene: parsed.scene,
    scenePath: actualScenePath,
    projectFolder,
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
  if (!built.ok) return built;
  return { ok: true, scene: parsed.scene, built, inputs, files: project.files, async verifyInputs() {
    const current = await projectFiles(fs);
    if (!current.ok) return { ok: false, message: current.problems.map((problem) => `${problem.path}: ${problem.message}`).join("; ") };
    const game = identity(projectFolder);
    for (const [key, path] of current.files) {
      if (key.endsWith(".tkrtst") && tilesetGame(path) === game && !project.tilesets.has(path)) {
        return { ok: false, message: `Tileset ${path} was added or renamed during the build. Save again.` };
      }
    }
    for (const [path, expected] of inputs) {
      const read = await fs.read(path);
      if (current.files.get(identity(path)) !== path || !read.ok || !sameSceneBuildBytes(expected, read.value)) {
        return { ok: false, message: `${path} changed on disk during the build. Save again.` };
      }
    }
    return { ok: true };
  } };
}

/** Prepare the same build as Play and preview, checking destinations before a save can write. */
export async function prepareTerrainSceneProject(options: ProjectBuildInputs & { readonly ownership: Ownership }): Promise<TerrainSceneProjectPreparation> {
  const compiled = await compileSceneProject(options);
  if (!compiled.ok) return compiled;
  const checked = await options.ownership.check(compiled.files.get(identity(options.scenePath)) ?? options.scenePath, compiled.built.outputs);
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
  return ownership.write(prepared.check, prepared.built.outputs, authorizedPaths, prepared.verifyInputs);
}
