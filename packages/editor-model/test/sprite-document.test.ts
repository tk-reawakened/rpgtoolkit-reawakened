import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { createDocumentIdentity, openSpriteDocument, spriteAnimationCanvasPreview, spriteAnimationPreview, spriteGifPreview, spritePicturePreview, spriteProjectAssetPath, spriteTileAnimationFirstFrame, spriteTileBitmapPreview, spriteTileBitmapPreviewFromAssets, spriteTileBitmapReferences, spriteTilePreview, type SpriteActorKind, type SpriteDocument } from "../src/index.ts";
import { actorInputFromCharacter, BinaryReader, createActorRecord, readCharacter, readTileBitmap, writeCharacter, writeTileBitmap } from "@tk-reawakened/core";
import { exampleAnimation, exampleCharacter, exampleItem, examplePicture } from "./fixtures.ts";

const COLLISION = { points: [{ x: -18, y: -16 }, { x: 18, y: -16 }, { x: 18, y: 0 }, { x: -18, y: 0 }] };
const ACTIVATION = { points: [{ x: -40000, y: -28000 }, { x: 40000, y: -28000 }, { x: 40000, y: 12000 }, { x: -40000, y: 12000 }] };

async function open(kind: SpriteActorKind, path: string, bytes: Uint8Array) {
  const host = createMemoryPlatformServices({ files: { [path]: bytes } });
  const identity = createDocumentIdentity("memory-project", path);
  const opened = await openSpriteDocument(kind, host.fs, identity);
  ok(opened.ok, `${path} opens`);
  return { host, identity, doc: opened.document };
}

function apply(doc: SpriteDocument, command: Parameters<SpriteDocument["apply"]>[0]): void {
  const result = doc.apply(command);
  ok(result.ok, result.ok ? "command accepted" : result.rejection.message);
}

test("character stances, timing and distinct bases save and reopen through the shared document", async () => {
  const path = "Chrs/hero.tem";
  const { host, identity, doc } = await open("character", path, exampleCharacter());
  const beforeInvalid = doc.getSnapshot();
  const invalid = doc.apply({ type: "set-sprite-animation", group: "walk", index: 0, file: "Misc/truncated\u0000tail.anm" });
  ok(!invalid.ok);
  equal(doc.getSnapshot(), beforeInvalid, "a value the writer truncates cannot dirty the document");
  const walk = ["S", "N", "E", "W", "NW", "NE", "SW", "SE"];
  for (const [index, direction] of walk.entries()) {
    apply(doc, { type: "set-sprite-animation", group: "walk", index, file: `Misc/hero_walk_${direction}.anm` });
    apply(doc, { type: "set-sprite-animation", group: "idle", index, file: `Misc/hero_idle_${direction}.anm` });
  }
  apply(doc, { type: "set-sprite-animation", group: "battle", index: 4, file: "Misc/hero_die.anm" });
  apply(doc, { type: "add-custom-stance", name: "Cast", file: "Misc/hero_cast.anm" });
  const customIndex = doc.getSnapshot().customStances.length - 1;
  apply(doc, { type: "rename-custom-stance", index: customIndex, name: "Magic" });
  apply(doc, { type: "set-sprite-animation", group: "custom", index: customIndex, file: "Misc/hero_magic.anm" });
  const invalidName = doc.apply({ type: "add-custom-stance", name: "Not\u0000exact", file: "" });
  ok(!invalidName.ok);
  apply(doc, { type: "set-sprite-timing", speed: 0.125, idleTime: 2.5 });
  apply(doc, { type: "set-sprite-bases", bases: [COLLISION, ACTIVATION] });
  ok((await doc.save()).ok);

  const reopened = await openSpriteDocument("character", host.fs, identity);
  ok(reopened.ok);
  const saved = reopened.document.getSnapshot();
  deepEqual(saved.movementAnimations, walk.map((direction) => `Misc/hero_walk_${direction}.anm`));
  deepEqual(saved.idleAnimations, walk.map((direction) => `Misc/hero_idle_${direction}.anm`));
  equal(saved.battleAnimations[4], "Misc/hero_die.anm");
  equal(saved.customStances[customIndex]?.handle, "Magic");
  equal(saved.customStances[customIndex]?.animation, "Misc/hero_magic.anm");
  equal(saved.speed, 0.125);
  equal(saved.idleTime, 2.5);
  deepEqual(saved.vectorBases, [COLLISION, ACTIVATION]);
  deepEqual(reopened.document.serialize(), host.bytesOf(path));
});

test("items use the same lifecycle for their eight directions, custom stances and bases without battle slots", async () => {
  const path = "Item/chest.itm";
  const { host, identity, doc } = await open("item", path, exampleItem());
  apply(doc, { type: "set-sprite-animation", group: "walk", index: 7, file: "Misc/chest_walk_se.anm" });
  apply(doc, { type: "set-sprite-animation", group: "idle", index: 7, file: "Misc/chest_idle_se.anm" });
  apply(doc, { type: "add-custom-stance", name: "Open", file: "Misc/chest_open.anm" });
  apply(doc, { type: "set-sprite-animation", group: "custom", index: doc.getSnapshot().customStances.length - 1, file: "Misc/chest_open_full.anm" });
  apply(doc, { type: "set-sprite-timing", speed: 0.2, idleTime: 1.75 });
  apply(doc, { type: "set-sprite-bases", bases: [COLLISION, ACTIVATION] });
  const battle = doc.apply({ type: "set-sprite-animation", group: "battle", index: 0, file: "Misc/chest_battle.anm" });
  ok(!battle.ok);
  ok((await doc.save()).ok);

  const reopened = await openSpriteDocument("item", host.fs, identity);
  ok(reopened.ok);
  const saved = reopened.document.getSnapshot();
  equal(saved.movementAnimations[7], "Misc/chest_walk_se.anm");
  equal(saved.idleAnimations[7], "Misc/chest_idle_se.anm");
  equal(saved.customStances.at(-1)?.animation, "Misc/chest_open_full.anm");
  equal(saved.speed, 0.2);
  equal(saved.idleTime, 1.75);
  deepEqual(saved.vectorBases, [COLLISION, ACTIVATION]);
  deepEqual(reopened.document.serialize(), host.bytesOf(path));
});

test("older actor formats stay at their original minor and refuse fields not stored by that minor", async () => {
  for (const entry of [
    { kind: "character" as const, path: "Chrs/old.tem", bytes: exampleCharacter(7), baseCommand: { type: "set-sprite-bases" as const, bases: [COLLISION, ACTIVATION] } },
    { kind: "item" as const, path: "Item/old.itm", bytes: exampleItem(6), baseCommand: { type: "set-sprite-bases" as const, bases: [COLLISION, ACTIVATION] } },
  ]) {
    const { doc } = await open(entry.kind, entry.path, entry.bytes);
    equal(doc.getSnapshot().readOnly, null);
    equal(doc.getSnapshot().graphicsUnavailable === null, false);
    deepEqual(doc.serialize(), entry.bytes);
    const result = doc.apply(entry.baseCommand);
    ok(!result.ok);
    equal(result.rejection.reason, "invalid");
    deepEqual(doc.serialize(), entry.bytes);
  }
});

test("character authoring fields apply independently, undo and round-trip without changing bindings on rename", async () => {
  const path = "Chrs/hero.tem";
  const original = Uint8Array.from([...exampleCharacter(), 0xa5, 0x5a]);
  const { host, identity, doc } = await open("character", path, original);
  const initial = doc.getSnapshot().character;
  ok(initial !== null);
  const names = [...initial.variableNames];
  apply(doc, { type: "set-character-text", field: "name", value: "Renamed hero" });
  deepEqual(doc.getSnapshot().character?.variableNames, names);
  apply(doc, { type: "set-character-variable", index: 0, value: "hero_exp!" });
  apply(doc, { type: "set-character-stat", field: "maxHp", value: 321 });
  apply(doc, { type: "set-character-text", field: "profilePicture", value: "Bitmap/hero.png" });
  apply(doc, { type: "set-character-move", index: 200, value: { condValue: "done", condVar: "quest!", minLevel: 3, minExp: 42, file: "SpcMove/flare.spc" } });
  apply(doc, { type: "set-character-text", field: "specialMoveCategory", value: "Arts" });
  apply(doc, { type: "set-character-moves-enabled", value: 1 });
  apply(doc, { type: "set-character-accessory", index: 10, value: "Charm" });
  apply(doc, { type: "set-character-body-slot", index: 6, value: 1 });
  apply(doc, { type: "set-character-growth", field: "firstLevelExp", value: 120 });
  apply(doc, { type: "set-character-growth", field: "experienceIncrease", value: 110 });
  apply(doc, { type: "set-character-growth", field: "maxLevel", value: 60 });
  apply(doc, { type: "set-character-increase", index: 3, value: 7 });
  apply(doc, { type: "set-character-growth", field: "levelUpProgram", value: "Prg/levelup.prg" });
  apply(doc, { type: "set-character-growth", field: "levelUpType", value: 1 });
  apply(doc, { type: "set-character-growth", field: "levelUpType", value: 0 });
  apply(doc, { type: "set-character-growth", field: "levelUpType", value: 1 });
  const invalidLevelUpType = doc.apply({ type: "set-character-growth", field: "levelUpType", value: 2 });
  ok(!invalidLevelUpType.ok);
  equal(doc.getSnapshot().character?.levelUpType, 1);
  const invalid = doc.apply({ type: "set-character-variable", index: 9, value: "outside!" });
  ok(!invalid.ok);
  const unchanged = doc.getSnapshot().character;
  apply(doc, { type: "set-character-stat", field: "hp", value: 77 });
  ok(doc.undo().ok);
  equal(doc.getSnapshot().character?.stats.hp, unchanged?.stats.hp);
  ok(doc.redo().ok);
  equal(doc.getSnapshot().character?.stats.hp, 77);
  ok((await doc.save()).ok);
  const reopened = await openSpriteDocument("character", host.fs, identity);
  ok(reopened.ok);
  const saved = reopened.document.getSnapshot().character;
  ok(saved !== null);
  equal(saved.name, "Renamed hero");
  equal(saved.variableNames[0], "hero_exp!");
  equal(saved.stats.maxHp, 321);
  equal(saved.profilePicture, "Bitmap/hero.png");
  deepEqual(saved.specialMoves[200], { file: "SpcMove/flare.spc", minExp: 42, minLevel: 3, condVar: "quest!", condValue: "done" });
  equal(saved.specialMoveCategory, "Arts");
  equal(saved.hasSpecialMoves, 1);
  equal(saved.accessorySlots[10], "Charm");
  equal(saved.bodySlots[6], 1);
  equal(saved.firstLevelExp, 120);
  equal(saved.experienceIncrease, 110);
  equal(saved.maxLevel, 60);
  equal(saved.levelIncreases[3], 7);
  equal(saved.levelUpProgram, "Prg/levelup.prg");
  equal(saved.levelUpType, 1);
  const runtimeCharacter = readCharacter(new BinaryReader(reopened.document.serialize()));
  ok(runtimeCharacter.ok);
  const runtimeActor = actorInputFromCharacter(path, "party", runtimeCharacter.value);
  const actorRecord = createActorRecord(1, runtimeActor);
  ok(runtimeActor.stats);
  ok(runtimeActor.progression);
  equal(actorRecord.stats.maxHp, saved.stats.maxHp);
  equal(runtimeActor.stats.experience, saved.stats.experience);
  equal(runtimeActor.progression.levelType, saved.firstLevelExp);
  deepEqual(reopened.document.serialize(), host.bytesOf(path));
  deepEqual(reopened.document.serialize().slice(-2), Uint8Array.of(0xa5, 0x5a), "untouched residue survives edits");
});

test("rejects runtime-invalid negative edits but preserves untouched legacy stats", async () => {
  const { doc } = await open("character", "Chrs/negative-edits.tem", exampleCharacter());
  const negativeEdits = [
    { type: "set-character-stat", field: "experience", value: -1 },
    { type: "set-character-stat", field: "level", value: -1 },
    { type: "set-character-stat", field: "maxHp", value: -1 },
    { type: "set-character-stat", field: "maxSmp", value: -1 },
    { type: "set-character-growth", field: "firstLevelExp", value: -1 },
    { type: "set-character-growth", field: "experienceIncrease", value: -1 },
    { type: "set-character-growth", field: "maxLevel", value: -1 },
    { type: "set-character-increase", index: 0, value: -1 },
  ] as const;
  for (const command of negativeEdits) {
    const result = doc.apply(command);
    ok(!result.ok, `${command.type} ${"field" in command ? command.field : ""} rejects a negative runtime value`);
    equal(doc.getSnapshot().dirty, false);
  }
  apply(doc, { type: "set-character-stat", field: "hp", value: -1 });
  apply(doc, { type: "set-character-stat", field: "dp", value: -2 });
  apply(doc, { type: "set-character-stat", field: "fp", value: -3 });
  apply(doc, { type: "set-character-stat", field: "smp", value: -4 });
  const validNegativeStats = readCharacter(new BinaryReader(doc.serialize()));
  ok(validNegativeStats.ok);
  equal(createActorRecord(1, actorInputFromCharacter("Chrs/negative-edits.tem", "party", validNegativeStats.value)).stats.hp, -1);

  const parsed = readCharacter(new BinaryReader(exampleCharacter()));
  ok(parsed.ok);
  const legacy = writeCharacter({ ...parsed.value, stats: { ...parsed.value.stats, experience: -5 } });
  ok(legacy.ok);
  const reopened = await open("character", "Chrs/legacy-negative.tem", legacy.value);
  const invalidRepair = reopened.doc.apply({ type: "set-character-stat", field: "experience", value: -6 });
  ok(!invalidRepair.ok);
  apply(reopened.doc, { type: "set-character-text", field: "name", value: "Keep legacy value" });
  ok((await reopened.doc.save()).ok);
  const persisted = readCharacter(new BinaryReader(reopened.doc.serialize()));
  ok(persisted.ok);
  equal(persisted.value.stats.experience, -5);
});

test("character minor 3 bounds first-level experience to a byte and items expose no character contract", async () => {
  const char = await open("character", "Chrs/old.tem", exampleCharacter(3));
  const belowByteMaximum = char.doc.apply({ type: "set-character-growth", field: "firstLevelExp", value: 127 });
  ok(belowByteMaximum.ok);
  equal(char.doc.getSnapshot().character?.firstLevelExp, 127);
  const tooLarge = char.doc.apply({ type: "set-character-growth", field: "firstLevelExp", value: 128 });
  ok(!tooLarge.ok);
  equal(char.doc.getSnapshot().character?.firstLevelExp, 127, "the rejected byte value leaves the prior model intact");
  const item = await open("item", "Item/chest.itm", exampleItem());
  equal(item.doc.getSnapshot().character, null);
  const notACharacter = item.doc.apply({ type: "set-character-stat", field: "hp", value: 2 });
  ok(!notACharacter.ok);
});
test("a concurrent character save conflicts instead of overwriting another document's authoring fields", async () => {
  const path = "Chrs/hero.tem";
  const { host, identity, doc } = await open("character", path, exampleCharacter());
  const originalName = doc.getSnapshot().character?.name;
  apply(doc, { type: "set-character-text", field: "name", value: "Local edit" });
  const concurrent = await openSpriteDocument("character", host.fs, identity);
  ok(concurrent.ok);
  apply(concurrent.document, { type: "set-character-stat", field: "hp", value: 19 });
  ok((await concurrent.document.save()).ok);
  const staleSave = await doc.save();
  ok(!staleSave.ok);
  equal(staleSave.failure.kind, "conflict");
  const current = await openSpriteDocument("character", host.fs, identity);
  ok(current.ok);
  equal(current.document.getSnapshot().character?.name, originalName);
  equal(current.document.getSnapshot().character?.stats.hp, 19);
});


test("sprite previews preserve ANM canvases and frame keys, resolve TAN tiles inside TBM pictures, and compose tile bitmaps", async () => {
  const animation = spriteAnimationPreview(exampleAnimation(), "Misc/animation_minor3.anm");
  ok(animation !== null);
  equal(animation.width, 32);
  equal(animation.height, 32);
  deepEqual(animation.frames.map((frame) => frame.image), ["village.tst15", "village.tst16"]);
  deepEqual(animation.frames[0]?.transparent, { r: 255, g: 255, b: 255 });
  equal(animation.delay, 0.15);

  const source = { width: 2, height: 1, rgba: new Uint8Array([10, 20, 30, 255, 255, 255, 255, 255]) };
  const scaledPicture = spriteAnimationCanvasPreview(source, 4, 1, { r: 255, g: 255, b: 255 }, true);
  deepEqual(Array.from(scaledPicture.rgba), [10, 20, 30, 255, 10, 20, 30, 255, 255, 255, 255, 0, 255, 255, 255, 0]);
  const nativeTile = spriteAnimationCanvasPreview(source, 4, 1);
  deepEqual(Array.from(nativeTile.rgba), [10, 20, 30, 255, 255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0], "direct tile previews keep native pixels and do not apply the ANM picture key");
  const keyed = spriteAnimationCanvasPreview(source, 3, 2, { r: 255, g: 255, b: 255 });
  equal(keyed.width, 3);
  equal(keyed.height, 2);
  deepEqual(Array.from(keyed.rgba), [10, 20, 30, 255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

  const tanPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "spec", "examples", "versions", "tile-animation", "water.tan");
  const tan = spriteTileAnimationFirstFrame(new Uint8Array(readFileSync(tanPath)), "Tiles/water.tan");
  equal(tan, "village.tst2", "tile bitmaps use the first frame of a nested TAN reference");
  equal(spriteProjectAssetPath("Tiles", "village/ground.tst"), "Tiles/village/ground.tst", "nested tile references remain under the Tiles root");

  const tilePath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "spec", "examples", "versions", "tileset", "tileset_detail1.tst");
  const tiles = new Uint8Array(readFileSync(tilePath));
  const tile = spriteTilePreview(tiles, "Tiles/village.tst", 1);
  ok(tile !== null);
  equal(tile.width, 32);
  equal(tile.height, 32);
  const bitmapPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "spec", "examples", "versions", "tile-bitmap", "tilebitmap.tbm");
  const bitmap = new Uint8Array(readFileSync(bitmapPath));
  const references = spriteTileBitmapReferences(bitmap, "Bitmap/test.tbm");
  deepEqual(references, ["village.tst8", "village.tst9"]);
  const tile9 = spriteTilePreview(tiles, "Tiles/village.tst", 2);
  ok(tile9 !== null);
  const composed = spriteTileBitmapPreview(bitmap, "Bitmap/test.tbm", new Map([["village.tst8", tile], ["village.tst9", tile9]]));
  ok(composed !== null);
  equal(composed.width, 64);
  equal(composed.height, 32);
  const parsed = readTileBitmap(new BinaryReader(bitmap, "Bitmap/test.tbm"));
  ok(parsed.ok);
  let replaced = false;
  const tanBitmap = writeTileBitmap({
    ...parsed.value,
    cells: parsed.value.cells.map((cell) => {
      if (cell.tile === "village.tst8") {
        replaced = true;
        return { ...cell, tile: "water.tan" };
      }
      return cell.tile === "village.tst9" ? { ...cell, tile: "village.tst1" } : cell;
    }),
  });
  ok(tanBitmap.ok && replaced, "the fixture's first TBM tile was replaced by a TAN reference");
  const water = new Uint8Array(readFileSync(tanPath));
  const loadedPaths: string[] = [];
  const resolved = await spriteTileBitmapPreviewFromAssets(tanBitmap.value, "Bitmap/test.tbm", async (path) => {
    loadedPaths.push(path);
    if (path === "Tiles/water.tan") return water;
    if (path === "Tiles/village.tst") return tiles;
    return null;
  });
  ok(resolved !== null);
  deepEqual(loadedPaths, ["Tiles/water.tan", "Tiles/village.tst", "Tiles/village.tst"], "a TAN cell resolves its first frame through the nested Tiles asset root");
  const expected = spriteTileBitmapPreview(tanBitmap.value, "Bitmap/test.tbm", new Map([["water.tan", tile9], ["village.tst1", tile]]));
  ok(expected !== null);
  equal(resolved.width, expected.width);
  equal(resolved.height, expected.height);
  deepEqual(Array.from(resolved.rgba), Array.from(expected.rgba), "TBM pixels include the actual first TAN frame, not an unresolved/blank tile");
});

test("sprite picture and GIF previews use shared image decoders", () => {
  const picture = spritePicturePreview(examplePicture(), "Bitmap/tileset_detail1.png");
  ok(picture !== null);
  ok(picture.width > 0 && picture.height > 0);
  equal(picture.rgba.length, picture.width * picture.height * 4);

  // Reuse the core GIF decoder's authored multi-page vector rather than adding a second decoder or fixture format.
  const gifPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "core", "test", "fixtures", "authored", "gif-anim89a.gif");
  const gif = spriteGifPreview(new Uint8Array(readFileSync(gifPath)), "Misc/waterfall.gif");
  ok(gif !== null);
  equal(gif.frames.length, 3);
  equal(gif.frames[0]?.width, 4);
  equal(gif.frames[0]?.height, 3);
  equal(gif.delay, 0.1);
  deepEqual(Array.from(gif.frames[1]?.rgba.slice(20, 24) ?? []), [200, 0, 0, 255]);
  equal(spriteGifPreview(new Uint8Array([1, 2, 3]), "Misc/broken.gif"), null);
});
