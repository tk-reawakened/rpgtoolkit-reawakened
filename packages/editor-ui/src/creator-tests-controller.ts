import { rasterize, type AssetKey, type DecodedTexture, type DrawList, type RasterAsset, type RasterSurfaces, type SurfaceId } from "@tk-reawakened/core";
import { platformError, platformOk, type FileSystemService, type PlatformResult, type SavedTestsHostService } from "@tk-reawakened/platform-services";
import { isIgnoredProjectPath, runCreatorSpecs, type CreatorFrameObservation, type SpecProjectFile, type SpecProjectReport } from "@tk-reawakened/script-spec";

export interface CreatorTestsRequest {
  readonly seed: number;
  readonly name: string;
}

/** Presentation of an observed engine frame, not another simulation or a canonical report field. */
export interface CreatorTestsFrame {
  readonly tick: number;
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

export interface CreatorTestsState {
  readonly phase: "idle" | "preparing" | "running" | "complete" | "failed" | "closed";
  readonly report: SpecProjectReport | null;
  readonly frame: CreatorTestsFrame | null;
  readonly message: string | null;
}

/** Owned by the project, not by a mounted or hidden Tests view. Native webviews use this same surface over their bridge. */
export interface CreatorTestsController {
  getSnapshot(): CreatorTestsState;
  subscribe(listener: () => void): () => void;
  run(request: CreatorTestsRequest): Promise<PlatformResult<void>>;
  openSource(path: string, line: number, column: number): Promise<PlatformResult<void>>;
  dispose(): void;
}

export interface CreatorTestsControllerOptions {
  readonly fs: Pick<FileSystemService, "list" | "readProject">;
  readonly host: SavedTestsHostService;
}

const MAX_FILES = 20_000;
const closedMessage = "The project was closed, so no saved tests were started.";

/** Read saved bytes once. Folder links are not traversed, matching the Node adapter's ordinary-file discovery. */
async function savedFiles({ fs, host }: CreatorTestsControllerOptions, active: () => boolean): Promise<PlatformResult<readonly SpecProjectFile[]>> {
  const files: SpecProjectFile[] = [];
  const folders = [""];
  while (folders.length > 0) {
    if (!active()) return platformError("unavailable", closedMessage);
    const folder = folders.pop()!;
    const listed = await fs.list(folder);
    if (!listed.ok) return platformError(listed.error.code, `Saved tests could not list ${folder || "the project root"}: ${listed.error.message}`);
    for (const entry of [...listed.value].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const path = folder === "" ? entry.name : `${folder}/${entry.name}`;
      if (isIgnoredProjectPath(path)) continue;
      if (entry.kind === "directory") folders.push(path);
      else if (entry.kind === "file") {
        if (files.length >= MAX_FILES) return platformError("invalid-request", `Saved tests exceed the ${MAX_FILES}-file snapshot limit.`);
        if (!active()) return platformError("unavailable", closedMessage);
        const read = await fs.readProject(host.project, path);
        if (!read.ok) return platformError(read.error.code, `Saved tests could not read ${path}: ${read.error.message}`);
        files.push({ path, bytes: read.value });
      }
    }
  }
  return platformOk(files);
}

/** Replay the last actual engine draw list with its own decoded pictures and versioned surfaces (G4). */
function observedFrame(frame: CreatorFrameObservation): PlatformResult<CreatorTestsFrame> {
  const assets = new Map<AssetKey, RasterAsset>();
  const cachedAsset = assets.get.bind(assets);
  assets.get = (key) => {
    const cached = cachedAsset(key);
    if (cached !== undefined) return cached;
    const loaded = frame.picturePixels(key) ?? frame.assetBytes(key);
    if (loaded !== null) assets.set(key, loaded);
    return loaded ?? undefined;
  };
  const surfaces: RasterSurfaces = new Map<SurfaceId, DecodedTexture>();
  const revisions = new Map<SurfaceId, Map<number, DecodedTexture>>();
  surfaces.get = (id, revision?: number) => {
    if (revision === undefined) return undefined;
    const cached = revisions.get(id)?.get(revision);
    if (cached !== undefined) return cached;
    const loaded = frame.surfacePixels(id, revision);
    if (loaded === null) return undefined;
    let versions = revisions.get(id);
    if (versions === undefined) { versions = new Map(); revisions.set(id, versions); }
    versions.set(revision, loaded);
    return loaded;
  };
  // The reference rasterizer only reads; the observation deliberately exposes no mutable draw-list capability.
  const pixels = rasterize(frame.drawList as DrawList, assets, surfaces);
  return pixels.error === null
    ? platformOk({ tick: frame.tick, width: pixels.width, height: pixels.height, rgba: pixels.rgba })
    : platformError("io-error", `The real fixture frame could not be drawn: ${pixels.error}`);
}

/** TOOL-5: one frozen saved-byte inventory and the same framework as the CLI, never an editor-only test runner. */
export function createCreatorTestsController(options: CreatorTestsControllerOptions): CreatorTestsController {
  let state: CreatorTestsState = { phase: "idle", report: null, frame: null, message: null };
  let disposed = false;
  const listeners = new Set<() => void>();
  const publish = (next: CreatorTestsState): void => {
    state = next;
    for (const listener of listeners) listener();
  };
  const fail = (message: string): PlatformResult<void> => {
    if (!disposed) publish({ phase: "failed", report: null, frame: null, message });
    return platformError("unavailable", disposed ? closedMessage : message);
  };
  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async run(request) {
      if (disposed) return platformError("unavailable", closedMessage);
      if (state.phase === "preparing" || state.phase === "running") return platformError("unavailable", "Saved tests are already running.");
      if (!Number.isInteger(request.seed) || request.seed < 0 || request.seed > 4_294_967_295) return fail("The seed must be a whole number from 0 to 4294967295.");
      publish({ phase: "preparing", report: null, frame: null, message: null });
      try {
        const prepared = await options.host.prepare();
        if (disposed) return platformError("unavailable", closedMessage);
        if (!prepared.ok) return fail(prepared.error.message);
        const inventory = await savedFiles(options, () => !disposed);
        if (disposed) return platformError("unavailable", closedMessage);
        if (!inventory.ok) return fail(inventory.error.message);
        publish({ phase: "running", report: null, frame: null, message: null });
        const checked = prepared.value();
        if (!checked.ok) return fail(checked.error.message);
        let observed: CreatorFrameObservation | undefined;
        const report = runCreatorSpecs(inventory.value, {
          seed: request.seed,
          strict: true,
          ...(request.name === "" ? {} : { name: request.name }),
          project: options.host.project,
          onFrame: (frame) => { observed = frame; },
        });
        const last = observed as CreatorFrameObservation | undefined;
        const frame = last === undefined ? null : observedFrame(last);
        publish({ phase: "complete", report, frame: frame?.ok === true ? frame.value : null, message: frame !== null && !frame.ok ? frame.error.message : null });
        return platformOk(undefined);
      } catch (error) {
        return fail(`Saved tests could not run: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    async openSource(path, line, column) {
      if (disposed) return platformError("unavailable", "The project was closed; its program cannot be opened here.");
      const result = await options.host.openSource(path, Math.max(1, line), Math.max(1, column));
      if (!result.ok) publish({ ...state, message: result.error.message });
      return result;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      publish({ ...state, phase: "closed" });
      listeners.clear();
    },
  };
}
