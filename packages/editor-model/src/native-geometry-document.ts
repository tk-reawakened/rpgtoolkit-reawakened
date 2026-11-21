import { err, ok, utf8Decode, utf8Encode, type Result } from "@tk-reawakened/core";
import {
  readAssetPack,
  readTile,
  setAssetPackGeometry,
  setTileGeometry,
  type AssetPack,
  type GeometryEditResult,
  type GeometrySolid,
  type GeometryUnder,
  type NativeTile,
} from "@tk-reawakened/native-data";
import {
  createBinaryDocument,
  openBinaryDocument,
  type DocumentCodec,
  type DocumentSnapshot,
  type DocumentStorage,
  type EditorDocument,
  type OpenResult,
  type Rejection,
} from "./binary-document.ts";
import type { DocumentIdentity } from "./identity.ts";

/**
 * The owner documents of collision and walk-behind: a standalone tile (`.tkrtle`) and a pack (`.tkrpack`), whose
 * assets each own a `solid` and an `under` list (docs/spec/formats/native-tile.md#geometry-and-program-activation,
 * docs/spec/formats/native-asset-pack.md#fields). The command replaces both lists of one owner; the writer splices the
 * source text, so author comments, unrelated keys and the plugin block stay byte for byte.
 */
export type NativeGeometryKind = "native-tile" | "native-asset-pack";

export type NativeGeometryCommand = {
  readonly type: "set-native-geometry";
  /** The pack-local asset ID. Present for a pack document and absent for a tile. */
  readonly asset?: string;
  readonly solid: readonly GeometrySolid[];
  readonly under: readonly GeometryUnder[];
};

/** What the snapshot gives a view: the parsed owner, never a copy a view could edit in place. */
export type NativeGeometrySource =
  | { readonly kind: "tile"; readonly tile: NativeTile }
  | { readonly kind: "asset-pack"; readonly pack: AssetPack };

export interface NativeGeometryModel {
  readonly text: string;
  readonly source: NativeGeometrySource;
}

export type NativeGeometrySnapshot = DocumentSnapshot<NativeGeometryCommand> & { readonly geometry: NativeGeometrySource };
export type NativeGeometryDocument = EditorDocument<NativeGeometrySnapshot, NativeGeometryCommand>;
export type NativeGeometryOpenResult = OpenResult<NativeGeometryDocument>;
export type NativeGeometryCodec = DocumentCodec<NativeGeometryModel, NativeGeometryCommand, { readonly geometry: NativeGeometrySource }>;

const TILE_SECTION = "docs/spec/formats/native-tile.md#geometry-and-program-activation";
const PACK_SECTION = "docs/spec/formats/native-asset-pack.md#fields";
const COMMAND_KEYS: readonly string[] = ["type", "asset", "solid", "under"];

const problemText = (problems: readonly { readonly path: string; readonly message: string; readonly line: number | null }[]): string =>
  problems.map((problem) => `${problem.path}${problem.line === null ? "" : ` (line ${problem.line})`}: ${problem.message}`).join("\n");

function isShape(value: unknown, under: boolean): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const shape = value as Record<string, unknown>;
  const allowed = under ? ["label", "attributes", "closed", "points"] : ["label", "closed", "points"];
  return Object.keys(shape).every((key) => allowed.includes(key))
    && typeof shape.label === "string"
    && typeof shape.closed === "boolean"
    && Array.isArray(shape.points)
    && shape.points.every((point) => Array.isArray(point) && point.length === 2 && point.every((coordinate) => Number.isSafeInteger(coordinate)))
    && (!under || Number.isSafeInteger(shape.attributes));
}

function editText(kind: NativeGeometryKind, text: string, command: NativeGeometryCommand): GeometryEditResult {
  const geometry = { solid: command.solid, under: command.under };
  return kind === "native-tile"
    ? setTileGeometry(text, geometry)
    : setAssetPackGeometry(text, command.asset ?? "", geometry);
}

function createCodec(kind: NativeGeometryKind): NativeGeometryCodec {
  const tile = kind === "native-tile";
  const section = tile ? TILE_SECTION : PACK_SECTION;
  const readText = (text: string): Result<NativeGeometryModel> => {
    if (tile) {
      const read = readTile(text);
      return read.ok ? ok({ text, source: { kind: "tile", tile: read.tile } }) : err({ offset: 0, section, message: problemText(read.problems) });
    }
    const read = readAssetPack(text);
    return read.ok ? ok({ text, source: { kind: "asset-pack", pack: read.assetPack } }) : err({ offset: 0, section, message: problemText(read.problems) });
  };
  return {
    kind,
    read(bytes, path) {
      let text: string;
      try { text = utf8Decode(bytes); }
      catch { return err({ offset: 0, section, message: `Invalid UTF-8 in ${path}; the file was not opened.` }); }
      return readText(text);
    },
    write: (model) => ok(utf8Encode(model.text)),
    readOnlyReason: () => null,
    isCommand(value): value is NativeGeometryCommand {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
      const command = value as Record<string, unknown>;
      return command.type === "set-native-geometry"
        && Object.keys(command).every((key) => COMMAND_KEYS.includes(key))
        && (tile ? !("asset" in command) : typeof command.asset === "string")
        && Array.isArray(command.solid) && command.solid.every((shape) => isShape(shape, false))
        && Array.isArray(command.under) && command.under.every((shape) => isShape(shape, true));
    },
    apply(model, command) {
      const edited = editText(kind, model.text, command);
      if (!edited.ok) return model;
      const read = readText(edited.text);
      return read.ok ? read.value : model;
    },
    label: () => tile ? "Set tile collision and walk-behind" : "Set asset collision and walk-behind",
    refuse(next, command, previous): Rejection | null {
      if (next !== previous && next.text !== previous.text) return null;
      const edited = editText(kind, previous.text, command);
      return { reason: "invalid", message: edited.ok ? "The collision and walk-behind shapes are already as written, so nothing changed." : problemText(edited.problems) };
    },
    summary: (model) => model.source.kind === "tile" ? `Native tile: ${model.source.tile.name}` : `Native asset pack: ${model.source.pack.name}`,
    fields: (model) => ({ geometry: model.source }),
  };
}

export const nativeGeometryCodecs: Readonly<Record<NativeGeometryKind, NativeGeometryCodec>> = {
  "native-tile": createCodec("native-tile"),
  "native-asset-pack": createCodec("native-asset-pack"),
};

export function openNativeGeometryDocument(kind: NativeGeometryKind, storage: DocumentStorage, identity: DocumentIdentity): Promise<NativeGeometryOpenResult> {
  return openBinaryDocument(nativeGeometryCodecs[kind], storage, identity);
}

export function createNativeGeometryDocument(kind: NativeGeometryKind, storage: DocumentStorage, identity: DocumentIdentity, bytes: Uint8Array): NativeGeometryOpenResult {
  return createBinaryDocument(nativeGeometryCodecs[kind], storage, identity, bytes);
}
