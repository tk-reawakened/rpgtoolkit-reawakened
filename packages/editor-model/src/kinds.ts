import { BinaryReader, foldPath, readAnimation, readCharacter, readItem } from "@tk-reawakened/core";
import { boardCodec, createBoardDocument, openBoardDocument, type BoardCommand, type BoardDocument } from "./board-document.ts";
import type { DocumentSnapshot, DocumentStorage, EditorDocument, OpenResult } from "./binary-document.ts";
import { characterSpriteCodec, createSpriteDocument, openSpriteDocument, type SpriteCommand, type SpriteDocument } from "./sprite-document.ts";
import type { DocumentIdentity } from "./identity.ts";
import { createMainDocument, mainCodec, openMainDocument, type MainCommand, type MainDocument } from "./main-document.ts";
import { createTilesetArtDocument, openTilesetArtDocument, tilesetArtCodec, type TilesetArtCommand } from "./tileset-art-document.ts";
import { animationCodec, createAnimationDocument, openAnimationDocument, type AnimationCommand, type AnimationDocument } from "./animation-document.ts";
import { createProgramDocument, openProgramDocument, programCodec, type ProgramCommand, type ProgramDocument } from "./program-document.ts";
import { createTileBitmapDocument, openTileBitmapDocument, tileBitmapCodec, type TileBitmapCommand, type TileBitmapDocument } from "./tile-bitmap-document.ts";
import { createFontDocument, fontCodec, openFontDocument, type FontCommand, type FontDocument } from "./font-document.ts";
import { createNativeClipDocument, nativeClipCodec, openNativeClipDocument, type NativeClipCommand, type NativeClipDocument } from "./native-clip-document.ts";
import { createTerrainSceneDocument, openTerrainSceneDocument, terrainSceneCodec, type TerrainSceneCommand, type TerrainSceneDocument } from "./terrain-scene-document.ts";
import { createNativeGeometryDocument, nativeGeometryCodecs, openNativeGeometryDocument, type NativeGeometryCommand, type NativeGeometryDocument } from "./native-geometry-document.ts";
import { createSpecialMoveDocument, openSpecialMoveDocument, specialMoveCodec, type SpecialMoveCommand, type SpecialMoveDocument } from "./special-move-document.ts";
import { createStatusEffectDocument, openStatusEffectDocument, statusEffectCodec, type StatusEffectCommand, type StatusEffectDocument } from "./status-effect-document.ts";
import { createBattleBackgroundDocument, openBattleBackgroundDocument, battleBackgroundCodec, type BattleBackgroundCommand, type BattleBackgroundDocument } from "./battle-background-document.ts";

/**
 * The registry of document kinds (ADR 0026 decisions 1, 2 and 9). A kind has an identifier, a label, the extensions it
 * claims and a way to open its bytes. A host asks the registry which kind a path is and drives the one document
 * contract; it holds no list of kinds of its own, so a kind registered here works in every host.
 *
 * A kind's views are registered in `editor-ui`.
 */

/** The command-data union; it keeps dynamic hosts typed without making commands `any`. */
export type AnyCommand = MainCommand | BoardCommand | SpriteCommand | AnimationCommand | TilesetArtCommand | TileBitmapCommand | FontCommand | ProgramCommand | NativeClipCommand | TerrainSceneCommand | NativeGeometryCommand | SpecialMoveCommand | StatusEffectCommand | BattleBackgroundCommand;
/** A document whose concrete kind is checked before commands are applied. */
export type AnyDocument = EditorDocument<DocumentSnapshot<AnyCommand>, AnyCommand>;

/** What Toolkit 3 file the kind stands for, and which row of ADR 0022 D2 it follows. */
export type StorageClass = "legacy-binary" | "legacy-text" | "program-text" | "native-text";

export interface DocumentKind {
  /** The kind identifier, also `EditorDocument.kind`. */
  readonly id: string;
  /** A name fit for a menu. */
  readonly label: string;
  /** One sentence for a person choosing a file type. */
  readonly description: string;
  /** Lower-case extensions with the dot, claimed by this kind. */
  readonly extensions: readonly string[];
  readonly storage: StorageClass;
  /** Read the file at `identity.path` through `storage` and open it. */
  open(storage: DocumentStorage, identity: DocumentIdentity): Promise<OpenResult<AnyDocument>>;
  /** Open a document over bytes already in hand (a recovered backup, a copy). */
  create(storage: DocumentStorage, identity: DocumentIdentity, bytes: Uint8Array): OpenResult<AnyDocument>;
  /** A short name for the version of the file in `bytes`, to set beside a conflict; `null` when this kind does not read them. */
  summarise(bytes: Uint8Array, path: string): string | null;
  /** Whether a value that arrived from a webview has the shape of this kind's commands (never trust it past this). */
  isCommand(value: unknown): boolean;
  /**
   * A command that changes nothing the writer stores, which recovery applies once so the recovered document is dirty
   * and has a history; `null` when the kind recovers through the dirty flag alone. `snapshot` is the recovered one.
   */
  recoveryMarker(snapshot: DocumentSnapshot<unknown>): unknown;
}

export const DOCUMENT_KINDS: readonly DocumentKind[] = [
  {
    id: "main",
    label: "Game settings",
    description: "The game's main file: its title and start-up settings.",
    extensions: [".gam"],
    storage: "legacy-binary",
    open: openMainDocument,
    create: createMainDocument,
    summarise: (bytes, path) => {
      const read = mainCodec.read(bytes, path);
      return read.ok ? mainCodec.summary(read.value) : null;
    },
    isCommand: mainCodec.isCommand,
    recoveryMarker: (snapshot) => ({ type: "set-game-title", title: (snapshot as unknown as { readonly gameTitle: string }).gameTitle }),
  },
  {
    id: "board",
    label: "Board",
    description: "A map: its tile layers, vectors, programs, sprites, images and properties.",
    extensions: [".brd"],
    storage: "legacy-binary",
    open: openBoardDocument,
    create: createBoardDocument,
    summarise: (bytes, path) => {
      const read = boardCodec.read(bytes, path);
      return read.ok ? boardCodec.summary(read.value) : null;
    },
    isCommand: boardCodec.isCommand,
    recoveryMarker: () => null,
  },
  {
    id: "tileset",
    label: "Tileset artwork prototype",
    description: "Edit legacy tileset pixels without changing their stored format.",
    extensions: [".tst"],
    storage: "legacy-binary",
    open: openTilesetArtDocument,
    create: createTilesetArtDocument,
    summarise: (bytes, path) => {
      const read = tilesetArtCodec.read(bytes, path);
      return read.ok ? tilesetArtCodec.summary(read.value) : null;
    },
    isCommand: tilesetArtCodec.isCommand,
    recoveryMarker: () => null,
  },
  {
    id: "tile-bitmap",
    label: "Tile bitmap",
    description: "A picture built from tiles, each cell with its own shade, used as a stamp or wherever an image is accepted.",
    extensions: [".tbm"],
    storage: "legacy-binary",
    open: openTileBitmapDocument,
    create: createTileBitmapDocument,
    summarise: (bytes, path) => {
      const read = tileBitmapCodec.read(bytes, path);
      return read.ok ? tileBitmapCodec.summary(read.value) : null;
    },
    isCommand: tileBitmapCodec.isCommand,
    recoveryMarker: () => null,
  },
  {
    id: "font",
    label: "Bitmap font",
    description: "A Toolkit 2 bitmap font: 256 characters, each an 8 × 8 glyph, with a sample-text preview.",
    extensions: [".fnt"],
    storage: "legacy-text",
    open: openFontDocument,
    create: createFontDocument,
    summarise: (bytes, path) => {
      const read = fontCodec.read(bytes, path);
      return read.ok ? fontCodec.summary(read.value) : null;
    },
    isCommand: fontCodec.isCommand,
    recoveryMarker: () => null,
  },
  {
    id: "animation",
    label: "Animation",
    description: "A frame sequence with image, transparency, sound, size and delay.",
    extensions: [".anm"],
    storage: "legacy-binary",
    open: openAnimationDocument,
    create: createAnimationDocument,
    summarise: (bytes, path) => {
      const read = readAnimation(new BinaryReader(bytes, path));
      return read.ok ? animationCodec.summary(read.value) : null;
    },
    isCommand: animationCodec.isCommand,
    recoveryMarker: () => null,
  },
  {
    id: "battle-background",
    label: "Fight background",
    description: "A battle picture, music and four menu and action sound cues.",
    extensions: [".bkg"],
    storage: "legacy-binary",
    open: openBattleBackgroundDocument,
    create: createBattleBackgroundDocument,
    summarise: (bytes, path) => {
      const read = battleBackgroundCodec.read(bytes, path);
      return read.ok ? battleBackgroundCodec.summary(read.value) : null;
    },
    isCommand: battleBackgroundCodec.isCommand,
    recoveryMarker: () => null,
  },
  {
    id: "special-move",
    label: "Special move",
    description: "A battle move: its damage, costs, program, status effect, animation, description and where it can be used.",
    extensions: [".spc"],
    storage: "legacy-binary",
    open: openSpecialMoveDocument,
    create: createSpecialMoveDocument,
    summarise: (bytes, path) => {
      const read = specialMoveCodec.read(bytes, path);
      return read.ok ? specialMoveCodec.summary(read.value) : null;
    },
    isCommand: specialMoveCodec.isCommand,
    recoveryMarker: () => null,
  },
  {
    id: "status-effect",
    label: "Status effect",
    description: "A condition a fighter carries: its rounds, speed changes, per-round HP and SMP change and program.",
    extensions: [".ste"],
    storage: "legacy-binary",
    open: openStatusEffectDocument,
    create: createStatusEffectDocument,
    summarise: (bytes, path) => {
      const read = statusEffectCodec.read(bytes, path);
      return read.ok ? statusEffectCodec.summary(read.value) : null;
    },
    isCommand: statusEffectCodec.isCommand,
    recoveryMarker: () => null,
  },
  {
    id: "program",
    label: "RPGCode program",
    description: "A script: the text of an RPGCode program, edited with colouring, call tips and a command reference.",
    extensions: [".prg"],
    storage: "program-text",
    open: openProgramDocument,
    create: createProgramDocument,
    summarise: (bytes, path) => {
      const read = programCodec.read(bytes, path);
      return read.ok ? programCodec.summary(read.value) : null;
    },
    isCommand: programCodec.isCommand,
    recoveryMarker: () => null,
  },
  {
    id: "native-clip",
    label: "Native animation clip",
    description: "A native animation clip with comment-preserving property edits.",
    extensions: [".tkranm"],
    storage: "native-text",
    open: openNativeClipDocument,
    create: createNativeClipDocument,
    summarise: (bytes, path) => {
      const parsed = nativeClipCodec.read(bytes, path);
      return parsed.ok ? nativeClipCodec.summary(parsed.value) : null;
    },
    isCommand: nativeClipCodec.isCommand,
    recoveryMarker: () => null,
  },
  {
    id: "terrain-scene",
    label: "Terrain scene",
    description: "Paint and reshape terrain while keeping manual tile touch-ups.",
    extensions: [".tkrscn"],
    storage: "native-text",
    open: openTerrainSceneDocument,
    create: createTerrainSceneDocument,
    summarise: (bytes, path) => {
      const parsed = terrainSceneCodec.read(bytes, path);
      return parsed.ok ? terrainSceneCodec.summary(parsed.value) : null;
    },
    isCommand: terrainSceneCodec.isCommand,
    recoveryMarker: () => null,
  },
  ...(["native-tile", "native-asset-pack"] as const).map((id) => ({
    id,
    label: id === "native-tile" ? "Native tile" : "Native asset pack",
    description: id === "native-tile"
      ? "A native tile: its collision and walk-behind shapes, kept with the tile."
      : "A native asset pack: each asset's collision and walk-behind shapes, kept with the asset.",
    extensions: [id === "native-tile" ? ".tkrtle" : ".tkrpack"],
    storage: "native-text" as const,
    open: (storage: DocumentStorage, identity: DocumentIdentity) => openNativeGeometryDocument(id, storage, identity),
    create: (storage: DocumentStorage, identity: DocumentIdentity, bytes: Uint8Array) => createNativeGeometryDocument(id, storage, identity, bytes),
    summarise: (bytes: Uint8Array, path: string) => {
      const parsed = nativeGeometryCodecs[id].read(bytes, path);
      return parsed.ok ? nativeGeometryCodecs[id].summary(parsed.value) : null;
    },
    isCommand: nativeGeometryCodecs[id].isCommand,
    recoveryMarker: () => null,
  })),
  ...(["character", "item"] as const).map((id) => ({
    id,
    label: id === "character" ? "Character" : "Item",
    description: id === "character" ? "A player character and its sprite graphics." : "An item and its board sprite graphics.",
    extensions: [id === "character" ? ".tem" : ".itm"],
    storage: "legacy-binary" as const,
    open: (storage: DocumentStorage, identity: DocumentIdentity) => openSpriteDocument(id, storage, identity),
    create: (storage: DocumentStorage, identity: DocumentIdentity, bytes: Uint8Array) => createSpriteDocument(id, storage, identity, bytes),
    summarise: (bytes: Uint8Array, path: string) => {
      const parsed = id === "character" ? readCharacter(new BinaryReader(bytes, path)) : readItem(new BinaryReader(bytes, path));
      return parsed.ok ? `${id === "character" ? "Character" : "Item"}: ${parsed.value.name}` : null;
    },
    isCommand: characterSpriteCodec.isCommand,
    recoveryMarker: () => null,
  })),
];

/** The extension of `path` ASCII-folded, with the dot; `""` when it has none. */
export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : foldPath(name.slice(dot));
}

/** The kind that claims `path`'s extension, or `null`. Extensions are compared ASCII-folded, as paths are (ADR 0022 D1.1). */
export function kindForPath(path: string): DocumentKind | null {
  const extension = extensionOf(path);
  return DOCUMENT_KINDS.find((kind) => kind.extensions.includes(extension)) ?? null;
}

/** The registered kind with identifier `id`, or `null`. */
export function kindById(id: string): DocumentKind | null {
  return DOCUMENT_KINDS.find((kind) => kind.id === id) ?? null;
}

/**
 * The document as a main-file document. The workspace types a document by its lifecycle only; its kind says which
 * command and snapshot types it has, and a caller that opened a `.gam` says so here. Throws for another kind: that is a
 * caller's mistake, not a user's.
 */
export function asMainDocument(document: AnyDocument): MainDocument {
  if (document.kind !== "main") throw new Error(`${document.identity.path} is a ${document.kind} document, not a main file.`);
  return document as unknown as MainDocument;
}

/** The document as a board document (see `asMainDocument`). */
export function asBoardDocument(document: AnyDocument): BoardDocument {
  if (document.kind !== "board") throw new Error(`${document.identity.path} is a ${document.kind} document, not a board.`);
  return document as unknown as BoardDocument;
}

/** The document as a tile bitmap document (see `asMainDocument`). */
export function asTileBitmapDocument(document: AnyDocument): TileBitmapDocument {
  if (document.kind !== "tile-bitmap") throw new Error(`${document.identity.path} is a ${document.kind} document, not a tile bitmap.`);
  return document as unknown as TileBitmapDocument;
}

/** The document as a bitmap font document (see `asMainDocument`). */
export function asFontDocument(document: AnyDocument): FontDocument {
  if (document.kind !== "font") throw new Error(`${document.identity.path} is a ${document.kind} document, not a bitmap font.`);
  return document as unknown as FontDocument;
}
/** The document as an animation document (see `asMainDocument`). */
export function asAnimationDocument(document: AnyDocument): AnimationDocument {
  if (document.kind !== "animation") throw new Error(`${document.identity.path} is a ${document.kind} document, not an animation.`);
  return document as unknown as AnimationDocument;
}
/** The document as a native clip document (see `asMainDocument`). */
export function asNativeClipDocument(document: AnyDocument): NativeClipDocument {
  if (document.kind !== "native-clip") throw new Error(`Expected native-clip document, got ${document.kind}.`);
  return document as NativeClipDocument;
}

export function asTerrainSceneDocument(document: AnyDocument): TerrainSceneDocument {
  if (document.kind !== "terrain-scene") throw new Error("Expected a terrain scene document.");
  return document as TerrainSceneDocument;
}

/** The document as a native tile or pack document, whose owners keep collision and walk-behind (see `asMainDocument`). */
export function asNativeGeometryDocument(document: AnyDocument): NativeGeometryDocument {
  if (document.kind !== "native-tile" && document.kind !== "native-asset-pack") throw new Error(`${document.identity.path} is a ${document.kind} document, not a native tile or pack.`);
  return document as NativeGeometryDocument;
}

/** The document as a program document (see `asMainDocument`). */
export function asProgramDocument(document: AnyDocument): ProgramDocument {
  if (document.kind !== "program") throw new Error(`${document.identity.path} is a ${document.kind} document, not a program.`);
  return document as unknown as ProgramDocument;
}

/** The document as a special move document (see `asMainDocument`). */
export function asSpecialMoveDocument(document: AnyDocument): SpecialMoveDocument {
  if (document.kind !== "special-move") throw new Error(`${document.identity.path} is a ${document.kind} document, not a special move.`);
  return document as unknown as SpecialMoveDocument;
}

/** The document as a status effect document (see `asMainDocument`). */
export function asStatusEffectDocument(document: AnyDocument): StatusEffectDocument {
  if (document.kind !== "status-effect") throw new Error(`${document.identity.path} is a ${document.kind} document, not a status effect.`);
  return document as unknown as StatusEffectDocument;
}
/** The document as a fight-background document (see `asMainDocument`). */
export function asBattleBackgroundDocument(document: AnyDocument): BattleBackgroundDocument {
  if (document.kind !== "battle-background") throw new Error(`${document.identity.path} is a ${document.kind} document, not a fight background.`);
  return document as unknown as BattleBackgroundDocument;
}
