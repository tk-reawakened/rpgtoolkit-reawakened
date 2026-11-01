import {
  assetKey,
  createAssetIndex,
  createEmptyMainFile,
  createEngine,
  createSpriteRuntime,
  deriveGameId,
  derivePackageIdentity,
  DEFAULT_FONT_ASSET,
  hashDrawList,
  PACKAGE_ROOT,
  writeMainFile,
  type AssetKey,
  type DrawList,
  type Engine,
  type GameState,
  type InputRecord,
  type RunnerRequest,
  type SurfaceId,
} from "@tk-reawakened/core";
import { inputPhaseRegistration, inputResetRegistration, movementPhaseRegistration } from "@tk-reawakened/core";
import { parseClosingPlan, type ClosingFiles } from "@tk-reawakened/runner-harness";
import { createWebgl2Renderer, type RenderStats } from "@tk-reawakened/render-webgl2";
import { fontProvider, textureProvider } from "./index.ts";

export type LiveBlobHost = {
  read(area: "saves" | "files", gameId: string, path: string): Promise<Uint8Array | null>;
  write(area: "saves" | "files", gameId: string, path: string, bytes: Uint8Array): Promise<boolean>;
  list?(area: "saves" | "files", gameId: string): Promise<readonly string[]>;
};
export type LiveSession = {
  readonly engine: Engine;
  readonly gameId: string;
  readonly close: () => void;
  readonly tick: () => number;
  readonly stateHash: () => string;
  readonly viewSize: () => { readonly width: number; readonly height: number };
  readonly draw: (alpha: number) => { readonly drawHash: string; readonly commands: number; readonly render: RenderStats };
  readonly playerPosition: () => { readonly x: number; readonly y: number } | null;
  readonly advance: (ticks: number, inputs?: readonly InputRecord[]) => Promise<void>;
};
type LiveSessionBase = {
  readonly files: ClosingFiles;
  readonly bundled: ClosingFiles;
  readonly gl: WebGL2RenderingContext;
  readonly blobs?: LiveBlobHost;
};
export type LiveSessionOptions = LiveSessionBase & (
  | { readonly interactive: true; readonly mainFile: string; readonly gameIdentity: string }
  | { readonly interactive?: false; readonly planText: string; readonly gameName: string }
);

/** Persistent engine and host request pump shared by browser and desktop players. */
export function createLiveSession(options: LiveSessionOptions): LiveSession {
  const interactive = options.interactive === true;
  const plan = interactive ? null : parseClosingPlan(options.planText);
  const game = plan?.games.find((entry) => entry.name === (!interactive ? options.gameName : ""));
  if (!interactive && game === undefined) throw new Error(`runner-web: the plan does not list ${options.gameName}`);
  const files = new Map<AssetKey, Uint8Array>();
  for (const [path, bytes] of options.files) files.set(assetKey(path), bytes);
  let mainFile: string;
  if (interactive) mainFile = options.mainFile;
  else {
    if (game === undefined) throw new Error(`runner-web: the plan does not list ${options.gameName}`);
    if ("file" in game.main) mainFile = game.main.file;
    else {
      mainFile = "main.gam";
      const data = { ...createEmptyMainFile(), major: 2, minor: 9, ...game.main.synthesised };
      const encoded = writeMainFile(data);
      if (!encoded.ok) throw new Error(`runner-web: ${encoded.error.message}`);
      files.set(assetKey(mainFile), encoded.value);
    }
  }
  const index = createAssetIndex([...options.files.keys(), ...(!interactive && game !== undefined && !("file" in game.main) ? [mainFile] : [])]);
  const bundled = new Map<AssetKey, Uint8Array>();
  for (const [path, bytes] of options.bundled) bundled.set(assetKey(path), bytes);
  const gameIdentity = interactive
    ? options.gameIdentity
    : derivePackageIdentity([...files].map(([path, bytes]) => ({ path, bytes })));
  const mainBytes = files.get(assetKey(mainFile));
  if (mainBytes === undefined) throw new Error(`runner-web: main file ${mainFile} is absent`);
  const gameId = deriveGameId(mainBytes, gameIdentity);
  const spriteRuntime = interactive ? createSpriteRuntime() : undefined;
  let hasPlayer = false;
  let cameraPosition: { x: number; y: number } | null = null;
  let latest: GameState | null = null;
  const phaseRegistrations = interactive
    ? [
      inputPhaseRegistration({ pixelStep: 8 }),
      movementPhaseRegistration(),
      { phase: "audio" as const, rank: 0, run: (state: GameState) => { latest = state; } },
    ]
    : [{ phase: "audio" as const, run: (state: GameState) => { latest = state; } }];
  const engine = createEngine({
    seed: plan?.seed ?? 0,
    assetIndex: index,
    assetRoot: PACKAGE_ROOT,
    mainFile,
    gameIdentity,
    startup: {
      presence: { hasPlayer: () => spriteRuntime === undefined ? hasPlayer : spriteRuntime.hasPlayer() },
      savedGame: { load: () => ({ kind: "missing" }), restored: () => false },
    },
    width: plan?.width ?? 640,
    height: plan?.height ?? 480,
    maxTicks: plan?.maxTicks ?? Number.MAX_SAFE_INTEGER,
    include: { shading: true, images: true, sprites: true },
    bundled,
    cameraTarget: {
      getPlayerPosition: () => {
        if (interactive && latest !== null) {
          const actor = latest.sprites.players.find((player) => player.id === latest?.sprites.selectedPlayer) ?? latest.sprites.players.find((player) => player.controlled);
          if (actor !== undefined) return { x: actor.x, y: actor.y };
        }
        return cameraPosition;
      },
      getEntityPosition: () => null,
    },
    ...(interactive ? {
      input: { bindings: { keys: { Enter: "ENTER", ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", KeyW: "up", KeyS: "down", KeyA: "left", KeyD: "right" } } },
      resetRegistrations: [inputResetRegistration()],
    } : {}),
    ...(spriteRuntime === undefined ? {} : { spriteRuntime }),
    phaseRegistrations,
    effectAppliers: interactive ? [] : [
      {
        section: "sprites",
        applier(effect) {
          if (effect.name === "createplayer") hasPlayer = true;
          if (effect.name === "placeplayer") {
            const [x, y, , unit] = effect.args as [number, number, number, string];
            cameraPosition = unit === "tile" ? { x: (x - 1) * 32 + 16, y: (y - 1) * 32 + 31 } : { x, y };
          }
        },
      },
      { section: "triggers", applier: () => undefined },
      { section: "audio", applier: () => undefined },
    ],
  });
  const renderer = createWebgl2Renderer(options.gl, { mode: "letterbox", scale: 1 });
  const textures = textureProvider(options.files);
  const fonts = fontProvider(options.bundled);
  let currentTick = 0;
  let currentStateHash = "";
  let closed = false;
  let processing: Promise<void> = Promise.resolve();

  const hostReply = async (request: RunnerRequest, tick: number): Promise<InputRecord | null> => {
    switch (request.kind) {
      case "asset": return { tick, event: { kind: "asset", reqId: request.reqId, bytes: files.get(request.key) ?? null } };
      case "playVideo": return { tick, event: { kind: "video.ended", reqId: request.reqId } };
      case "loadBlob": {
        const prefix = `${gameId}/`;
        const relative = request.blob.path.startsWith(prefix) ? request.blob.path.slice(prefix.length) : request.blob.path;
        let bytes: Uint8Array | null = null;
        try { bytes = await options.blobs?.read(request.blob.area, gameId, relative) ?? null; } catch { bytes = null; }
        return { tick, event: { kind: "blob.loaded", reqId: request.reqId, bytes } };
      }
      case "saveBlob": {
        const prefix = `${gameId}/`;
        const relative = request.blob.path.startsWith(prefix) ? request.blob.path.slice(prefix.length) : request.blob.path;
        let ok = false;
        try { ok = await options.blobs?.write(request.blob.area, gameId, relative, request.bytes) ?? false; } catch { ok = false; }
        return { tick, event: { kind: "blob.saved", reqId: request.reqId, ok } };
      }
      case "listBlobs": {
        let names: readonly string[] = [];
        try { names = await options.blobs?.list?.(request.area, gameId) ?? []; } catch { names = []; }
        return { tick, event: { kind: "blob.listed", reqId: request.reqId, names } };
      }
      case "extension.call": return { tick, event: { kind: "extension.result", reqId: request.reqId, result: null } };
      case "quit": case "openUrl": case "prefetch": return null;
    }
  };

  const pump = async (initialTicks: number, initialInputs: readonly InputRecord[]): Promise<void> => {
    let ticks = initialTicks;
    let inputs = [...initialInputs];
    for (let guard = 0; guard < 10_000 && !closed; guard += 1) {
      const report = engine.advance(ticks, inputs);
      ticks = Math.max(0, ticks - report.ticksRun);
      inputs = [];
      currentTick = report.tickAfter;
      currentStateHash = report.stateHash;
      const replies: InputRecord[] = [];
      for (const request of report.requests) {
        const reply = await hostReply(request, report.tickAfter);
        if (reply !== null) replies.push(reply);
      }
      if (report.loading || replies.length > 0) { inputs = replies; continue; }
      if (ticks > 0 && report.ticksRun > 0) continue;
      return;
    }
    if (!closed) throw new Error("runner-web: live engine request loop did not settle");
  };
  const queue = (ticks: number, inputs: readonly InputRecord[] = []): Promise<void> => {
    processing = processing.then(() => pump(ticks, inputs));
    return processing;
  };
  void queue(0);
  return {
    engine,
    gameId,
    close() { closed = true; renderer.dispose(); },
    tick: () => currentTick,
    stateHash: () => currentStateHash,
    viewSize: () => {
      const board = latest?.world.board;
      if (board !== null && board !== undefined) return { width: board.width, height: board.height };
      const view = engine.drawList(0, { shading: true, images: true, sprites: true });
      return { width: view.width, height: view.height };
    },
    playerPosition: () => {
      const actor = latest?.sprites.players.find((player) => player.id === latest?.sprites.selectedPlayer)
        ?? latest?.sprites.players.find((player) => player.controlled)
        ?? latest?.sprites.players[0];
      return actor === undefined ? null : { x: actor.x, y: actor.y };
    },
    async advance(ticks, inputs = []) { await queue(ticks, inputs); },
    draw(alpha) {
      const list: DrawList = engine.drawList(alpha, { shading: true, images: true, sprites: true });
      const render = renderer.render(list, {
        textures,
        surfaces: (id: SurfaceId, rev: number) => {
          const pixels = engine.surfacePixels(id, rev);
          return pixels === null ? null : { w: pixels.w, h: pixels.h, rgba: pixels.rgba };
        },
        fonts: (asset: AssetKey) => fonts.get(asset),
        ...(fonts.get(DEFAULT_FONT_ASSET) === undefined ? {} : { fallbackFont: fonts.get(DEFAULT_FONT_ASSET) }),
      });
      return { drawHash: hashDrawList(list), commands: list.commands.length, render };
    },
  };
}
