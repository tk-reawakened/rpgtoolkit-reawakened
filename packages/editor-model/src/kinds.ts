import { BinaryReader, foldPath, readCharacter, readItem } from "@tk-reawakened/core";
import { boardCodec, createBoardDocument, openBoardDocument, type BoardCommand, type BoardDocument } from "./board-document.ts";
import type { DocumentSnapshot, DocumentStorage, EditorDocument, OpenResult } from "./binary-document.ts";
import { characterSpriteCodec, createSpriteDocument, openSpriteDocument, type SpriteCommand, type SpriteDocument } from "./sprite-document.ts";
import type { DocumentIdentity } from "./identity.ts";
import { createMainDocument, mainCodec, openMainDocument, type MainCommand, type MainDocument } from "./main-document.ts";
import { createTilesetArtDocument, openTilesetArtDocument, tilesetArtCodec, type TilesetArtCommand } from "./tileset-art-document.ts";

/**
 * The registry of document kinds (ADR 0026 decisions 1, 2 and 9). A kind has an identifier, a label, the extensions it
 * claims and a way to open its bytes. A host asks the registry which kind a path is and drives the one document
 * contract; it holds no list of kinds of its own, so a kind registered here works in every host.
 *
 * A kind's views are registered in `editor-ui`.
 */

/** The command-data union; it keeps dynamic hosts typed without making commands `any`. */
export type AnyCommand = MainCommand | BoardCommand | SpriteCommand | TilesetArtCommand;
/** A document whose concrete kind is checked before commands are applied. */
export type AnyDocument = EditorDocument<DocumentSnapshot<AnyCommand>, AnyCommand>;

/** What Toolkit 3 file the kind stands for, and which row of ADR 0022 D2 it follows. */
export type StorageClass = "legacy-binary";

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
