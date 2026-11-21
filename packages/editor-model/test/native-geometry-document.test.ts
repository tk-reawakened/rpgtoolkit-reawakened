import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { utf8Encode } from "@tk-reawakened/core";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { createDocumentIdentity, DOCUMENT_KINDS, kindForPath, nativeGeometryCodecs, openNativeGeometryDocument } from "../src/index.ts";

const TILE_PATH = "Game/Quest/Tiles/fence.tkrtle";
const PACK_PATH = "Game/Quest/Packs/props.tkrpack";
const TILE = `contract: tile
version: 1.0.0-pre.1
# A village fence.
name: Fence # display name
projection: 2d
role: decorative
visual:
  transparent: {mode: alpha}
  sample: {file: art/fence.png, rect: [0, 0, 32, 32]} # sample
pluginData:
  com.example.glow:
    version: 1.0.0
    data: {bloom: 0.4} # opaque
`;
const PACK = `contract: asset-pack
version: 1.0.0-pre.1
name: Props # kit
projection: 2d
grid:
  tileWidth: 32
  tileHeight: 32
sources:
  - id: atlas
    file: Bitmap/props.png
assets:
  - id: gate
    name: Gate
    kind: prop
    anchor: {x: 16, y: 32, snap: bottom-center}
    visuals:
      - source: atlas
        rect: [0, 0, 32, 32]
  # Second asset.
  - id: fence
    name: Fence
    kind: prop
    anchor: {x: 16, y: 32, snap: bottom-center}
    visuals:
      - source: atlas
        rect: [32, 0, 32, 32]
pluginData:
  com.example.glow:
    version: 1.0.0
    data: {bloom: 0.4} # opaque
`;

const RAIL = { label: "Rail", closed: false, points: [[-4, 20], [36, 20]] as const };
const LINTEL = { label: "Lintel", attributes: 7, closed: true, points: [[-16, -40], [16, -40], [16, -24], [-16, -24]] as const };
const identity = (path: string) => createDocumentIdentity("memory-project", path);

test("native tiles and packs are registered kinds, claimed by extension and stored as native text", () => {
  equal(kindForPath(TILE_PATH)?.id, "native-tile");
  equal(kindForPath("Packs/Props.TKRPACK")?.id, "native-asset-pack");
  for (const id of ["native-tile", "native-asset-pack"]) equal(DOCUMENT_KINDS.find((kind) => kind.id === id)?.storage, "native-text");
});

test("a tile's barrier is one spliced edit that undoes, redoes, saves and reopens as exact UTF-8", async () => {
  const bytes = utf8Encode(TILE);
  const host = createMemoryPlatformServices({ files: { [TILE_PATH]: bytes } });
  const opened = await openNativeGeometryDocument("native-tile", host.fs, identity(TILE_PATH));
  ok(opened.ok);
  const doc = opened.document;
  equal(doc.kind, "native-tile");
  const snapshot = doc.getSnapshot();
  equal(snapshot.geometry.kind, "tile");
  equal(snapshot.dirty, false);
  const applied = doc.apply({ type: "set-native-geometry", solid: [RAIL], under: [] });
  ok(applied.ok);
  const edited = TILE.replace("# sample\n", "# sample\nsolid:\n  - {label: Rail, closed: false, points: [[-4, 20], [36, 20]]}\n");
  deepEqual(doc.serialize(), utf8Encode(edited));
  const after = doc.getSnapshot();
  equal(after.dirty, true);
  ok(after.geometry.kind === "tile" && after.geometry.tile.solid?.[0]?.label === "Rail");
  equal(doc.undo(applied.editId).ok, true);
  deepEqual(doc.serialize(), bytes);
  equal(doc.getSnapshot().dirty, false);
  equal(doc.redo(applied.editId).ok, true);
  ok((await doc.save()).ok);
  deepEqual(host.bytesOf(TILE_PATH), utf8Encode(edited));
  const reopened = await openNativeGeometryDocument("native-tile", host.fs, identity(TILE_PATH));
  ok(reopened.ok);
  deepEqual(reopened.document.serialize(), utf8Encode(edited));
});

test("a pack asset's shapes change one asset and leave its neighbour, comments and plugin data as written", async () => {
  const host = createMemoryPlatformServices({ files: { [PACK_PATH]: utf8Encode(PACK) } });
  const opened = await openNativeGeometryDocument("native-asset-pack", host.fs, identity(PACK_PATH));
  ok(opened.ok);
  const doc = opened.document;
  const applied = doc.apply({ type: "set-native-geometry", asset: "fence", solid: [RAIL], under: [LINTEL] });
  ok(applied.ok);
  const text = new TextDecoder().decode(doc.serialize());
  equal(text, PACK.replace("        rect: [32, 0, 32, 32]\n", [
    "        rect: [32, 0, 32, 32]",
    "    solid:",
    "      - {label: Rail, closed: false, points: [[-4, 20], [36, 20]]}",
    "    under:",
    "      - {label: Lintel, attributes: 7, closed: true, points: [[-16, -40], [16, -40], [16, -24], [-16, -24]]}",
    "",
  ].join("\n")));
  const geometry = doc.getSnapshot().geometry;
  ok(geometry.kind === "asset-pack");
  deepEqual(geometry.pack.assets[0]!.solid, undefined);
  equal(geometry.pack.assets[1]!.under?.[0]?.attributes, 7);
  ok((await doc.save()).ok);
  const reopened = await openNativeGeometryDocument("native-asset-pack", host.fs, identity(PACK_PATH));
  ok(reopened.ok);
  deepEqual(reopened.document.serialize(), doc.serialize());
});

test("refused geometry changes nothing: not dirty, no history, the reason says why", async () => {
  const host = createMemoryPlatformServices({ files: { [PACK_PATH]: utf8Encode(PACK) } });
  const opened = await openNativeGeometryDocument("native-asset-pack", host.fs, identity(PACK_PATH));
  ok(opened.ok);
  const doc = opened.document;
  const open = doc.apply({ type: "set-native-geometry", asset: "gate", solid: [], under: [{ ...LINTEL, closed: false }] });
  ok(!open.ok);
  ok(open.rejection.message.includes("reader refuses"));
  const unknown = doc.apply({ type: "set-native-geometry", asset: "nope", solid: [RAIL], under: [] });
  ok(!unknown.ok);
  ok(unknown.rejection.message.includes("nope"));
  const nothing = doc.apply({ type: "set-native-geometry", asset: "gate", solid: [], under: [] });
  ok(!nothing.ok);
  ok(nothing.rejection.message.includes("nothing changed"));
  const missingAsset = doc.apply({ type: "set-native-geometry", solid: [RAIL], under: [] });
  ok(!missingAsset.ok);
  equal(doc.getSnapshot().dirty, false);
  equal(doc.getSnapshot().edits.length, 0);
  deepEqual(doc.serialize(), utf8Encode(PACK));
});

test("only well-formed commands for the right owner are accepted from a webview", () => {
  const tile = nativeGeometryCodecs["native-tile"];
  const pack = nativeGeometryCodecs["native-asset-pack"];
  const make = (extra: object = {}): unknown => ({ type: "set-native-geometry", solid: [RAIL], under: [LINTEL], ...extra });
  ok(tile.isCommand(make()));
  ok(!tile.isCommand(make({ asset: "gate" })));
  ok(pack.isCommand(make({ asset: "gate" })));
  ok(!pack.isCommand(make()));
  ok(!pack.isCommand(make({ asset: 3 })));
  for (const bad of [
    null, [], make({ type: "other" }), make({ extra: true }), make({ solid: "none" }),
    make({ solid: [{ ...RAIL, label: 7 }] }), make({ solid: [{ ...RAIL, points: [[0.5, 1], [2, 3]] }] }),
    make({ solid: [{ ...RAIL, points: [[0, 1, 2], [2, 3]] }] }), make({ solid: [{ ...RAIL, attributes: 1 }] }),
    make({ under: [{ label: "Roof", closed: true, points: [[0, 0], [1, 0], [1, 1]] }] }),
    make({ under: [{ ...LINTEL, attributes: 1.5 }] }),
  ]) ok(!tile.isCommand(bad), JSON.stringify(bad));
});

test("a file the readers refuse is not opened", async () => {
  const host = createMemoryPlatformServices({ files: { [TILE_PATH]: utf8Encode("contract: tile\nversion: 1.0.0-pre.1\n"), [PACK_PATH]: new Uint8Array([0xff, 0xfe, 0x00]) } });
  ok(!(await openNativeGeometryDocument("native-tile", host.fs, identity(TILE_PATH))).ok);
  ok(!(await openNativeGeometryDocument("native-asset-pack", host.fs, identity(PACK_PATH))).ok);
});
