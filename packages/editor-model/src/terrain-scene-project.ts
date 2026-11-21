import { decodeTexture, utf8Decode, type Board, type DecodedTexture } from "@tk-reawakened/core";
import { documentId, foldId, readScene, readTerrainTileset, readTile, type NativeTileSample, type Scene, type TerrainTileset } from "@tk-reawakened/native-data";
import type { FileSystemService } from "@tk-reawakened/platform-services";
import { buildTerrainBoard } from "./scene-terrain-board.ts";
import type { SceneTileCrop } from "./scene-tile-slots.ts";
import type { SceneBuildCheck, SceneBuildOutput, SceneBuildWriteResult } from "./scene-build-ownership.ts";

type ProjectFs = Pick<FileSystemService, "list" | "read">;
type Ownership = {
  readonly check: (scene: string, outputs: readonly SceneBuildOutput[]) => Promise<{ readonly ok: true; readonly check: SceneBuildCheck } | { readonly ok: false; readonly message: string }>;
  readonly write: (review: SceneBuildCheck, outputs: readonly SceneBuildOutput[], authorizedPaths?: readonly string[]) => Promise<SceneBuildWriteResult>;
};
type Problem = { readonly path: string; readonly message: string };
type ManagedSample = Extract<NativeTileSample, { readonly source: string }>;
type Built = { readonly board: Board; readonly outputs: readonly SceneBuildOutput[]; readonly notes: readonly Problem[] };
type InventoryWithFiles = Extract<TerrainSceneProjectInventory, { readonly ok: true }> & { readonly files: ReadonlyMap<string, string> };
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
  const tiles: string[] = [];
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
      if (key.endsWith(".tkrtle")) {
        const parsed = readTile(utf8Decode(read.value));
        if (parsed.ok) tiles.push(path);
        else for (const problem of parsed.problems) problems.push({ path, message: `${problem.path}: ${problem.message}` });
        continue;
      }
      const parsed = readTerrainTileset(utf8Decode(read.value));
      if (parsed.ok) tilesets.set(path, parsed.tileset);
      else for (const problem of parsed.problems) problems.push({ path, message: `${problem.path}: ${problem.message}` });
    } catch (error) { problems.push({ path, message: `Cannot read native document: ${message(error)}` }); }
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, tilesets, tiles, files };
}

/** Project-wide tileset and standalone tile choices, with parse and inventory failures surfaced. */
export async function loadTerrainSceneProjectInventory(fs: ProjectFs): Promise<TerrainSceneProjectInventory> {
  const result = await inventory(fs);
  return result.ok ? { ok: true, tilesets: result.tilesets, tiles: result.tiles } : result;
}

/** Resolve the project files and prepare the board and generated tiles for ownership review. */
export async function prepareTerrainSceneProject(options: {
  readonly fs: ProjectFs;
  readonly scenePath: string;
  readonly sceneText?: string;
  readonly ownership: Ownership;
  readonly resolveManagedCrop?: (sample: ManagedSample) => Promise<SceneTileCrop | null>;
}): Promise<TerrainSceneProjectPreparation> {
  const { fs, scenePath, ownership } = options;
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
  const built = await buildTerrainBoard({
    scene: parsed.scene,
    scenePath,
    tilesets: project.tilesets,
    async loadTile(path) {
      const result = readTile(utf8Decode(await readFile(path)));
      if (!result.ok) throw new Error(`${path}: ${result.problems.map((problem) => `${problem.path}: ${problem.message}`).join("; ")}`);
      return result.tile;
    },
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
  });
  if (!built.ok) return built;
  const checked = await ownership.check(scenePath, built.outputs);
  return checked.ok ? { ok: true, scene: parsed.scene, built, check: checked.check } : { ok: false, problems: [{ path: scenePath, message: checked.message }] };
}

/** Write only the exact reviewed outputs; conflicts require explicit path authorization. */
export function writePreparedTerrainSceneProject(prepared: Extract<TerrainSceneProjectPreparation, { readonly ok: true }>, ownership: Ownership, authorizedPaths: readonly string[] = []): Promise<SceneBuildWriteResult> {
  return ownership.write(prepared.check, prepared.built.outputs, authorizedPaths);
}
