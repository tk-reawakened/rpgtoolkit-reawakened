import {
  classifyImageReference,
  BinaryReader,
  assetKey,
  compositeTileBitmap,
  decodeGif,
  decodeTexture,
  decodeTileTexture,
  readAnimation,
  readCharacter,
  readItem,
  readTileAnimation,
  readTileBitmap,
  tileBitmapCell,
  writeCharacter,
  writeItem,
  type ActorBase,
  type ActorPoint,
  type ActorStance,
  type Character,
  type Item,
  type TileBitmapTile,
} from "@tk-reawakened/core";
export type { ActorBase, ActorPoint } from "@tk-reawakened/core";
export { classifyImageReference };
import {
  createBinaryDocument,
  openBinaryDocument,
  type DocumentCodec,
  type DocumentSnapshot,
  type DocumentStorage,
  type EditorDocument,
  type OpenResult as GenericOpenResult,
  type ReadOnlyReason,
  type Rejection,
} from "./binary-document.ts";
import type { DocumentIdentity } from "./identity.ts";
/** The two actor asset kinds that use the shared T-52 graphics editor. */
export type SpriteActor = Character | Item;
export type SpriteActorKind = "character" | "item";
export type SpriteGroup = "walk" | "idle" | "battle" | "custom";

export type SpriteCommand =
  | { readonly type: "set-sprite-animation"; readonly group: SpriteGroup; readonly index: number; readonly file: string }
  | { readonly type: "add-custom-stance"; readonly name: string; readonly file: string }
  | { readonly type: "rename-custom-stance"; readonly index: number; readonly name: string }
  | { readonly type: "delete-custom-stance"; readonly index: number }
  | { readonly type: "set-sprite-timing"; readonly speed: number; readonly idleTime: number }
  | { readonly type: "set-sprite-bases"; readonly bases: readonly ActorBase[] };

export interface SpriteDocumentFields {
  readonly actorType: SpriteActorKind;
  readonly actorName: string;
  readonly minor: number;
  readonly movementAnimations: readonly string[];
  readonly idleAnimations: readonly string[];
  readonly battleAnimations: readonly string[];
  readonly customStances: readonly ActorStance[];
  readonly speed: number | null;
  readonly idleTime: number | null;
  readonly vectorBases: readonly ActorBase[] | null;
  readonly graphicsUnavailable: string | null;
}

export type SpriteDocumentSnapshot = DocumentSnapshot<SpriteCommand> & SpriteDocumentFields;
export type SpriteDocument = EditorDocument<SpriteDocumentSnapshot, SpriteCommand>;
export type SpriteOpenResult = GenericOpenResult<SpriteDocument>;

const DIRECTION_COUNT = 8;
const DEFAULT_COLLISION: ActorBase = { points: [{ x: -15, y: -15 }, { x: 15, y: -15 }, { x: 15, y: 0 }, { x: -15, y: 0 }] };
const DEFAULT_ACTIVATION: ActorBase = { points: [{ x: -24, y: -24 }, { x: 24, y: -24 }, { x: 24, y: 8 }, { x: -24, y: 8 }] };
const MIN_COLLISION_POINTS = 3;

function isCharacter(model: SpriteActor): model is Character {
  return model.magic === "RPGTLKIT CHAR";
}

function actorType(model: SpriteActor): SpriteActorKind {
  return isCharacter(model) ? "character" : "item";
}

/** Version gates follow character.md and item.md; never write a newer minor implicitly. */
function supports(model: SpriteActor, command: SpriteCommand): boolean {
  switch (command.type) {
    case "set-sprite-animation":
      if (command.group === "walk") return model.minor >= (actorType(model) === "character" ? 5 : 4);
      if (command.group === "idle") return model.minor >= (actorType(model) === "character" ? 6 : 5);
      if (command.group === "battle") return actorType(model) === "character" && model.minor >= 5;
      return model.minor >= (actorType(model) === "character" ? 5 : 4);
    case "add-custom-stance":
    case "rename-custom-stance":
    case "delete-custom-stance":
      return model.minor >= (actorType(model) === "character" ? 5 : 4);
    case "set-sprite-timing":
      return model.minor >= (actorType(model) === "character" ? 7 : 5);
    case "set-sprite-bases":
      return model.minor >= (actorType(model) === "character" ? 8 : 7);
  }
}

function withGroup(model: SpriteActor, group: SpriteGroup, index: number, file: string): SpriteActor {
  if (group === "walk") {
    const movementAnimations = [...(model.movementAnimations ?? Array(DIRECTION_COUNT).fill(""))];
    movementAnimations[index] = file;
    return { ...model, movementAnimations };
  }
  if (group === "idle") {
    const idleAnimations = [...(model.idleAnimations ?? Array(DIRECTION_COUNT).fill(""))];
    idleAnimations[index] = file;
    return { ...model, idleAnimations };
  }
  if (group === "custom") {
    const customStances = [...(model.customStances ?? [])];
    const old = customStances[index];
    if (old === undefined) return model;
    customStances[index] = { ...old, animation: file };
    return { ...model, customStances };
  }
  if (isCharacter(model)) {
    const battleStances = [...(model.battleStances ?? Array(6).fill(""))];
    battleStances[index] = file;
    return { ...model, battleStances };
  }
  return { ...model, battleAnimation: file };
}

function apply(model: SpriteActor, command: SpriteCommand): SpriteActor {
  if (command.type === "set-sprite-animation") return withGroup(model, command.group, command.index, command.file);
  if (command.type === "add-custom-stance") return { ...model, customStances: [...(model.customStances ?? []), { handle: command.name, animation: command.file }] };
  if (command.type === "rename-custom-stance") {
    const customStances = [...(model.customStances ?? [])];
    const old = customStances[command.index];
    if (old !== undefined) customStances[command.index] = { ...old, handle: command.name };
    return { ...model, customStances };
  }
  if (command.type === "delete-custom-stance") return { ...model, customStances: (model.customStances ?? []).filter((_stance, index) => index !== command.index) };
  if (command.type === "set-sprite-timing") return { ...model, speed: command.speed, idleTime: command.idleTime };
  return { ...model, vectorBases: command.bases.map((base) => ({ points: base.points.map((point) => ({ ...point })) })) };
}

function fieldSnapshot(model: SpriteActor): SpriteDocumentFields {
  const character = isCharacter(model);
  const rawBases = model.vectorBases;
  return {
    actorType: character ? "character" : "item",
    actorName: model.name,
    minor: model.minor,
    movementAnimations: model.movementAnimations ?? Array(DIRECTION_COUNT).fill(""),
    idleAnimations: model.idleAnimations ?? Array(DIRECTION_COUNT).fill(""),
    battleAnimations: character ? (model.battleStances ?? []).slice(0, 5) : [model.battleAnimation],
    customStances: model.customStances ?? [],
    speed: model.speed ?? null,
    idleTime: model.idleTime ?? null,
    vectorBases: rawBases ?? [DEFAULT_COLLISION, DEFAULT_ACTIVATION],
    graphicsUnavailable: model.minor < (character ? 8 : 7) ? `This ${character ? "character" : "item"} file version does not store editable collision and activation bases. The file version is preserved; upgrade it with the format conversion workflow before editing bases.` : null,
  };
}

function isBase(value: unknown): value is ActorBase {
  if (typeof value !== "object" || value === null || !("points" in value) || !Array.isArray(value.points) || value.points.length < MIN_COLLISION_POINTS) return false;
  return value.points.every((point: unknown) =>
    typeof point === "object" && point !== null && "x" in point && "y" in point
    && typeof point.x === "number" && Number.isInteger(point.x)
    && typeof point.y === "number" && Number.isInteger(point.y));
}

function isCommand(value: unknown): value is SpriteCommand {
  if (typeof value !== "object" || value === null || !("type" in value)) return false;
  const record = value as Record<string, unknown>;
  if (record.type === "set-sprite-animation") return ["walk", "idle", "battle", "custom"].includes(String(record.group)) && Number.isInteger(record.index) && typeof record.file === "string";
  if (record.type === "add-custom-stance") return typeof record.name === "string" && record.name.trim() !== "" && typeof record.file === "string";
  if (record.type === "rename-custom-stance") return typeof record.index === "number" && Number.isInteger(record.index) && record.index >= 0 && typeof record.name === "string" && record.name.trim() !== "";
  if (record.type === "delete-custom-stance") return typeof record.index === "number" && Number.isInteger(record.index) && record.index >= 0;
  if (record.type === "set-sprite-timing") return typeof record.speed === "number" && Number.isFinite(record.speed) && record.speed > 0 && typeof record.idleTime === "number" && Number.isFinite(record.idleTime) && record.idleTime >= 0;
  if (record.type === "set-sprite-bases") {
    return Array.isArray(record.bases) && record.bases.length === 2 && record.bases.every((base: unknown) => isBase(base));
  }
  return false;
}

function invalidValue(model: SpriteActor, command: SpriteCommand): string | null {
  if (!supports(model, command)) return `This ${actorType(model)} file version ${model.minor} does not store this graphics field; the editor will not upgrade it on open.`;
  if (command.type === "set-sprite-animation") {
    const max = command.group === "walk" || command.group === "idle" ? 8 : command.group === "battle" ? (actorType(model) === "character" ? 5 : 1) : (model.customStances ?? []).length;
    if (!Number.isInteger(command.index) || command.index < 0 || command.index >= max) return "Choose an existing stance slot.";
    if (command.group === "battle" && actorType(model) === "item") return "Items do not have character battle stances.";
  }
  if (command.type === "rename-custom-stance" || command.type === "delete-custom-stance") {
    if (command.index >= (model.customStances ?? []).length) return "That custom stance no longer exists.";
  }
  if (command.type === "set-sprite-timing" && (command.speed <= 0 || command.idleTime < 0)) return "Speed must be greater than zero and idle delay cannot be negative.";
  if (command.type === "set-sprite-bases") {
    if (command.bases.length !== 2 || command.bases.some((base) => base.points.length < MIN_COLLISION_POINTS)) return "Collision and activation bases each need at least three points.";
    if (command.bases.some((base) => base.points.some((point) => !Number.isInteger(point.x) || !Number.isInteger(point.y) || point.x < -2147483648 || point.x > 2147483647 || point.y < -2147483648 || point.y > 2147483647))) return "Base coordinates must be whole pixels in the signed 32-bit range.";
  }
  return null;
}

function sameStances(left: readonly ActorStance[], right: readonly ActorStance[]): boolean {
  return left.length === right.length && left.every((stance, index) =>
    stance.handle === right[index]?.handle && stance.animation === right[index]?.animation);
}

function sameBases(left: readonly ActorBase[] | undefined, right: readonly ActorBase[] | undefined): boolean {
  return left !== undefined && right !== undefined
    && left.length === right.length
    && left.every((base, baseIndex) => {
      const other = right[baseIndex];
      return other !== undefined && base.points.length === other.points.length
        && base.points.every((point, pointIndex) => {
          const candidate = other.points[pointIndex];
          return candidate !== undefined && point.x === candidate.x && point.y === candidate.y;
        });
    });
}

function commandSurvivedWriteback(actual: SpriteActor, next: SpriteActor, command: SpriteCommand): boolean {
  if (command.type === "set-sprite-animation") {
    const animations = command.group === "walk" ? actual.movementAnimations
      : command.group === "idle" ? actual.idleAnimations
        : command.group === "custom" ? actual.customStances?.map((stance) => stance.animation)
          : isCharacter(actual) ? actual.battleStances : [actual.battleAnimation];
    return animations?.[command.index] === command.file;
  }
  if (command.type === "set-sprite-timing") return actual.speed === next.speed && actual.idleTime === next.idleTime;
  if (command.type === "set-sprite-bases") return sameBases(actual.vectorBases, next.vectorBases);
  return sameStances(actual.customStances ?? [], next.customStances ?? []);
}

function makeCodec(kind: SpriteActorKind): DocumentCodec<SpriteActor, SpriteCommand, SpriteDocumentFields> {
  const read = (bytes: Uint8Array, path: string) => kind === "character" ? readCharacter(new BinaryReader(bytes, path)) : readItem(new BinaryReader(bytes, path));
  const write = (model: SpriteActor) => kind === "character" ? writeCharacter(model as Character) : writeItem(model as Item);
  return {
    kind,
    read,
    write,
    readOnlyReason(model, bytes): ReadOnlyReason | null {
      const encoded = write(model);
      if (!encoded.ok) return { code: "no-same-version-writer", message: encoded.error.message };
      const first = encoded.value.findIndex((byte, index) => bytes[index] !== byte);
      if (first < 0 && encoded.value.length === bytes.length) return null;
      return { code: "no-same-version-writer", message: `The writer does not reproduce this ${kind} file byte for byte; the first difference is at offset ${first < 0 ? Math.min(encoded.value.length, bytes.length) : first}.` };
    },
    isCommand,
    apply,
    label(command) {
      if (command.type === "set-sprite-animation") return `Set ${command.group} animation`;
      if (command.type === "add-custom-stance") return `Add custom stance ${command.name}`;
      if (command.type === "rename-custom-stance") return `Rename custom stance ${command.name}`;
      if (command.type === "delete-custom-stance") return "Delete custom stance";
      if (command.type === "set-sprite-timing") return "Change sprite timing";
      return "Edit collision and activation bases";
    },
    refuse(next, command, previous): Rejection | null {
      const error = invalidValue(previous, command);
      if (error !== null) return { reason: "invalid", message: error };
      const encoded = write(next);
      if (!encoded.ok) return { reason: "invalid", message: encoded.error.message };
      const reread = read(encoded.value, "");
      if (!reread.ok) return { reason: "invalid", message: reread.error.message };
      if (!commandSurvivedWriteback(reread.value, next, command)) return { reason: "invalid", message: "The file writer cannot store that graphics value exactly as entered." };
      return null;
    },
    summary: (model) => `${kind === "character" ? "Character" : "Item"}: ${model.name}`,
    fields: fieldSnapshot,
  };
}

export const characterSpriteCodec = makeCodec("character");
export const itemSpriteCodec = makeCodec("item");

export function openSpriteDocument(kind: SpriteActorKind, storage: DocumentStorage, identity: DocumentIdentity): Promise<SpriteOpenResult> {
  return openBinaryDocument(kind === "character" ? characterSpriteCodec : itemSpriteCodec, storage, identity);
}

export function createSpriteDocument(kind: SpriteActorKind, storage: DocumentStorage, identity: DocumentIdentity, bytes: Uint8Array): SpriteOpenResult {
  return createBinaryDocument(kind === "character" ? characterSpriteCodec : itemSpriteCodec, storage, identity, bytes);
}
/** Read only the polygon pair for cross-sprite import; this never gives a view a save-capable source document. */
export function spriteBasesFromFile(kind: SpriteActorKind, bytes: Uint8Array, path: string): { readonly bases: readonly ActorBase[] | null; readonly unavailable: string | null } | null {
  const parsed = kind === "character" ? readCharacter(new BinaryReader(bytes, path)) : readItem(new BinaryReader(bytes, path));
  if (!parsed.ok) return null;
  const fields = fieldSnapshot(parsed.value);
  return { bases: fields.vectorBases, unavailable: fields.graphicsUnavailable };
}


export interface SpriteAnimationPreview {
  readonly width: number;
  readonly height: number;
  readonly frames: readonly { readonly image: string; readonly transparent: { readonly r: number; readonly g: number; readonly b: number } }[];
  readonly delay: number;
}

export function spriteAnimationPreview(bytes: Uint8Array, path: string): SpriteAnimationPreview | null {
  const animation = readAnimation(new BinaryReader(bytes, path));
  if (!animation.ok) return null;
  return {
    width: animation.value.width,
    height: animation.value.height,
    frames: animation.value.frames.filter((frame) => frame.image !== "").map((frame) => ({ image: frame.image, transparent: frame.transparent })),
    delay: animation.value.delay,
  };
}

export function spriteProjectAssetPath(folder: string, reference: string): string {
  const normal = reference.replaceAll("\\", "/");
  return normal.split("/", 1)[0]?.toLowerCase() === folder.toLowerCase() ? normal : `${folder}/${normal}`;
}

export function spriteTileAnimationFirstFrame(bytes: Uint8Array, path: string): string | null {
  const animation = readTileAnimation(new BinaryReader(bytes, path));
  return animation.ok ? animation.value.frames[0] ?? null : null;
}
export type SpriteAssetLoader = (path: string) => Promise<Uint8Array | null>;

/** Resolve a direct tile, single-tile graphic, or animated tile using project-relative asset paths. */
export async function spriteTileFrameFromReference(
  reference: string,
  load: SpriteAssetLoader,
  depth = 0,
): Promise<SpritePreviewFrame | null> {
  if (depth >= 8) return null;
  if (reference.toLowerCase().endsWith(".tan")) {
    const path = spriteProjectAssetPath("Tiles", reference);
    const bytes = await load(path);
    if (bytes === null) return null;
    const firstFrame = spriteTileAnimationFirstFrame(bytes, path);
    return firstFrame === null ? null : spriteTileFrameFromReference(firstFrame, load, depth + 1);
  }
  const tile = classifyImageReference(reference);
  if (tile.kind === "tile") {
    const path = spriteProjectAssetPath("Tiles", tile.tileset);
    const bytes = await load(path);
    return bytes === null ? null : spriteTilePreview(bytes, path, tile.index);
  }
  if (tile.kind === "singleTile") {
    const path = spriteProjectAssetPath("Tiles", tile.path);
    const bytes = await load(path);
    return bytes === null ? null : spriteTilePreview(bytes, path);
  }
  return null;
}

/** Compose a TBM after resolving its tile refs, including TAN refs, through the shared project asset loader. */
export async function spriteTileBitmapPreviewFromAssets(
  bytes: Uint8Array,
  path: string,
  load: SpriteAssetLoader,
): Promise<SpritePreviewFrame | null> {
  const references = spriteTileBitmapReferences(bytes, path);
  if (references === null) return null;
  const tiles = new Map<string, SpritePreviewFrame>();
  for (const reference of references) {
    const frame = await spriteTileFrameFromReference(reference, load);
    if (frame !== null) tiles.set(reference, frame);
  }
  return spriteTileBitmapPreview(bytes, path, tiles);
}

/** Draw a picture on the ANM canvas; direct tile frames retain their native size and transparency. */
export function spriteAnimationCanvasPreview(
  source: SpritePreviewFrame,
  width: number,
  height: number,
  transparent?: { readonly r: number; readonly g: number; readonly b: number },
  scaleToCanvas = false,
): SpritePreviewFrame {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = scaleToCanvas ? Math.min(source.height - 1, Math.floor(y * source.height / height)) : y;
    if (sourceY < 0 || sourceY >= source.height) continue;
    for (let x = 0; x < width; x += 1) {
      const sourceX = scaleToCanvas ? Math.min(source.width - 1, Math.floor(x * source.width / width)) : x;
      if (sourceX < 0 || sourceX >= source.width) continue;
      const from = (sourceY * source.width + sourceX) * 4;
      const to = (y * width + x) * 4;
      const r = source.rgba[from] ?? 0;
      const g = source.rgba[from + 1] ?? 0;
      const b = source.rgba[from + 2] ?? 0;
      rgba[to] = r;
      rgba[to + 1] = g;
      rgba[to + 2] = b;
      const isKey = transparent !== undefined && r === transparent.r && g === transparent.g && b === transparent.b;
      rgba[to + 3] = isKey ? 0 : source.rgba[from + 3] ?? 0;
    }
  }
  return { width, height, rgba };
}

/** Decode one 1-based .tst/.iso cell or .gph through the core's shared tile renderer. */
export function spriteTilePreview(bytes: Uint8Array, path: string, index = 1): SpritePreviewFrame | null {
  const decoded = decodeTileTexture(assetKey(path), bytes);
  if (!decoded.ok) return null;
  if (path.toLowerCase().endsWith(".gph")) return { width: decoded.texture.w, height: decoded.texture.h, rgba: decoded.texture.rgba };
  const tileWidth = path.toLowerCase().endsWith(".iso") ? decoded.texture.h * 2 : decoded.texture.h;
  if (!Number.isInteger(index) || index < 1 || (index - 1) * tileWidth + tileWidth > decoded.texture.w) return null;
  const rgba = new Uint8Array(tileWidth * decoded.texture.h * 4);
  for (let y = 0; y < decoded.texture.h; y += 1) {
    const from = (y * decoded.texture.w + (index - 1) * tileWidth) * 4;
    rgba.set(decoded.texture.rgba.subarray(from, from + tileWidth * 4), y * tileWidth * 4);
  }
  return { width: tileWidth, height: decoded.texture.h, rgba };
}

/** Names of tile assets required to compose a .tbm animation frame. */
export function spriteTileBitmapReferences(bytes: Uint8Array, path: string): readonly string[] | null {
  const parsed = readTileBitmap(new BinaryReader(bytes, path));
  if (!parsed.ok) return null;
  const references = new Set<string>();
  for (let x = 0; x < Math.max(0, parsed.value.width); x += 1) {
    for (let y = 0; y < Math.max(0, parsed.value.height); y += 1) {
      const cell = tileBitmapCell(parsed.value, x, y);
      if (cell !== undefined && cell.tile !== "") references.add(cell.tile);
    }
  }
  return [...references];
}

/** Compose a .tbm from its resolved tiles using the engine's shared compositor. */
export function spriteTileBitmapPreview(bytes: Uint8Array, path: string, tiles: ReadonlyMap<string, SpritePreviewFrame>): SpritePreviewFrame | null {
  const parsed = readTileBitmap(new BinaryReader(bytes, path));
  if (!parsed.ok) return null;
  const resolved = new Map<string, TileBitmapTile>();
  for (const [reference, frame] of tiles) resolved.set(reference, { w: frame.width, h: frame.height, rgba: frame.rgba });
  const composed = compositeTileBitmap(parsed.value, resolved);
  return composed.ok ? { width: composed.value.w, height: composed.value.h, rgba: composed.value.rgba } : null;
}

/** An already-decoded picture frame for the shared sprite editor preview (AD-28, images.md#the-shared-decode-contract). */
export interface SpritePreviewFrame {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

/** Decode an ordinary picture with the core image provider; no browser-specific image decoder is used. */
export function spritePicturePreview(bytes: Uint8Array, path: string): SpritePreviewFrame | null {
  const image = decodeTexture(bytes, path);
  return image.ok ? { width: image.value.w, height: image.value.h, rgba: image.value.rgba } : null;
}

export interface SpriteGifPreview {
  readonly frames: readonly SpritePreviewFrame[];
  readonly delay: number;
  readonly transparent: { readonly r: number; readonly g: number; readonly b: number };
}

/** Decode every GIF page with the same shared provider used by animation playback (AD-28, images.md#gif). */
export function spriteGifPreview(bytes: Uint8Array, path: string): SpriteGifPreview | null {
  const gif = decodeGif(bytes, path);
  if (!gif.ok || gif.value.frames.length === 0) return null;
  return {
    frames: gif.value.frames.map((frame) => ({ width: gif.value.w, height: gif.value.h, rgba: frame.rgba })),
    delay: gif.value.frames[0]?.delay ?? 0,
    transparent: gif.value.transparent,
  };
}
