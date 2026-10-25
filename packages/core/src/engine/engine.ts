import { hashDrawList } from "../canon/index.ts";
import { actorEmitterKey, actorId } from "../actors/model.ts";
import { updateActorStats, type ActorTransition } from "../actors/rules.ts";
import { queueActorTransition, registerActorObject } from "../actors/object.ts";
import { resolveAsset, assetKey, resolveTileReference } from "../formats/resolver/resolver.ts";
import { classifyImageReference } from "../formats/animation/image-reference.ts";
import { decodeTexture, type DecodedTexture } from "../formats/image/index.ts";
import { expandSingleTileToRgba, readSingleTile } from "../formats/single-tile/index.ts";
import { expandTileToRgba, readTileset, tileDimensions } from "../formats/tileset/index.ts";
import { BinaryReader } from "../formats/binary/reader.ts";
import { readCharacter } from "../formats/actor/character.ts";
import { readItem } from "../formats/actor/item.ts";
import type { Character, Item } from "../formats/actor/model.ts";
import { readMainFile } from "../formats/main-file/reader.ts";
import type { MainFile } from "../formats/main-file/model.ts";
import { readLegacyFont } from "../formats/font/reader.ts";
import { gateTrueType } from "../formats/font/truetype.ts";
import type { AssetIndex, AssetRoot } from "../formats/resolver/model.ts";
import type { DrawList, Rgb, Tint } from "../ports/draw.ts";
import type { InputRecord } from "../ports/input.ts";
import type { Engine, Diagnostic, Breakpoint, DrawListInclude, ResumeMode, SurfacePixels } from "../ports/engine.ts";
import type { InputConfig } from "../input/input.ts";
import type { PlainData } from "../ports/plain-data.ts";
import type { Value } from "../ports/value.ts";
import type { RunnerRequest } from "../ports/requests.ts";
import type { StartupPorts } from "../ports/startup.ts";
import type { AssetKey, SurfaceId } from "../ports/keys.ts";
import { createGameState, type GameState, type SectionKey } from "../save/state.ts";
import { applyMenuStateEffect, createMenuOwnerPorts } from "../menu/index.ts";
import { createShopSessionRuntime } from "./shop-session.ts";
import { hashGameState } from "../save/hash.ts";
import { assembleAudioDecoders, decodeAudioInfo } from "../audio/info.ts";
import { createAudioRuntime } from "../audio/runtime.ts";
import { createMediaScriptService, mediaVoiceRef } from "../audio/script.ts";
import { mediaEventsActive, queueAudioEvent, MEDIA_EMITTER } from "../audio/events.ts";
import type { AudioInfo } from "../formats/audio/model.ts";
import type { AssetDecoder } from "../formats/registry/decoder.ts";
import { BUILTIN_TRACKS, MAX_VOICES } from "../audio/model.ts";
import type { Logger } from "../ports/logger.ts";
import { composeBoard, type BoardBlit, type SpriteDraw } from "../render/compose.ts";
import { composeUi, composeUiCursor } from "../render/ui.ts";
import { applyFxDrawList, advanceFx, applyFxEffect } from "../render/fx.ts";
import { advanceAnimations, loadAnimation } from "../render/animation.ts";
import { hydrateBoard } from "../world/hydrate.ts";
import { coordLayout, tileToPixel } from "../world/coords.ts";
import { boardEmitterKey, type WorldBoard } from "../world/model.ts";
import type { FxSection } from "../save/sections.ts";
import { applyInputEvent, createInputSection, inputView, processGamepadEvents, pruneClaimed } from "../input/index.ts";
import { applyWorldEffect, expireProgramTileEdits } from "../world/effects.ts";
import { applyCameraEffect, createCameraSection, initCameraForBoard, positionAt, realignCamera, updateCamera } from "../world/camera.ts";
import { applyInputEffect, applySpriteEffect } from "../script/packs/world.ts";
import type { CameraPoint, CameraTarget } from "../ports/camera.ts";
import type { SpriteActor, Facing } from "../sprites/model.ts";
import { resetSpritesSection, placeSelectedPlayer, selectActor as selectPartyActor, removeActorSprite, type SpriteRuntime } from "../sprites/runtime.ts";
import { boardCollisionAt } from "../sprites/movement.ts";
import { resetTriggersSection } from "../triggers/model.ts";
import { applyTriggerEffect } from "../triggers/runtime.ts";
import { clearPathfindingCache } from "../sprites/pathfinding.ts";
import { runRandomEncounterPhase } from "../sprites/encounters.ts";
import { EffectBus, type EffectApplier, type PostEffect } from "./effects.ts";
import { engineEffect, pluginManifestFor, privateFontKeys, programKeys, resolveManifestPlugins } from "./boot.ts";
import type { EnginePhase, EngineRequestKind, EngineSection } from "../save/sections/engine.ts";
import { collectStateGarbage, runEngineCancelableEvent, runEngineCancelableEventOutcome, runEventsPhase } from "../events/dispatch.ts";
import { deferUnregisterEmitter, queueNativeEvent, registerEmitter, unregisterEmitter } from "../events/emitter.ts";
import {
  COMPILER_VERSION,
  createScriptServices,
  defaultWaitPoll,
  drainDiagnostics,
  ENGINE_DEFAULT_MANIFEST,
  endBoardThreads,
  endItemThreads,
  fileProgramRef,
  runPackageStartup,
  runThreadsPhase,
  runWaitsPhase,
  layerRoots,
  withOwner,
  ScriptError,
  toDiagnostic,
  replyToRequest,
  startProgram,
  startThread,
  STEP_BUDGET,
  stepThread,
  applyUiEffect,
  type EffectRecord,
  type ProgramLoader,
  type ProgramRef,
  type ResolvedPlugin,
  type ScriptServices,
  createVmState,
} from "../script/index.ts";
import type { Thread } from "../script/state.ts";
import type { PackageCatalogueEntry } from "../script/plugin.ts";
import { DEFAULT_FONT } from "../script/packs/ui.ts";
import type { WaitView } from "../ports/wait.ts";
import { runTimePhase } from "../time/time.ts";
import { blitTexture, rasterize, readSurfacePixels, replaceSurface, surfaceTextures, createSurfacesSection, type RasterAsset, type SurfacePixelCache } from "../raster/index.ts";

/** AD-26's immutable phase order. */
export const ENGINE_PHASES = [
  "input",
  "waits",
  "threads",
  "events",
  "movement",
  "edges",
  "triggers",
  "battle",
  "animation",
  "audio",
  "time",
] as const satisfies readonly EnginePhase[];

// Compile-time exhaustiveness: the saved `EnginePhase` union (the `engine` section's `phase`) and this list are
// one set, so a phase added to one must be added to the other.
type _MissingPhases = Exclude<EnginePhase, (typeof ENGINE_PHASES)[number]>;
const _phasesAreExhaustive: [_MissingPhases] extends [never] ? true : never = true;
void _phasesAreExhaustive;

export type { EnginePhase };

export type EnginePhaseRegistration = {
  readonly phase: EnginePhase;
  readonly rank?: number;
  readonly run: (state: GameState, postEffect?: (section: SectionKey, effect: PostEffect) => void) => void;
};

/** A section owner reset callback (E-06; docs/spec/engine/main-loop-and-startup.md#reawakened-reset-sections). */
export type EngineResetRegistration = {
  readonly section: SectionKey;
  readonly rank?: number;
  readonly reset: (state: GameState) => void;
};
/** Optional E-05 overlays supplied by the runner, never enabled implicitly in goldens. */
export type DebugOverlayConfig = {
  readonly fps?: number;
  readonly drawVectorsFlags?: number;
  readonly pathColor?: Rgb;
  readonly path?: readonly { readonly x: number; readonly y: number }[];
  readonly destination?: { readonly x: number; readonly y: number };
};

type EngineCommonInit = {
  /** Observation-only, outside state; ADR 0010. Rebound with services on boot/reset. */
  readonly scriptObservers?: import("../script/observers.ts").ScriptObservers;
  readonly seed: number;
  readonly assetIndex: AssetIndex;
  readonly assetRoot: AssetRoot;
  readonly width: number;
  readonly height: number;
  readonly maxTicks: number;
  /** Resolved plugin layers; when absent boot builds them from the main file (E-02 step 3). */
  readonly plugins?: readonly ResolvedPlugin[];
  /** Host-resolved package catalogue; it supplies definitions and program references, never file access. */
  readonly packageCatalogue?: readonly PackageCatalogueEntry[];
  readonly resetRegistrations?: readonly EngineResetRegistration[];
  readonly phaseRegistrations?: readonly EnginePhaseRegistration[];
  readonly effectAppliers?: readonly { readonly section: SectionKey; readonly applier: EffectApplier }[];
  readonly cameraTarget?: CameraTarget;
  readonly spriteRuntime?: SpriteRuntime;
  /** The author's default SoundFont (docs/spec/engine/audio-media.md#soundfont-layers rank 3); `null` or absent for none. */
  readonly defaultSoundFont?: AssetKey | null;
  readonly input?: InputConfig;
  readonly include?: DrawListInclude;
  /** Decoded image assets supplied by a host or deterministic scene runner. */
  readonly assets?: ReadonlyMap<AssetKey, DecodedTexture>;
  /** Files the host ships with the engine under `media/` (the default bitmap font, bundled TrueType fonts and cursor images), as bytes like every other asset. */
  readonly bundled?: ReadonlyMap<AssetKey, Uint8Array>;
  /** Additional scene/editor image commands, kept as draw-list data. */
  readonly blits?: readonly BoardBlit[];
  /** Sprites composed over the board until the sprites section feeds the compositor (movement-triggers owns that). */
  readonly sprites?: readonly SpriteDraw[];
  /** Script ambient summed with the board ambient once per tile blit (E-17). */
  readonly globalAmbient?: Tint;
  readonly debug?: DebugOverlayConfig;
};

/**
 * Scene mode: load one board and optionally run one program, with no start-up
 * sequence. The tracer bullet, the golden scenes and the editor previews use it.
 */
export type SceneInit = EngineCommonInit & {
  readonly initialBoard: string;
  readonly program?: string | ProgramRef;
  readonly mainFile?: never;
  readonly startup?: never;
};

/**
 * Boot mode: run E-02 from the main file at the index path `mainFile`
 * (docs/spec/engine/main-loop-and-startup.md#reawakened-boot-sequence).
 */
export type BootInit = EngineCommonInit & {
  readonly mainFile: string;
  readonly startup: StartupPorts;
  readonly initialBoard?: never;
  readonly program?: never;
};

export type EngineInit = SceneInit | BootInit;
type RequestEntry = { readonly reqId: number; readonly key: AssetKey; readonly kind: EngineRequestKind };
type SourceLocation = { file: string; line: number };
type Paused = { thread: number; frame: number; line: number };
type Arrival = { readonly x: number; readonly y: number; readonly layer: number; readonly unit: "pixel" | "tile" };

const DEFAULT_ENGINE_PLUGINS: readonly ResolvedPlugin[] = resolveManifestPlugins(ENGINE_DEFAULT_MANIFEST).plugins;
const SCRIPT_REQUEST_BASE = 0x40000000;

/** Create the deterministic fixed-tick engine; host assets arrive only as AD-14 replies. */
const DEFAULT_GAME_AUDIO_SETTINGS = {
  tracks: BUILTIN_TRACKS.map(([name, voiceCount]) => ({ name, voiceCount })),
  voiceCap: MAX_VOICES,
};
export function createEngine(init: EngineInit): Engine {
  const index = init.assetIndex;
  const state: GameState = createGameState({ seed: init.seed });
  state.input = createInputSection(init.input);
  state.engine = { claims: [] };
  const defaultFontAsset = assetKey(DEFAULT_FONT);
  let root: AssetRoot = init.assetRoot;
  let mainFile: MainFile | null = null;
  let loader: ProgramLoader | null = null;
  let sceneBoardKey: AssetKey | null = null;
  let mainKey: AssetKey | null = null;
  const installedFonts = new Map<AssetKey, Uint8Array>();
  const cache = new Map<AssetKey, Uint8Array>();
  const inventoryItemDefinitions = new Map<AssetKey, Item>();
  const inventoryCharacterDefinitions = new Map<AssetKey, Character>();
  const decodedImages = new Map<AssetKey, DecodedTexture>();
  const decodedTiles = new Map<AssetKey, DecodedTexture>();
  const decodedBundled = new Map<AssetKey, RasterAsset | null>();
  const pending = new Map<number, RequestEntry>();
  const pendingImageEffects: Array<{ readonly key: AssetKey; readonly effect: EffectRecord }> = [];
  const pendingBoardPreviews: Array<{ readonly key: AssetKey; readonly effect: EffectRecord }> = [];
  const queuedInputs: InputRecord[] = [];
  const requestsOut: RunnerRequest[] = [];
  const diagnostics: Diagnostic[] = [];
  const registrations = [...(init.phaseRegistrations ?? [])].sort((left, right) => (left.rank ?? 0) - (right.rank ?? 0));
  const registrationByPhase = new Map<EnginePhase, EnginePhaseRegistration[]>();
  for (const registration of registrations) {
    const list = registrationByPhase.get(registration.phase) ?? [];
    list.push(registration);
    registrationByPhase.set(registration.phase, list);
  }
  const bus = new EffectBus(state, (diagnostic) => diagnostics.push(diagnostic));

  const shopSession = createShopSessionRuntime(() => state.vm.threads);
  const menuOwners = createMenuOwnerPorts(
    state,
    (event) => {
      if (event.type === "memberRemoved" && !state.actors.actors.some((actor) => actor.id === event.detail.actorId)) {
        removeActorSprite(state.sprites, actorId(event.detail.actorId));
        if (init.spriteRuntime !== undefined && init.spriteRuntime.section !== state.sprites) init.spriteRuntime.removeActor(actorId(event.detail.actorId));
      }
      if (event.type === "activeMemberChanged") {
        selectPartyActor(state.sprites, event.detail.currentActorId === null ? null : actorId(event.detail.currentActorId));
        if (init.spriteRuntime !== undefined && init.spriteRuntime.section !== state.sprites) {
          init.spriteRuntime.selectActor(event.detail.currentActorId === null ? null : actorId(event.detail.currentActorId));
        }
      }
      registerEmitter(state.vm, state.events, "party");
      queueNativeEvent(state.vm, state.events, "party", event.type, event.detail);
    },
    {
      item(source) {
        const resolved = resolveAsset(index, root, "items", source);
        if (!resolved.ok) return undefined;
        const cached = inventoryItemDefinitions.get(resolved.value);
        if (cached !== undefined) return cached;
        const bytes = cache.get(resolved.value);
        if (bytes === undefined) return undefined;
        const parsed = readItem(new BinaryReader(bytes));
        if (!parsed.ok) return undefined;
        inventoryItemDefinitions.set(resolved.value, parsed.value);
        return parsed.value;
      },
      character(source) {
        const resolved = resolveAsset(index, root, "characters", source);
        if (!resolved.ok) return undefined;
        const cached = inventoryCharacterDefinitions.get(resolved.value);
        if (cached !== undefined) return cached;
        const bytes = cache.get(resolved.value);
        if (bytes === undefined) return undefined;
        const parsed = readCharacter(new BinaryReader(bytes));
        if (!parsed.ok) return undefined;
        inventoryCharacterDefinitions.set(resolved.value, parsed.value);
        return parsed.value;
      },
      applyEquipment(actorId, equipped, catalog) {
        return services.actors.applyEquipment(actorId, equipped, catalog) !== null;
      },
      shopStock: () => shopSession.stock(),
      setShopStock: shopSession.setStock,
      closeShop: shopSession.close,
    },
    (event) => {
      registerEmitter(state.vm, state.events, "inventory");
      queueNativeEvent(state.vm, state.events, "inventory", event.type, event.detail);
    },
    () => {
      const candidate = {
        ...state.actors,
        actors: state.actors.actors.map((actor) => ({
          ...actor,
          stats: { ...actor.stats },
          equipment: { ...actor.equipment, equipped: [...actor.equipment.equipped], bonuses: { ...actor.equipment.bonuses } },
          statuses: { ...actor.statuses },
        })),
      };
      const transitions: ActorTransition[] = [];
      try {
        for (const id of state.party.members) {
          const actor = candidate.actors.find((entry) => entry.id === id && entry.kind === "party");
          if (actor === undefined) return { ok: false, error: { path: "party.inn", message: "party member actor is unavailable" } };
          const result = updateActorStats(candidate, id, { hp: actor.stats.maxHp, smp: actor.stats.maxSmp }, {
            cause: "script",
            hooks: services.actors.hooks(id),
          });
          if (result === null) return { ok: false, error: { path: "party.inn", message: "actor restoration was refused" } };
          transitions.push(...result.transitions);
        }
      } catch {
        return { ok: false, error: { path: "party.inn", message: "actor restoration was refused" } };
      }
      state.actors.actors = candidate.actors;
      for (const transition of transitions) queueActorTransition(state.vm, state.events, state.actors, transition);
      return { ok: true, error: null };
    },
  );
  for (const section of ["party", "inventory", "menu"] as const) {
    bus.register(section, (effect) => applyMenuStateEffect(menuOwners, effect));
  }
  // The script-facing media owner (MEDIA-1): starts post through the one bus so
  // the audio applier stays the only start route; `bind` fills the returned voice.
  const media = createMediaScriptService(
    state,
    (name, args) => bus.postEffect("audio", engineEffect("audio", name, args, "draw-audio-cue")),
    (code, op, detail) => {
      const file = detail["file"];
      const text = Object.entries(detail).map(([key, value]) => `${key}=${String(value)}`).join(" ");
      diagnostics.push({ code, file: typeof file === "string" ? file : "", line: 0, message: `${op}: ${code} ${text}`.trimEnd() });
    },
  );
  bus.register("world", (effect) => applyWorldEffect(state, effect));
  bus.register("camera", (effect) => applyCameraEffect(state, effect));
  bus.register("ui", (effect) => applyUiEffect(state, effect.name, effect.args));
  bus.register("fx", (effect) => applyFxEffect(state, effect));
  bus.register("surfaces", (effect) => applySurfaceEffect(effect));
  bus.register("engine", (effect) => applyEngineEffect(effect));
  bus.register("input", (effect) => {
    const values = effect.args as readonly Value[]; // Script effects use the VM Value subset.
    applyInputEffect(state, effect.name, values);
  });
  bus.register("sprites", (effect) => {
    const values = effect.args as readonly Value[]; // Script effects use the VM Value subset.
    if (effect.name === "__party_addplayer_asset" || effect.name === "__party_newplyr_asset") {
      const file = typeof effect.args[0] === "string" ? effect.args[0] : "";
      const hex = typeof effect.args[1] === "string" ? effect.args[1] : "";
      const bytes = new Uint8Array(hex.length / 2);
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
      const character = readCharacter(new BinaryReader(bytes));
      if (!character.ok) return;
      applySpriteEffect(state, effect.name, [file, character.value] as unknown as readonly Value[]);
      const runtime = init.spriteRuntime;
      const board = state.world.board;
      if (runtime === undefined || runtime.section === state.sprites || board === null || board === undefined) return;
      if (effect.name === "__party_addplayer_asset") {
        const member = state.actors.actors.find((actor) => actor.kind === "party" && actor.source === file);
        const sprite = member === undefined ? undefined : state.sprites.players.find((player) => player.actorId === member.id);
        if (member !== undefined && sprite !== undefined && !runtime.section.players.some((player) => player.actorId === member.id)) {
          runtime.createPlayer(board, {
            id: sprite.id, actorId: member.id, kind: "player", source: file,
            x: sprite.x, y: sprite.y, layer: sprite.layer,
            controlled: state.party.selected === member.id,
            character: character.value,
          });
        }
      } else if (state.party.selected !== null) {
        runtime.changePlayerGraphics(actorId(state.party.selected), file, character.value);
      }
      return;
    }
    applySpriteEffect(state, effect.name, values);
  });
  bus.register("triggers", (effect) => applyTriggerEffect(state, effect));
  // The audio callback runs during an originating engine phase; services are
  // initialized below before any phase can post an engine-originated start.
  let services!: ScriptServices;
  // The audio track engine owns `state.audio`: it applies the `audio` effects and asks for a file's bytes only to
  // learn its length (docs/spec/engine/audio-media.md#audio-core-pins), then drops them.
  let audioDecoders: readonly AssetDecoder[] = [];
  const audioInfo = new Map<AssetKey, AudioInfo | null>();
  const decoderLogger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (record) => void diagnostics.push({ code: record.code, file: "", line: 0, message: record.message }),
    error: (record) => void diagnostics.push({ code: record.code, file: "", line: 0, message: record.message }),
  };
  // Scene mode has no game file, so a host may supply the author default directly. Boot mode
  // takes it from the main file's audio-settings block and ignores this start-up value.
  let defaultSoundFont = init.mainFile === undefined ? init.defaultSoundFont ?? null : null;
  let mainFileAudioNeedsApply = init.mainFile !== undefined;
  if (defaultSoundFont !== null && !index.byKey.has(defaultSoundFont)) {
    diagnostics.push({ code: "media.soundfont-missing", file: defaultSoundFont, line: 0, message: `default SoundFont "${defaultSoundFont}" is not in the asset index` });
    defaultSoundFont = null;
  }
  const audio = createAudioRuntime(state, {
    lookup: (key) => {
      const info = audioInfo.get(key);
      return info === undefined ? { kind: "pending" } : info === null ? { kind: "unsupported" } : { kind: "known", lengthTicks: info.lengthTicks };
    },
    need: (key) => request(key, "audio"),
    defaultSoundFont,
    bindVoice: (handle, result) => media.bind(handle, result),
    engineBeforePlay: (detail) => runEngineCancelableEventOutcome(state, services, MEDIA_EMITTER, "beforePlay", detail, STEP_BUDGET),
    transition: (event) => queueAudioEvent(state, event),
    transitionsActive: () => mediaEventsActive(state),
    notify: (note) => {
      if (note.kind !== "diag") return;
      const file = note.detail.file;
      const detail = Object.entries(note.detail).map(([name, value]) => `${name}=${String(value)}`).join(" ");
      diagnostics.push({ code: note.code, file: typeof file === "string" ? file : "", line: 0, message: `${note.op}: ${note.code} ${detail}`.trimEnd() });
    },
  });
  let audioRegistered = false;
  function registerAudio(): void {
    if (audioRegistered) return;
    audioRegistered = true;
    audio.register(bus);
    // Keep the host's explicit section override last, just as in scene mode.
    for (const registration of init.effectAppliers ?? []) {
      if (registration.section === "audio") bus.register("audio", registration.applier);
    }
  }
  // Boot mode registers after the main file supplies the game's audio settings; scene mode has none.
  if (init.mainFile === undefined) registerAudio();
  for (const registration of init.effectAppliers ?? []) {
    if (registration.section !== "audio") bus.register(registration.section, registration.applier);
  }
  let nextRequestId = 1;
  let failed = false;
  let quitRequested = false;
  let breakpoints: readonly Breakpoint[] = [];
  state.surfaces = createSurfacesSection(init.width, init.height);
  state.camera = createCameraSection(init.width, init.height);
  const surfaceCache: SurfacePixelCache = new Map();
  let frameHash = hashDrawList({ tick: 0, width: init.width, height: init.height, commands: [] });
  // Presentation inputs are plain draw-list data; decoded textures remain runner-owned (AD-29).
  const presentation = {
    ...(init.assets === undefined ? {} : { assets: init.assets }),
    ...(init.blits === undefined ? {} : { blits: init.blits }),
    ...(init.sprites === undefined ? {} : { sprites: init.sprites }),
    ...(init.globalAmbient === undefined ? {} : { globalAmbient: init.globalAmbient }),
  };
  if (init.mainFile === undefined) {
    const resolved = resolveAsset(index, root, "boards", init.initialBoard);
    if (resolved.ok) sceneBoardKey = resolved.value;
    else diagnostics.push({ code: "asset.invalid", file: init.initialBoard, line: 0, message: resolved.error.message });
  } else {
    const found = index.byKey.get(assetKey(init.mainFile));
    if (found === undefined) {
      diagnostics.push({ code: "asset.invalid", file: init.mainFile, line: 0, message: `main file "${init.mainFile}" is not in the asset index` });
      failed = true;
      state.engine.boot = { stage: "stopped", main: "", fonts: [] };
    } else {
      mainKey = found;
      state.engine.boot = { stage: "main", main: found, fonts: [] };
    }
  }
  let activePlugins: readonly ResolvedPlugin[] = init.plugins ?? DEFAULT_ENGINE_PLUGINS;
  const packageStartupLifecycle = { active: false, packageName: undefined as string | undefined };
  let startupServicesReady = false;
  function makeServices(
    plugins: readonly ResolvedPlugin[],
    programLoader?: ProgramLoader,
    runStartups = true,
  ): ScriptServices {
    const listenersBeforeStartup = [...state.events.listeners];
    audioDecoders = assembleAudioDecoders(plugins.map((plugin) => plugin.definition), decoderLogger);
    const nextServices = createScriptServices(
      state,
      plugins,
      undefined,
      undefined,
      programLoader,
      "engine",
      (section, effect) => bus.dispatchRecorded(section, effect),
      (request) => {
        if (request.kind === "asset" && (request.area === "characters" || request.area === "items") &&
            typeof request.path === "string" && typeof request.reqId === "number" &&
            Number.isSafeInteger(request.reqId) && request.reqId > 0 && request.reqId < SCRIPT_REQUEST_BASE) {
          const area = request.area;
          const resolved = resolveAsset(index, root, area, request.path);
          const folder = area === "items" ? "item" : "characters";
          const key = resolved.ok ? resolved.value : assetKey(`${folder}/${request.path}`);
          const reqId = SCRIPT_REQUEST_BASE + request.reqId;
          pending.set(reqId, { reqId, key, kind: area === "items" ? "script-item" : "script-character" });
          requestsOut.push({ kind: "asset", reqId, key });
          return;
        }
        if (request.kind !== "playVideo" || typeof request.key !== "string" || (request.presentation !== "full" && request.presentation !== "small") || typeof request.reqId !== "number") return;
        state.engine.video = { reqId: request.reqId, key: request.key as AssetKey, presentation: request.presentation, ended: false };
        requestsOut.push({ kind: "playVideo", reqId: request.reqId, key: request.key as AssetKey, presentation: request.presentation });
      },
      undefined,
      undefined,
      packageStartupLifecycle,
      media,
      init.scriptObservers,
      menuOwners,
    );
    media.activateDeclared();
    if (runStartups) {
      nextServices.setPackageStartup(true);
      try {
        runPackageStartup(
          state,
          nextServices,
          plugins.flatMap((plugin) => plugin.startup === undefined ? [] : [withOwner(plugin.startup, plugin.package?.name ?? plugin.definition.id)]),
          plugins,
          listenersBeforeStartup,
        );
      } catch (error) {
        if (!(error instanceof ScriptError)) throw error;
        fail(toDiagnostic(error));
      } finally {
        nextServices.setPackageStartup(false);
      }
    }
    startupServicesReady = runStartups;
    return nextServices;
  }
  services = init.mainFile === undefined
    ? makeServices(activePlugins, undefined, true)
    : makeServices([], undefined, false);
  if (init.mainFile === undefined && !failed && init.program !== undefined) {
    const ref: ProgramRef = typeof init.program === "string"
      ? { kind: "inline", text: init.program, compiler: COMPILER_VERSION, dialect: "tk3" }
      : init.program;
    startProgram(state.vm, ref);
  }

  function request(key: AssetKey, kind: RequestEntry["kind"]): void {
    for (const item of pending.values()) if (item.key === key) return;
    if (cache.has(key)) return;
    const entry: RequestEntry = { reqId: nextRequestId++, key, kind };
    pending.set(entry.reqId, entry);
    requestsOut.push({ kind: "asset", reqId: entry.reqId, key });
  }
  const IMAGE_EFFECTS: Record<string, true> = {
    bitmap: true,
    setimage: true,
    setimagetransparent: true,
    setimagetranslucent: true,
    setimageadditive: true,
  };
  function imageTexture(key: AssetKey): DecodedTexture | null {
    const cached = decodedImages.get(key);
    if (cached !== undefined) return cached;
    const bytes = cache.get(key);
    if (bytes === undefined) return null;
    const decoded = decodeTexture(bytes, key);
    if (!decoded.ok) {
      diagnostics.push({ code: "asset.invalid", file: key, line: decoded.error.offset, message: decoded.error.message });
      failed = true;
      return null;
    }
    decodedImages.set(key, decoded.value);
    return decoded.value;
  }
  function tileTexture(key: AssetKey): DecodedTexture | null {
    const cached = decodedTiles.get(key);
    if (cached !== undefined) return cached;
    const bytes = cache.get(key);
    if (bytes === undefined) return null;
    const lower = key.toLowerCase();
    if (lower.endsWith(".gph")) {
      const parsed = readSingleTile(bytes, key);
      if (!parsed.ok) {
        diagnostics.push({ code: "asset.invalid", file: key, line: parsed.error.offset, message: parsed.error.message });
        failed = true;
        return null;
      }
      const rgba = expandSingleTileToRgba(parsed.value, "row-major");
      if (!rgba.ok) return null;
      const texture = { w: parsed.value.width, h: parsed.value.height, rgba: rgba.value };
      decodedTiles.set(key, texture);
      return texture;
    }
    if (!lower.endsWith(".tst") && !lower.endsWith(".iso")) return null;
    const parsed = readTileset(bytes, key);
    if (!parsed.ok) {
      diagnostics.push({ code: "asset.invalid", file: key, line: parsed.error.offset, message: parsed.error.message });
      failed = true;
      return null;
    }
    const native = tileDimensions(parsed.value.detail);
    const scale = parsed.value.detail.size === 16 ? 2 : 1;
    const width = native.width * scale;
    const height = native.height * scale;
    const rgba = new Uint8Array(width * parsed.value.tiles.length * height * 4);
    for (let tile = 0; tile < parsed.value.tiles.length; tile += 1) {
      const expanded = expandTileToRgba(parsed.value, tile);
      if (!expanded.ok) return null;
      for (let x = 0; x < native.width; x += 1) {
        for (let y = 0; y < native.height; y += 1) {
          const source = (x * native.height + y) * 4;
          for (let dx = 0; dx < scale; dx += 1) {
            for (let dy = 0; dy < scale; dy += 1) {
              const targetX = tile * width + x * scale + dx;
              const targetY = y * scale + dy;
              const target = (targetY * width * parsed.value.tiles.length + targetX) * 4;
              rgba[target] = expanded.value[source] ?? 0;
              rgba[target + 1] = expanded.value[source + 1] ?? 0;
              rgba[target + 2] = expanded.value[source + 2] ?? 0;
              rgba[target + 3] = expanded.value[source + 3] ?? 0;
            }
          }
        }
      }
    }
    const texture = { w: width * parsed.value.tiles.length, h: height, rgba };
    decodedTiles.set(key, texture);
    return texture;
  }
  function imageAsset(file: unknown): AssetKey | null {
    if (typeof file !== "string" || file === "") return null;
    const resolved = resolveAsset(index, root, "bitmaps", file);
    return resolved.ok ? resolved.value : null;
  }
  function imageDiagnostic(file: unknown, message: string): void {
    const located = typeof file === "string" && file !== "" ? file : "<image>";
    diagnostics.push({ code: "asset.missing", file: located, line: 0, message });
    failed = true;
    if (state.engine.boot !== undefined) state.engine.boot.stage = "stopped";
  }
  function applySurfaceImage(effect: EffectRecord, texture: DecodedTexture): void {
    const args = effect.args;
    let destination = 0 as SurfaceId;
    let x = 0;
    let y = 0;
    let width: number | undefined;
    let height: number | undefined;
    let keyColour: { readonly r: number; readonly g: number; readonly b: number } | undefined;
    let alpha = 255;
    let additive = false;
    if (effect.name === "bitmap") {
      destination = typeof args[1] === "number" ? args[1] as SurfaceId : destination;
      const size = state.surfaces.entries[String(destination)]?.bitmap;
      width = size?.w;
      height = size?.h;
    } else {
      x = typeof args[1] === "number" ? args[1] : 0;
      y = typeof args[2] === "number" ? args[2] : 0;
      width = typeof args[3] === "number" ? args[3] : undefined;
      height = typeof args[4] === "number" ? args[4] : undefined;
      const destinationIndex = effect.name === "setimagetransparent" ? 8 : effect.name === "setimageadditive" ? 6 : 5;
      destination = typeof args[destinationIndex] === "number" ? args[destinationIndex] as SurfaceId : destination;
      if (effect.name === "setimagetransparent") keyColour = {
        r: typeof args[5] === "number" ? args[5] : 0,
        g: typeof args[6] === "number" ? args[6] : 0,
        b: typeof args[7] === "number" ? args[7] : 0,
      };
      if (effect.name === "setimagetranslucent") alpha = 128;
      if (effect.name === "setimageadditive") {
        const percent = typeof args[5] === "number" ? Math.max(0, Math.min(100, Math.trunc(args[5]))) : 0;
        alpha = Math.trunc(percent * 255 / 100);
        additive = true;
      }
    }
    if (width === undefined || height === undefined) {
      imageDiagnostic(args[0], `${effect.name}: image dimensions are invalid`);
      return;
    }
    if (!blitTexture(state.surfaces, texture, destination, x, y, width, height, keyColour, alpha, additive)) {
      imageDiagnostic(args[0], `${effect.name}: destination surface is not live`);
    }
  }
  function applySurfaceEffect(effect: EffectRecord): void {
    if (!IMAGE_EFFECTS[effect.name]) {
      if (effect.name === "viewbrd") {
        const key = typeof effect.args[0] === "string" ? resolveAsset(index, root, "boards", effect.args[0]) : null;
        if (key === null || !key.ok) {
          imageDiagnostic(effect.args[0], `viewbrd: board "${String(effect.args[0] ?? "")}" is not in the asset index`);
          return;
        }
        pendingBoardPreviews.push({ key: key.value, effect });
        request(key.value, "board-preview");
      }
      return;
    }
    const key = imageAsset(effect.args[0]);
    if (key === null) {
      imageDiagnostic(effect.args[0], `${effect.name}: image is not in the asset index`);
      return;
    }
    const texture = imageTexture(key);
    if (texture === null) {
      pendingImageEffects.push({ key, effect });
      request(key, "image");
      return;
    }
    applySurfaceImage(effect, texture);
  }
  function syncEngineState(): void {
    const next: EngineSection = {
      nextRequestId,
      pending: Array.from(pending.values(), (entry) => ({ reqId: entry.reqId, key: entry.key, kind: entry.kind })),
      failed,
      claims: state.engine.claims ?? [],
      ...(state.engine.phase === undefined ? {} : { phase: state.engine.phase }),
      ...(state.engine.video === undefined ? {} : { video: state.engine.video }),
    };
    if (state.engine.openTick !== undefined) next.openTick = state.engine.openTick;
    if (state.engine.pendingEffects !== undefined) next.pendingEffects = state.engine.pendingEffects;
    if (state.engine.effectDropped !== undefined) next.effectDropped = state.engine.effectDropped;
    if (state.engine.effectDiagnostics !== undefined) next.effectDiagnostics = state.engine.effectDiagnostics;
    if (state.engine.boot !== undefined) next.boot = state.engine.boot;
    if (state.engine.transition !== undefined) next.transition = state.engine.transition;
    state.engine = next;
  }
  /** Learn an audio file's length from its reply and drop the bytes; no bytes, or bytes no decoder accepts, is an unknown length. */
  function rememberAudio(key: AssetKey, bytes: Uint8Array | null): void {
    if (bytes === null) {
      diagnostics.push({ code: "asset.missing", file: key, line: 0, message: `asset not found: ${key}` });
      audioInfo.set(key, null);
      return;
    }
    audioInfo.set(key, decodeAudioInfo(audioDecoders, bytes, key, { index, root }));
  }
  function consumeAsset(record: InputRecord, consumed: InputRecord[]): void {
    if (record.event.kind !== "asset") return;
    const entry = pending.get(record.event.reqId);
    if (entry === undefined) return;
    pending.delete(entry.reqId);
    consumed.push(record);
    if (entry.kind === "script-character" || entry.kind === "script-item") {
      if (record.event.bytes === null) {
        replyToRequest(state.vm, entry.reqId - SCRIPT_REQUEST_BASE, { ok: false, value: "" });
      } else {
        let hex = "";
        for (const byte of record.event.bytes) hex += byte.toString(16).padStart(2, "0");
        cache.set(entry.key, new Uint8Array(record.event.bytes));
        replyToRequest(state.vm, entry.reqId - SCRIPT_REQUEST_BASE, { ok: true, value: hex });
      }
      return;
    }
    if (entry.kind === "audio") {
      rememberAudio(entry.key, record.event.bytes);
      audio.retry();
      return;
    }
    if (record.event.bytes === null) {
      diagnostics.push({ code: "asset.missing", file: entry.key, line: 0, message: `asset not found: ${entry.key}` });
      failed = true;
      pendingImageEffects.splice(0, pendingImageEffects.length, ...pendingImageEffects.filter((item) => item.key !== entry.key));
      pendingBoardPreviews.splice(0, pendingBoardPreviews.length, ...pendingBoardPreviews.filter((item) => item.key !== entry.key));
      if (state.engine.boot !== undefined) state.engine.boot.stage = "stopped";
      return;
    }
    cache.set(entry.key, new Uint8Array(record.event.bytes));
    if (entry.kind === "image") {
      imageTexture(entry.key);
      const waiting = pendingImageEffects.filter((item) => item.key === entry.key);
      pendingImageEffects.splice(0, pendingImageEffects.length, ...pendingImageEffects.filter((item) => item.key !== entry.key));
      const texture = decodedImages.get(entry.key);
      if (texture !== undefined) for (const item of waiting) applySurfaceImage(item.effect, texture);
    } else if (entry.kind === "tile") {
      tileTexture(entry.key);
    }
  }
  function bundledAsset(key: AssetKey, bytes: Uint8Array): RasterAsset | null {
    const lower = key.toLowerCase();
    if (lower.endsWith(".ttf")) return bytes;
    if (lower.endsWith(".fnt")) {
      const parsed = readLegacyFont(bytes, key);
      if (parsed.ok) return parsed.value;
      diagnostics.push({ code: "asset.invalid", file: key, line: parsed.error.offset, message: parsed.error.message });
      return null;
    }
    if (lower.endsWith(".png")) {
      const decoded = decodeTexture(bytes, key);
      if (decoded.ok) return decoded.value;
      diagnostics.push({ code: "asset.invalid", file: key, line: decoded.error.offset, message: decoded.error.message });
      return null;
    }
    return null;
  }
  function rasterAssets(): ReadonlyMap<AssetKey, RasterAsset> {
    for (const key of cache.keys()) {
      if (isBitmapKey(key)) imageTexture(key);
      else {
        const lower = key.toLowerCase();
        if (lower.endsWith(".tst") || lower.endsWith(".iso") || lower.endsWith(".gph")) tileTexture(key);
      }
    }
    const assets = new Map<AssetKey, RasterAsset>();
    for (const [key, bytes] of init.bundled ?? []) {
      if (!decodedBundled.has(key)) decodedBundled.set(key, bundledAsset(key, bytes));
      const asset = decodedBundled.get(key);
      if (asset !== undefined && asset !== null) assets.set(key, asset);
    }
    for (const [key, bytes] of installedFonts) assets.set(key, bytes);
    for (const [key, texture] of decodedImages) assets.set(key, texture);
    for (const [key, texture] of decodedTiles) assets.set(key, texture);
    return assets;
  }
  function decodedAssets(): ReadonlyMap<AssetKey, DecodedTexture> {
    const assets = new Map<AssetKey, DecodedTexture>();
    for (const [key, texture] of decodedImages) assets.set(key, texture);
    for (const [key, texture] of decodedTiles) assets.set(key, texture);
    return assets;
  }
  function isBitmapKey(key: AssetKey): boolean {
    const lower = key.toLowerCase();
    return (lower.startsWith("bitmap/") || lower.includes("/bitmap/")) && !lower.endsWith(".tbm") && !lower.endsWith(".tan");
  }
  function requestKindFor(key: AssetKey): EngineRequestKind {
    return isBitmapKey(key) ? "image" : "tile";
  }
  function prepareBoardPreviews(): boolean {
    if (pendingBoardPreviews.length === 0) return true;
    const item = pendingBoardPreviews[0];
    if (item === undefined) return true;
    const bytes = cache.get(item.key);
    if (bytes === undefined) {
      request(item.key, "board-preview");
      return false;
    }
    const hydrated = hydrateBoard(item.key, bytes, index, root, cache, state.time.tick);
    if (hydrated.error !== null || hydrated.value === null) {
      fail({ code: "asset.invalid", file: hydrated.error?.path ?? item.key, line: hydrated.error?.offset ?? 0, message: hydrated.error?.message ?? `cannot load preview board "${item.key}"` });
      pendingBoardPreviews.shift();
      return false;
    }
    if (hydrated.missing !== null) {
      request(hydrated.missing, requestKindFor(hydrated.missing));
      return false;
    }
    for (const dependency of hydrated.value.dependencies) {
      if (isBitmapKey(dependency)) {
        if (imageTexture(dependency) === null) {
          pendingBoardPreviews.shift();
          return false;
        }
      } else {
        const lower = dependency.toLowerCase();
        if ((lower.endsWith(".tst") || lower.endsWith(".iso") || lower.endsWith(".gph")) && tileTexture(dependency) === null) {
          pendingBoardPreviews.shift();
          return false;
        }
      }
    }
    const args = item.effect.args;
    const destination = typeof args[3] === "number" ? args[3] as SurfaceId : 0 as SurfaceId;
    const destinationSize = state.surfaces.entries[String(destination)]?.bitmap;
    if (destinationSize === undefined) {
      imageDiagnostic(args[0], `viewbrd: destination surface ${String(destination)} is not live`);
      pendingBoardPreviews.shift();
      return false;
    }
    const list = composeBoard({
      board: hydrated.value.board,
      tick: state.time.tick,
      camera: { x: 0, y: 0 },
      viewport: { width: destinationSize.w, height: destinationSize.h },
      alpha: 0,
      include: { shading: true, images: true, sprites: false },
      assets: decodedAssets(),
    });
    const rendered = rasterize(list, rasterAssets());
    if (rendered.error !== null) {
      fail({ code: "asset.invalid", file: item.key, line: 0, message: `viewbrd: ${rendered.error}` });
      pendingBoardPreviews.shift();
      return false;
    }
    const x = typeof args[1] === "number" ? args[1] : 0;
    const y = typeof args[2] === "number" ? args[2] : 0;
    blitTexture(state.surfaces, { w: rendered.width, h: rendered.height, rgba: rendered.rgba }, destination, x, y);
    pendingBoardPreviews.shift();
    return true;
  }

  /** `send` posts its request here; the engine swaps boards between ticks (E-19). A later send replaces an earlier one. */
  function applyEngineEffect(effect: EffectRecord): void {
    const [, second] = effect.args;
    if (effect.name === "send") {
      const [board, x, y, layer] = effect.args;
      if (typeof board === "string" && typeof x === "number" && typeof y === "number" && typeof layer === "number") state.engine.transition = { board, x, y, layer };
      return;
    }
    if (effect.name === "reset") {
      resetLifecycle();
      return;
    }
    if (effect.name === "mainFile" && typeof second === "string") {
      resetLifecycle(second);
      return;
    }
    if (effect.name === "quit" && !quitRequested) {
      quitRequested = true;
      requestsOut.push({ kind: "quit", reqId: nextRequestId++ });
    }
  }
  function resetLifecycle(nextMain?: string): void {
    const rng = state.rng;
    const time = state.time;
    const fresh = createGameState({ seed: 0 });
    state.world = fresh.world;
    state.sprites = fresh.sprites;
    state.actors = fresh.actors;
    state.party = fresh.party;
    state.inventory = fresh.inventory;
    state.triggers = fresh.triggers;
    state.vm = createVmState();
    state.events = fresh.events;
    state.battle = fresh.battle;
    state.menu = fresh.menu;
    state.input = createInputSection(init.input);
    state.ui = fresh.ui;
    state.camera = createCameraSection(init.width, init.height);
    state.fx = fresh.fx;
    state.surfaces = createSurfacesSection(init.width, init.height);
    state.rng = rng;
    state.time = time;
    shopSession.reset();
    pending.clear();
    pendingImageEffects.length = 0;
    pendingBoardPreviews.length = 0;
    queuedInputs.length = 0;
    installedFonts.clear();
    decodedImages.clear();
    decodedTiles.clear();
    failed = false;
    quitRequested = false;
    state.engine = mainKey === null ? { claims: [] } : { claims: [], boot: { stage: "assets", main: mainKey, fonts: [] } };
    for (const registration of [...(init.resetRegistrations ?? [])].sort((left, right) => (left.rank ?? 0) - (right.rank ?? 0))) registration.reset(state);
    if (init.spriteRuntime !== undefined) resetSpritesSection(init.spriteRuntime.section);
    if (nextMain !== undefined) {
      const found = index.byKey.get(assetKey(nextMain));
      if (found === undefined) {
        failed = true;
        state.engine.boot = { stage: "stopped", main: "", fonts: [] };
        diagnostics.push({ code: "asset.invalid", file: nextMain, line: 0, message: `main file "${nextMain}" is not in the asset index` });
      } else {
        mainKey = found;
        mainFileAudioNeedsApply = true;
        state.engine.boot = { stage: "main", main: found, fonts: [] };
      }
    }
    if (nextMain !== undefined) {
      startupServicesReady = false;
      services = makeServices([], loader ?? undefined, false);
    } else {
      services = makeServices(activePlugins, loader ?? undefined, true);
    }
    audio.retry();
  }
  function fail(diagnostic: Diagnostic): void {
    diagnostics.push(diagnostic);
    failed = true;
    if (state.engine.boot !== undefined) state.engine.boot.stage = "stopped";
  }
  function blockingAlive(): boolean {
    return state.vm.threads.some((thread) => thread.kind === "blocking" && thread.status !== "finished");
  }

  /** Hydrate board `key`, requesting its file and then each missing tile asset in turn. */
  function loadBoard(key: AssetKey): "pending" | WorldBoard | null {
    const bytes = cache.get(key);
    if (bytes === undefined) {
      request(key, "board");
      return "pending";
    }
    const result = hydrateBoard(key, bytes, index, root, cache, state.time.tick);
    if (result.error !== null) {
      fail({ code: "asset.invalid", file: result.error.path, line: result.error.offset, message: result.error.message });
      return null;
    }
    if (result.missing !== null) {
      request(result.missing, requestKindFor(result.missing));
      return "pending";
    }
    const board = result.value?.board ?? null;
    if (board === null) failed = true;
    return board;
  }

  /**
   * Compile `name` from the fetched sources and start it as a thread. A missing,
   * pre-compiled or syntactically wrong program is a located diagnostic and no
   * thread, never a throw out of `advance`.
   */
  function startFileProgram(name: string, owner: string, kind: "board" | "blocking"): void {
    if (loader === null) return;
    try {
      const ref = fileProgramRef(loader, name);
      services.programs.get(ref);
      startThread(state.vm, { ref, kind, owner: kind === "blocking" ? "script" : "world" });
    } catch (error) {
      if (!(error instanceof ScriptError)) throw error;
      diagnostics.push({ code: error.code, file: error.pos?.file ?? owner, line: error.pos?.line ?? 0, message: error.message });
    }
  }
  /**
   * Board entry always posts one `music.play` carrying the resolved key, or `null` for an empty or missing name; the
   * audio applier decides same-file carry-on, replacement and silence (docs/spec/engine/audio-media.md#board-effect-mapping,
   * Q5 to Q8). A missing file is silence, not an error (Q6).
   */
  function postBoardMusic(board: WorldBoard): void {
    const name = board.backgroundMusic ?? "";
    const music = name === "" ? null : resolveAsset(index, root, "media", name);
    const asset = music !== null && music.ok ? music.value : null;
    bus.postEffect("audio", engineEffect("audio", "music.play", [asset, true, null, board.key], "draw-audio-cue"));
  }
  /** The player's position when a sprites owner supplies one, else the arrival point converted by the board's own layout (E-11). */
  function cameraAim(board: WorldBoard, arrival: Arrival): CameraPoint {
    const player = (init.cameraTarget ?? init.spriteRuntime)?.getPlayerPosition() ?? null;
    if (player !== null) return player;
    if (arrival.unit === "pixel") return { x: arrival.x, y: arrival.y };
    return tileToPixel(coordLayout(board.coordType), board.sizeX, arrival.x, arrival.y);
  }
  /** Compute R-53's continuous opposite-edge arrival without changing the source board. */
  function edgeArrival(player: SpriteActor, direction: Facing, board: WorldBoard): Arrival | null {
    const points = player.collisionBase.points;
    if (points.length === 0) return null;
    let left = points[0]!.x;
    let top = points[0]!.y;
    let right = left;
    let bottom = top;
    for (let index = 1; index < points.length; index += 1) {
      const point = points[index]!;
      if (point.x < left) left = point.x;
      if (point.x > right) right = point.x;
      if (point.y < top) top = point.y;
      if (point.y > bottom) bottom = point.y;
    }
    const minX = -left;
    const maxX = board.width - right;
    const minY = -top;
    const maxY = board.height - bottom;
    let x: number;
    let y: number;
    if (direction === "E" || direction === "W") {
      x = direction === "E" ? minX : maxX;
      y = Math.max(minY, Math.min(maxY, player.y));
    } else {
      y = direction === "S" ? minY : maxY;
      x = Math.max(minX, Math.min(maxX, player.x));
    }
    if (boardCollisionAt(player, board, x, y) !== null) return null;
    return { x, y, layer: player.layer, unit: "pixel" };
  }

  function clearPendingExit(playerId: string): void {
    state.sprites.players = state.sprites.players.map((actor) => actor.id === playerId
      ? { ...actor, movement: { ...actor.movement, pendingExit: null } }
      : actor);
  }

  function stopOldBoardThreads(): void {
    endBoardThreads(state.vm);
    for (const item of state.sprites.items) {
      const source = item.handle === null ? item.id : `item:${item.source}`;
      endItemThreads(state.vm, source);
    }
  }

  /** Emit the board lifecycle notification on the shared queued bus. */
  function boardLifecycle(type: "entered" | "left", board: WorldBoard, player: SpriteActor | undefined): number {
    const actor = state.actors.actors.find((candidate) => candidate.kind === "party") ?? state.actors.actors[0];
    const detail = {
      actorid: actor?.id ?? null,
      boardkey: board.key,
    };
    const boardEvent = queueNativeEvent(state.vm, state.events, boardEmitterKey(board.key), type, detail);
    if (actor !== undefined) {
      registerActorObject(state.vm, state.events, state.actors, actor.id);
      queueNativeEvent(state.vm, state.events, actorEmitterKey(actor.id), type, detail);
    }
    return boardEvent;
  }

  /** Board entry (E-19, E-47; docs/spec/engine/main-loop-and-startup.md#reawakened-board-entry). */
  function arrive(board: WorldBoard, arrival: Arrival, fromSend: boolean): void {
    const previous = state.world.board;
    const player = state.sprites.players.find((candidate) => candidate.id === state.sprites.selectedPlayer) ?? state.sprites.players[0];
    if (fromSend) stopOldBoardThreads();
    if (previous !== undefined && previous !== null && previous.key !== board.key) {
      const leftEvent = boardLifecycle("left", previous, player);
      deferUnregisterEmitter(state.events, boardEmitterKey(previous.key), leftEvent);
    }
    registerEmitter(state.vm, state.events, boardEmitterKey(board.key));
    clearPathfindingCache();
    state.world = { board };
    resetTriggersSection(state.triggers);
    state.triggers.boardKey = board.key;
    const placement: PlainData[] = [arrival.x, arrival.y, arrival.layer, arrival.unit];
    placeSelectedPlayer(state.sprites, arrival.x, arrival.y, arrival.layer, arrival.unit);
    bus.postEffect("sprites", engineEffect("sprites", "placeplayer", placement));
    state.camera = realignCamera(state.camera, board, cameraAim(board, arrival));
    bus.postEffect("triggers", engineEffect("triggers", "deactivateat", placement));
    postBoardMusic(board);
    boardLifecycle("entered", board, player);
    // An empty list is stored as one empty string and empty entries are ignored (docs/spec/formats/board.md#threads-constants-and-settings).
    for (const name of board.threads ?? []) if (name !== "") startFileProgram(name, board.key, "board");
    if (board.enterPrg !== undefined && board.enterPrg !== "") startFileProgram(board.enterPrg, board.key, blockingAlive() ? "board" : "blocking");
  }

  /** Resolve the selected player's pending edge exit during AD-26's edges phase. */
  function runEdgesPhase(): void {
    const board = state.world.board;
    const player = state.sprites.players.find((actor) => actor.id === state.sprites.selectedPlayer) ?? state.sprites.players[0];
    const direction = player?.movement.pendingExit;
    if (board === null || board === undefined || player === undefined || direction === null || direction === undefined) return;
    const edge = direction === "N" ? "north" : direction === "S" ? "south" : direction === "E" ? "east" : direction === "W" ? "west" : null;
    const link = edge === null ? "" : board.links?.[edge] ?? "";
    if (link === "") {
      clearPendingExit(player.id);
      return;
    }
    if (link.toLowerCase().endsWith(".prg")) {
      clearPendingExit(player.id);
      startFileProgram(link, board.key, "blocking");
      return;
    }
    const target = resolveAsset(index, root, "boards", link);
    if (!target.ok) {
      clearPendingExit(player.id);
      diagnostics.push({ code: "asset.missing", file: link, line: 0, message: `edge link board "${link}" is not in the asset index` });
      return;
    }
    const loaded = loadBoard(target.value);
    if (loaded === "pending") return;
    if (loaded === null) {
      clearPendingExit(player.id);
      return;
    }
    const arrival = edgeArrival(player, direction, loaded);
    if (arrival === null) {
      clearPendingExit(player.id);
      return;
    }
    registerEmitter(state.vm, state.events, boardEmitterKey(loaded.key));
    const actor = state.actors.actors.find((candidate) => candidate.kind === "party") ?? state.actors.actors[0];
    const allowed = runEngineCancelableEvent(
      state,
      services,
      boardEmitterKey(loaded.key),
      "beforeEnter",
      { actorid: actor?.id ?? null, boardkey: loaded.key, entry: { x: arrival.x, y: arrival.y, layer: arrival.layer, unit: arrival.unit } },
      STEP_BUDGET,
    );
    if (!allowed) {
      clearPendingExit(player.id);
      // A canceled entry leaves the target board available for another attempt; preserve
      // its package/script listeners rather than treating it as an unloaded board.
      return;
    }
    clearPendingExit(player.id);
    arrive(loaded, arrival, true);
  }

  /** E-02 step 9's tail: the main file's `initBoard` entered at the board's start position. */
  function bootBoardKey(main: MainFile): AssetKey | null {
    if (main.initBoard === "") {
      fail({ code: "startup.no-board", file: mainKey ?? "", line: 0, message: "the main file names no initBoard" });
      return null;
    }
    const resolved = resolveAsset(index, root, "boards", main.initBoard);
    if (!resolved.ok) {
      fail({ code: "asset.missing", file: mainKey ?? "", line: 0, message: `initBoard "${main.initBoard}" is not in the asset index` });
      return null;
    }
    return resolved.value;
  }
  /**
   * Apply package-owned track metadata after game-file settings and before the
   * audio applier registers (docs/spec/engine/audio-media.md#media-4).
   */
  function applyPackageAudioTracks(plugins: readonly ResolvedPlugin[]): void {
    const report = (packageName: string, index: number, reason: string): void => {
      diagnostics.push({
        code: "media.package-track",
        file: mainKey ?? "",
        line: 0,
        message: `package "${packageName}" audioTracks[${index}] rejected: ${reason} (docs/spec/engine/audio-media.md#media-4)`,
      });
    };
    for (const plugin of plugins) {
      const packageMetadata = plugin.package;
      if (packageMetadata === undefined) continue;
      const declarations: unknown = plugin.definition.audioTracks;
      if (declarations === undefined) continue;
      if (!Array.isArray(declarations)) {
        report(packageMetadata.name, 0, "audioTracks must be an array");
        continue;
      }
      for (let index = 0; index < declarations.length; index += 1) {
        const declaration: unknown = declarations[index];
        if (typeof declaration !== "object" || declaration === null || Array.isArray(declaration)) {
          report(packageMetadata.name, index, "declaration must be an object");
          continue;
        }
        const record = declaration as { readonly name?: unknown; readonly voiceCount?: unknown };
        const hasVoiceCount = Object.prototype.hasOwnProperty.call(record, "voiceCount");
        const voiceCount = hasVoiceCount ? record.voiceCount : 1;
        if (typeof record.name !== "string" || typeof voiceCount !== "number" || !Number.isInteger(voiceCount) || voiceCount < 1) {
          report(packageMetadata.name, index, "name must be a string and voiceCount must be a positive integer when present");
          continue;
        }
        const problem = audio.configurePackageTrack(record.name, voiceCount);
        if (problem !== null) report(packageMetadata.name, index, problem);
      }
    }
  }

  /**
   * Apply the main file's audio-settings block before the audio applier registers
   * (docs/spec/formats/main-file.md#tkr-audio-settings-extension). An over-cap block keeps the
   * Epic 6 defaults and cap 32, keeps the independent default SoundFont and reports once.
   */
  function applyMainFileAudio(main: MainFile, plugins: readonly ResolvedPlugin[]): void {
    const settings = main.audioSettings;
    if (settings === null) {
      audio.setDefaultSoundFont(null);
      audio.applyGameAudio(DEFAULT_GAME_AUDIO_SETTINGS);
    } else {
      let font: AssetKey | null = null;
      if (settings.defaultSoundFont !== null) {
        const resolved = assetKey(settings.defaultSoundFont);
        if (index.byKey.has(resolved)) {
          font = resolved;
        } else {
          diagnostics.push({
            code: "media.soundfont-missing",
            file: resolved,
            line: 0,
            message: `TKR audio default SoundFont "${settings.defaultSoundFont}" is not in the asset index (docs/spec/formats/main-file.md#tkr-audio-settings-extension)`,
          });
        }
      }
      audio.setDefaultSoundFont(font);
      const applied = audio.applyGameAudio({ tracks: settings.tracks, voiceCap: settings.voiceCap });
      if (!applied.ok) {
        const track = settings.tracks[applied.overflowIndex]!;
        diagnostics.push({
          code: "media.voice-cap",
          file: mainKey ?? "",
          line: applied.overflowIndex,
          message: `TKR audio settings exceed the ${settings.voiceCap}-voice cap at track ${applied.overflowIndex} "${track.name}"; Epic 6 defaults and cap 32 apply (docs/spec/formats/main-file.md#tkr-audio-settings-extension)`,
        });
      }
    }
    applyPackageAudioTracks(plugins);
    registerAudio();
  }

  function startBoot(boot: NonNullable<EngineSection["boot"]>): boolean {
    if (mainKey === null) return false;
    if (boot.stage === "main") {
      const bytes = cache.get(mainKey);
      if (bytes === undefined) {
        request(mainKey, "main");
        return false;
      }
      const parsed = readMainFile(new BinaryReader(bytes, mainKey));
      if (!parsed.ok) {
        fail({ code: "asset.invalid", file: mainKey, line: parsed.error.offset, message: parsed.error.message });
        return false;
      }
      mainFile = parsed.value;
      if (root.kind === "game") root = { kind: "game", projectPath: mainFile.projectPath };
      for (const key of [...privateFontKeys(index, root), ...programKeys(index, root)]) request(key, key.endsWith(".ttf") ? "font" : "program");
      boot.stage = "assets";
      return true;
    }
    if (boot.stage === "assets") {
      if (mainFile === null) return false;
      const fonts = privateFontKeys(index, root);
      const programs = programKeys(index, root);
      if (![...fonts, ...programs].every((key) => cache.has(key))) return false;
      for (const key of fonts) {
        const gated = gateTrueType(cache.get(key) ?? new Uint8Array(), key);
        if (!gated.ok) {
          diagnostics.push({ code: "font.rejected", file: key, line: gated.error.offset, message: gated.error.message });
          continue;
        }
        installedFonts.set(key, cache.get(key) ?? new Uint8Array());
        boot.fonts.push(key);
      }
      const manifest = pluginManifestFor(mainFile, mainKey, init.packageCatalogue ?? []);
      const resolvedPlugins = resolveManifestPlugins(manifest.manifest, mainKey, init.packageCatalogue ?? []);
      diagnostics.push(...manifest.diagnostics, ...resolvedPlugins.diagnostics);
      loader = { index, root, read: (key) => cache.get(key) };
      activePlugins = init.plugins ?? resolvedPlugins.plugins;
      if (mainFileAudioNeedsApply) {
        applyMainFileAudio(mainFile, activePlugins);
        mainFileAudioNeedsApply = false;
      } else {
        registerAudio();
      }
      if (!startupServicesReady) services = makeServices(activePlugins, loader, true);
      if (failed) return false;
      if (mainFile.initChar !== "") {
        const player = resolveAsset(index, root, "characters", mainFile.initChar);
        if (player.ok) bus.postEffect("sprites", engineEffect("sprites", "createplayer", [player.value]));
        else diagnostics.push({ code: "asset.missing", file: mainKey, line: 0, message: `initChar "${mainFile.initChar}" is not in the asset index` });
      }
      if (mainFile.startupPrg !== "") startFileProgram(mainFile.startupPrg, mainKey, "blocking");
      boot.stage = "startup";
      return true;
    }
    return false;
  }
  function stepBoot(boot: NonNullable<EngineSection["boot"]>): boolean {
    if (boot.stage === "main" || boot.stage === "assets") return startBoot(boot);
    if (boot.stage === "startup") {
      if (blockingAlive()) return false;
      const ports = init.startup;
      if (mainFile === null || ports === undefined) return false;
      if (!ports.presence.hasPlayer()) {
        fail({ code: "startup.no-player", file: mainKey ?? "", line: 0, message: "an initial character must be defined" });
        return false;
      }
      if (ports.savedGame.restored()) {
        boot.stage = "running";
        return false;
      }
      boot.stage = "board";
      return true;
    }
    if (boot.stage === "board") {
      if (mainFile === null) return false;
      const key = bootBoardKey(mainFile);
      if (key === null) return false;
      const loaded = loadBoard(key);
      if (loaded === "pending" || loaded === null) return false;
      arrive(loaded, { x: loaded.start?.x ?? 64, y: loaded.start?.y ?? 64, layer: loaded.start?.layer ?? 1, unit: "pixel" }, false);
      boot.stage = "running";
      return true;
    }
    return false;
  }
  function stepTransition(transition: NonNullable<EngineSection["transition"]>): boolean {
    const target = resolveAsset(index, root, "boards", transition.board);
    if (!target.ok) {
      diagnostics.push({ code: "asset.missing", file: transition.board, line: 0, message: `send: board "${transition.board}" is not in the asset index` });
      delete state.engine.transition;
      return true;
    }
    const loaded = loadBoard(target.value);
    if (loaded === "pending" || loaded === null) return false;
    delete state.engine.transition;
    arrive(loaded, { x: transition.x, y: transition.y, layer: transition.layer, unit: "tile" }, true);
    return true;
  }
  function stepScene(): boolean {
    if (sceneBoardKey === null || state.world.board !== undefined && state.world.board !== null) return false;
    const loaded = loadBoard(sceneBoardKey);
    if (loaded === "pending" || loaded === null) return false;
    registerEmitter(state.vm, state.events, boardEmitterKey(loaded.key));
    clearPathfindingCache();
    state.world = { board: loaded };
    state.camera = initCameraForBoard(state.camera, loaded, init.cameraTarget);
    boardLifecycle("entered", loaded, state.sprites.players[0]);
    return true;
  }
  /**
   * Run every engine-owned step that needs no tick (start-up stages, a pending
   * `send`, the scene board) until one waits for a host reply or a tick.
   */
  function drive(): void {
    for (let guard = 0; guard < 64; guard += 1) {
      if (failed || pending.size > 0 || state.engine.openTick !== undefined) return;
      if (pendingBoardPreviews.length > 0 && !prepareBoardPreviews()) return;
      const boot = state.engine.boot;
      const transition = state.engine.transition;
      let progressed: boolean;
      if (boot === undefined) progressed = transition !== undefined ? stepTransition(transition) : stepScene();
      else if (transition !== undefined && boot.stage !== "main" && boot.stage !== "assets") progressed = stepTransition(transition);
      else progressed = stepBoot(boot);
      if (!progressed) return;
    }
  }
  /** Ticks run once nothing is outstanding: a scene needs its board, boot needs the start-up program or the main loop. */
  function canTick(): boolean {
    if (failed || pending.size > 0 || state.engine.transition !== undefined) return false;
    if (state.engine.video !== undefined && !state.engine.video.ended) return false;
    const boot = state.engine.boot;
    if (boot === undefined) return state.world.board !== undefined && state.world.board !== null;
    return boot.stage === "startup" || boot.stage === "running";
  }
  function phaseView(): WaitView {
    return {
      tick: state.time.tick,
      input: inputView(state.input),
      ui: state.ui,
      sprites: [...state.sprites.players, ...state.sprites.items].map((actor) => ({
        id: actor.id,
        stance: actor.visual.stance,
        stanceComplete: actor.visual.stanceComplete,
      })),
      claims: state.engine.claims ?? [],
      audio: state.audio,
      events: state.events,
      shopStock: shopSession.stock(),
      ...(state.engine.pendingEffects?.audio === undefined ? {} : { pendingAudio: state.engine.pendingEffects.audio }),
      mediaStart: (handle: number) => {
        const record = state.vm.objects.find((item) => item.handle === handle);
        return record === undefined ? null : mediaVoiceRef(record);
      },
      ...(state.engine.video === undefined ? {} : { video: { reqId: state.engine.video.reqId, ended: state.engine.video.ended } }),
    };
  }
  function resolveAnimationFile(file: string): AssetKey | null {
    const preferred = file.toLowerCase().endsWith(".gif") ? "bitmaps" : "animations";
    const first = resolveAsset(index, root, preferred, file);
    if (first.ok) return first.value;
    const second = preferred === "bitmaps" ? "animations" : "bitmaps";
    const fallback = resolveAsset(index, root, second, file);
    return fallback.ok ? fallback.value : null;
  }
  function resolveAnimationImage(image: string): { readonly asset: AssetKey; readonly tile: number | null } | null {
    const reference = classifyImageReference(image);
    if (reference.kind === "empty") return null;
    if (reference.kind === "tile") {
      const resolved = resolveAsset(index, root, "tiles", reference.tileset);
      return resolved.ok ? { asset: resolved.value, tile: reference.index } : null;
    }
    if (reference.kind === "singleTile") {
      const resolved = resolveTileReference(index, root, reference.path);
      return resolved.ok && resolved.value.kind === "singleTile" ? { asset: resolved.value.asset, tile: null } : null;
    }
    const resolved = resolveAsset(index, root, "bitmaps", reference.kind === "picture" || reference.kind === "tileBitmap" ? reference.path : image);
    return resolved.ok ? { asset: resolved.value, tile: null } : null;
  }
  function prepareAnimations(): void {
    const animations = (state.fx as Partial<FxSection>).animations ?? [];
    for (const animation of animations) {
      if (animation.loaded || animation.finished) continue;
      const key = animation.asset ?? resolveAnimationFile(animation.file);
      if (key === null) {
        animation.finished = true;
        diagnostics.push({ code: "asset.missing", file: animation.file, line: 0, message: `animation "${animation.file}" is not in the asset index` });
        continue;
      }
      animation.asset = key;
      const bytes = cache.get(key);
      if (bytes === undefined) {
        request(key, "animation");
        continue;
      }
      if (!loadAnimation(state, animation, bytes, resolveAnimationImage)) {
        animation.finished = true;
        diagnostics.push({ code: "asset.invalid", file: key, line: 0, message: `cannot decode animation "${animation.file}"` });
      }
    }
  }
  function runAnimationPhase(): void {
    advanceFx(state);
    prepareAnimations();
    const sounds = advanceAnimations(state);
    for (const sound of sounds) {
      const resolved = resolveAsset(index, root, "media", sound.sound);
      if (!resolved.ok) {
        diagnostics.push({ code: "asset.missing", file: sound.sound, line: 0, message: `animation sound "${sound.sound}" is not in the asset index` });
        continue;
      }
      bus.postEffect("audio", engineEffect("audio", "sfx.play", [resolved.value, false, null, "frame"], "draw-audio-cue"));
    }
  }
  function runPhase(phase: EnginePhase, consumed: InputRecord[]): void {
    state.engine.phase = phase;
    switch (phase) {
      case "input": {
        const records = takeQueuedInputs(state.time.tick);
        for (const record of records) {
          if (record.event.kind === "asset") {
            consumeAsset(record, consumed);
            continue;
          }
          applyInputEvent(state.input, record.event);
          consumed.push(record);
        }
        processGamepadEvents(state.input);
        for (const registration of registrationByPhase.get(phase) ?? []) registration.run(state);
        return;
      }
      case "waits":
        for (const thread of state.vm.threads) {
          if (thread.wait?.kind === "input.key" && thread.wait.parkSeq === undefined) thread.wait.parkSeq = state.input.nextSeq;
        }
        state.engine.claims = [];
        const videoBefore = state.engine.video;
        runWaitsPhase(state.vm, phaseView(), defaultWaitPoll, (seq) => {
          if (!(state.engine.claims ?? []).includes(seq)) (state.engine.claims ??= []).push(seq);
        }, undefined, (wait) => {
          if (wait.kind === "input.key" && wait.dialogue !== undefined) {
            queueNativeEvent(state.vm, state.events, "game", "dialogue.completed", wait.dialogue);
          }
        });
        if (videoBefore?.ended === true && state.engine.video?.reqId === videoBefore.reqId) {
          const music = state.audio.tracks.find((track) => track.name === "music");
          const file = music?.file;
          if (music !== undefined && file !== undefined && file !== null) {
            const voice = music.voices.find((item) => item.index === 0);
            bus.postEffect("audio", engineEffect("audio", "music.play", [file, voice?.loop ?? false, true, "video"], "draw-audio-cue"));
          }
          delete state.engine.video;
        }
        pruneClaimed(state.input, state.engine.claims ?? []);
        return;
      case "threads":
        runThreadsPhase(state.vm, services, STEP_BUDGET);
        expireProgramTileEdits(state);
        return;
      case "events":
        runEventsPhase(state, services, STEP_BUDGET);
        for (const registration of registrationByPhase.get(phase) ?? []) registration.run(state, (section, effect) => bus.postEffect(section, effect));
        return;
      case "time":
        runTimePhase(state.time);
        collectStateGarbage(state, layerRoots(services.layers));
        return;
      case "movement":
        state.camera = updateCamera(state.camera, state.world.board ?? null, init.cameraTarget ?? init.spriteRuntime);
        for (const registration of registrationByPhase.get(phase) ?? []) registration.run(state, (section, effect) => bus.postEffect(section, effect));
        return;
      case "edges":
        runEdgesPhase();
        for (const registration of registrationByPhase.get(phase) ?? []) registration.run(state, (section, effect) => bus.postEffect(section, effect));
        return;
      case "triggers":
        for (const registration of registrationByPhase.get(phase) ?? []) registration.run(state, (section, effect) => bus.postEffect(section, effect));
        return;
      case "battle":
        if (mainFile !== null) {
          runRandomEncounterPhase(state, {
            fightingDisabled: mainFile.fightingDisabled,
            enemies: mainFile.enemies,
            fightType: mainFile.fightType,
            chances: mainFile.chances,
            useCustomFightPrg: mainFile.useCustomFightPrg,
            customFightPrg: mainFile.customFightPrg,
          }, (section, effect) => bus.postEffect(section, effect));
        }
        for (const registration of registrationByPhase.get(phase) ?? []) registration.run(state, (section, effect) => bus.postEffect(section, effect));
        return;
      case "animation":
        runAnimationPhase();
        for (const registration of registrationByPhase.get(phase) ?? []) registration.run(state, (section, effect) => bus.postEffect(section, effect));
        return;
      case "audio":
        audio.phase();
        audio.retry();
        for (const registration of registrationByPhase.get(phase) ?? []) registration.run(state, (section, effect) => bus.postEffect(section, effect));
        return;
      default: {
        const neverPhase: never = phase;
        return neverPhase;
      }
    }
  }
  function takeQueuedInputs(tick: number): InputRecord[] {
    const ready: InputRecord[] = [];
    const deferred: InputRecord[] = [];
    for (const record of queuedInputs) {
      if (record.tick === tick) ready.push(record);
      else deferred.push(record);
    }
    queuedInputs.length = 0;
    queuedInputs.push(...deferred);
    return ready;
  }
  function processPreTickEvents(consumed: InputRecord[]): void {
    const records = takeQueuedInputs(state.time.tick);
    const deferred: InputRecord[] = [];
    for (const record of records) {
      if (record.event.kind === "asset") {
        consumeAsset(record, consumed);
      } else if (record.event.kind === "video.ended") {
        if (state.engine.video?.reqId === record.event.reqId) state.engine.video = { ...state.engine.video, ended: true };
        consumed.push(record);
      } else if (record.event.kind === "focus") {
        applyInputEvent(state.input, record.event);
        consumed.push(record);
      } else {
        deferred.push(record);
      }
    }
    queuedInputs.unshift(...deferred);
  }
  function consumeStoppedInputs(consumed: InputRecord[]): void {
    if (!failed) return;
    const records = takeQueuedInputs(state.time.tick);
    for (const record of records) {
      applyInputEvent(state.input, record.event);
      consumed.push(record);
    }
  }
  function currentDrawList(alpha = 0, include = init.include ?? { shading: false, images: false, sprites: false }): DrawList {
    const spriteInput = init.spriteRuntime?.draws() ?? (presentation.sprites ?? []);
    const board: WorldBoard | null = state.world.board ?? null;
    const camera = positionAt(state.camera, Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 0);
    const debugCommands = (): DrawList["commands"] => {
      const debug = init.debug;
      if (debug === undefined) return [];
      const commands: DrawList["commands"] = [];
      const colour = debug.pathColor ?? { r: 255, g: 255, b: 255 };
      const linePoints = (points: readonly { readonly x: number; readonly y: number }[], rgb: Rgb, closed = false): void => {
        for (let i = 1; i < points.length; i += 1) {
          const a = points[i - 1]!;
          const b = points[i]!;
          commands.push({ kind: "line", x1: Math.round(a.x - camera.x), y1: Math.round(a.y - camera.y), x2: Math.round(b.x - camera.x), y2: Math.round(b.y - camera.y), rgb });
        }
        if (closed && points.length > 2) {
          const a = points[points.length - 1]!;
          const b = points[0]!;
          commands.push({ kind: "line", x1: Math.round(a.x - camera.x), y1: Math.round(a.y - camera.y), x2: Math.round(b.x - camera.x), y2: Math.round(b.y - camera.y), rgb });
        }
      };
      const flags = debug.drawVectorsFlags ?? 0;
      if ((flags & 1) !== 0) for (const vector of board?.vectors ?? []) linePoints(vector.points, colour, vector.closed !== 0);
      if ((flags & 2) !== 0) for (const sprite of spriteInput) if (sprite.collisionBase !== undefined) linePoints(sprite.collisionBase, { r: 255, g: 128, b: 0 }, true);
      if ((flags & 4) !== 0 && debug.path !== undefined) linePoints(debug.path, colour);
      if ((flags & 8) !== 0 && debug.destination !== undefined) {
        const x = Math.round(debug.destination.x - camera.x);
        const y = Math.round(debug.destination.y - camera.y);
        commands.push({ kind: "ellipse", rect: { x: x - 5, y: y - 5, w: 10, h: 10 }, rgb: colour, filled: false });
      }
      if (debug.fps !== undefined) commands.push({ kind: "text", x: 4, y: 4, text: `FPS ${Math.round(debug.fps)}`, font: state.ui.font, rgb: colour, advances: [] });
      return commands;
    };
    const empty = { tick: state.time.tick, width: init.width, height: init.height, commands: [] as DrawList["commands"] };
    const base = board === null
      ? empty
      : composeBoard({
        board,
        tick: state.time.tick,
        camera: positionAt(state.camera, Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 0),
        viewport: { width: init.width, height: init.height },
        alpha: Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 0,
        include,
        assets: decodedAssets(),
        ...presentation,
        sprites: spriteInput,
      });
    const cursorMap = state.ui.activeCursorMap;
    const waitingCursor = cursorMap === undefined
      ? undefined
      : state.vm.threads.find((thread) => thread.wait?.kind === "input.key" && thread.wait.cursorMap === cursorMap);
    const cursorSelection = waitingCursor?.wait?.kind === "input.key" ? waitingCursor.wait.cursorSelection : undefined;
    const withFx = applyFxDrawList(base, state.fx);
    const withUi = { ...withFx, commands: [...withFx.commands, ...debugCommands(), ...composeUi(state.ui, init.width, init.height, state.input, false, cursorSelection)] };
    return { ...withUi, commands: [...withUi.commands, ...composeUiCursor(state.ui, state.input, cursorSelection)] };
  }
  function refreshFrame(): void {
    const list = currentDrawList(0);
    const nextHash = hashDrawList(list);
    if (nextHash === frameHash) return;
    const assets = new Map(rasterAssets());
    // A font the game does not ship (a legacy family name such as "Comic Sans MS") draws in the default bitmap font.
    const fallbackFont = assets.get(defaultFontAsset);
    if (fallbackFont !== undefined) for (const command of list.commands) if (command.kind === "text" && !assets.has(command.font.asset)) assets.set(command.font.asset, fallbackFont);
    const rendered = rasterize(list, assets, surfaceTextures(state.surfaces, surfaceCache));
    // A frame that could not be replayed is reported, never left as a silently blank or partial image.
    if (rendered.error !== null) diagnostics.push({ code: "render.failed", file: state.world.board?.key ?? "", line: 0, message: rendered.error });
    replaceSurface(state.surfaces, 0 as SurfaceId, rendered.width, rendered.height, rendered.rgba);
    frameHash = nextHash;
  }
  function threadLocation(thread: Thread): SourceLocation | null {
    const frame = thread.frames[thread.frames.length - 1];
    if (frame === undefined) return null;
    const program = services.programs.get(frame.program);
    return program.ops[frame.ip]?.pos ?? program.ops[frame.ip - 1]?.pos ?? null;
  }
  function breakpointAt(location: SourceLocation | null): boolean {
    if (location === null) return false;
    return breakpoints.some((breakpoint) => breakpoint.file === location.file && breakpoint.line === location.line);
  }
  function pauseAt(thread: Thread, location: SourceLocation | null): Paused | null {
    if (location === null) return null;
    return { thread: thread.id, frame: Math.max(0, thread.frames.length - 1), line: location.line };
  }
  function beginOpenTick(): void {
    const readyThreads = state.vm.threads
      .filter((thread) => thread.status === "ready")
      .sort((left, right) => left.id - right.id)
      .map((thread) => thread.id);
    state.engine.openTick = { readyThreads, readyIndex: 0, currentThread: readyThreads[0] ?? 0, stepsUsed: 0 };
  }
  function nextOpenThread(): void {
    const cursor = state.engine.openTick;
    if (cursor === undefined) return;
    cursor.readyIndex += 1;
    const next = cursor.readyThreads[cursor.readyIndex];
    if (next === undefined) delete state.engine.openTick;
    else cursor.currentThread = next;
  }
  function runOpenThreads(mode: ResumeMode): Paused | null {
    if (state.engine.openTick === undefined) beginOpenTick();
    const cursor = state.engine.openTick;
    if (cursor === undefined) return null;
    while (state.engine.openTick !== undefined) {
      const active = state.vm.threads.find((thread) => thread.id === cursor.currentThread);
      if (active === undefined || active.status !== "ready") {
        nextOpenThread();
        continue;
      }
      const before = threadLocation(active);
      const suppressed = cursor.skip !== undefined && before !== null && cursor.skip.file === before.file && cursor.skip.line === before.line;
      if (!suppressed && breakpointAt(before)) {
        if (before !== null) cursor.skip = { file: before.file, line: before.line };
        return pauseAt(active, before);
      }
      const steps = stepThread(active, state.vm, services, 1);
      cursor.stepsUsed += steps;
      const after = threadLocation(active);
      if (after === null || before === null || after.file !== before.file || after.line !== before.line) delete cursor.skip;
      else if (before !== null) cursor.skip = { file: before.file, line: before.line };
      if (mode === "step" && steps > 0) {
        const paused = pauseAt(active, after ?? before);
        if (active.status !== "ready") nextOpenThread();
        return paused;
      }
      if (active.status !== "ready") nextOpenThread();
    }
    return null;
  }
  function finishOpenTick(consumed: InputRecord[], mode: ResumeMode): Paused | null {
    const paused = runOpenThreads(mode);
    if (paused !== null || state.engine.openTick !== undefined) return paused;
    for (const phase of ENGINE_PHASES) {
      if (phase !== "input" && phase !== "waits" && phase !== "threads") runPhase(phase, consumed);
    }
    return null;
  }

  const engine: Engine = {
    advance(ticks: number, inputs: readonly InputRecord[], maxTicks?: number, resume: ResumeMode = "continue") {
      requestsOut.length = 0;
      const consumed: InputRecord[] = [];
      const failedAtStart = failed;
      for (const input of inputs) queuedInputs.push(input);
      processPreTickEvents(consumed);
      drive();
      if (failedAtStart) consumeStoppedInputs(consumed);
      const requestedTicks = Number.isFinite(ticks) ? Math.max(0, Math.trunc(ticks)) : 0;
      const cap = maxTicks ?? init.maxTicks;
      const bounded = Math.min(requestedTicks, Math.max(0, Math.trunc(cap)));
      let ticksRun = 0;
      let paused: Paused | null = null;
      while (canTick() && state.input.focused && (state.engine.openTick !== undefined || ticksRun < bounded)) {
        if (state.engine.openTick === undefined) {
          runPhase("input", consumed);
          if (!state.input.focused) break;
          runPhase("waits", consumed);
        }
        if (state.engine.openTick === undefined && breakpoints.length === 0 && resume !== "step") {
          runPhase("threads", consumed);
          for (const phase of ENGINE_PHASES) {
            if (phase !== "input" && phase !== "waits" && phase !== "threads") runPhase(phase, consumed);
          }
        } else {
          paused = finishOpenTick(consumed, resume);
          if (paused !== null) break;
        }
        ticksRun += 1;
        resume = "continue";
        drive();
      }
      syncEngineState();
      const reportDiagnostics = [...diagnostics.splice(0), ...drainDiagnostics(services)];
      return {
        ticksRun,
        tickAfter: state.time.tick,
        consumed,
        audioCues: audio.drain(),
        requests: [...requestsOut],
        diagnostics: reportDiagnostics,
        loading: !failed && pending.size > 0,
        paused,
        stateHash: hashGameState(state),
      };
    },
    drawList(alpha = 0, include: DrawListInclude = { shading: false, images: false, sprites: false }) {
      return currentDrawList(alpha, include);
    },
    surfacePixels(id: SurfaceId, rev: number): SurfacePixels | null {
      if (id === (0 as SurfaceId)) refreshFrame();
      return readSurfacePixels(state.surfaces, id, rev, surfaceCache);
    },
    setBreakpoints(next: readonly Breakpoint[]) { breakpoints = next; },
  };
  return engine;
}
