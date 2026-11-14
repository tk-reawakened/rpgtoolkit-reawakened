import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { createDocumentIdentity, openSpriteDocument, spriteAnimationPreview, spriteGifPreview, spritePicturePreview, type SpriteActorKind, type SpriteDocument } from "../src/index.ts";
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

test("sprite previews use the documented ANM, image and shared GIF decoders", () => {
  const animation = spriteAnimationPreview(exampleAnimation(), "Misc/animation_minor3.anm");
  ok(animation !== null);
  deepEqual(animation.images, ["village.tst15", "village.tst16"]);
  equal(animation.delay, 0.15);

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
