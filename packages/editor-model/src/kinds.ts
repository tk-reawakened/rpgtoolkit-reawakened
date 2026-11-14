import { foldPath } from "@tk-reawakened/core";
import { openBoardDocument } from "./board-document.ts";
import type { DocumentSnapshot, DocumentStorage, EditorDocument, OpenResult } from "./binary-document.ts";
import type { DocumentIdentity } from "./identity.ts";
import { openMainDocument } from "./main-document.ts";

/**
 * The registry of document kinds (ADR 0026 decisions 1, 2 and 9). A kind has an identifier, a label, the extensions it
 * claims and a way to open its bytes. A host asks the registry which kind a path is and drives the one document
 * contract; it holds no list of kinds of its own, so a kind registered here works in every host.
 *
 * The first release registers the two Toolkit 3 kinds that exist. A kind's views are registered in `editor-ui`.
 */

/** A document whose commands the caller does not know: the lifecycle surface every kind shares (ADR 0022 D1 to D3). */
export type AnyDocument = EditorDocument<DocumentSnapshot<unknown>, unknown>;

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
}

export const DOCUMENT_KINDS: readonly DocumentKind[] = [
  {
    id: "main",
    label: "Game settings",
    description: "The game's main file: its title and start-up settings.",
    extensions: [".gam"],
    storage: "legacy-binary",
    open: openMainDocument,
  },
  {
    id: "board",
    label: "Board",
    description: "A map: its tile layers, vectors, programs, sprites, images and properties.",
    extensions: [".brd"],
    storage: "legacy-binary",
    open: openBoardDocument,
  },
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
