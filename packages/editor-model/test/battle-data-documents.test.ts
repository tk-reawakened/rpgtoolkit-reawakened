// Story 13.10 (T-57, T-58): the special move and status effect documents. Every expected byte comes from the committed
// annotated listings (docs/spec/examples/listings/fireball.spc.txt, burn.ste.txt), patched by hand at the offsets they
// give, never from the writer under test.
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BinaryReader, readSpecialMove, readStatusEffect, writeSpecialMove, writeStatusEffect } from "@tk-reawakened/core";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import {
  createDocumentIdentity,
  describeLinkedStatusEffect,
  kindForPath,
  openSpecialMoveDocument,
  openStatusEffectDocument,
} from "../src/index.ts";

const SPC = "SpcMove/fireball.spc";
const STE = "StatusE/burn.ste";
const fireball = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/game/Game/Example/SpcMove/fireball.spc", import.meta.url)));
const burn = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/game/Game/Example/StatusE/burn.ste", import.meta.url)));
const textSpc = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/special-move/special_text.spc", import.meta.url)));
const textSte = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/status-effect/status_text.ste", import.meta.url)));

// fireball.spc offsets (listing): fp 0x1e (i32), smp 0x22 (i32), prg 0x26, targetSmp 0x33 (i32), battle 0x37, menu 0x38.
const FP = 0x1e;
const SMP = 0x22;
const TARGET_SMP = 0x33;
const BATTLE = 0x37;
const MENU = 0x38;
// burn.ste offsets (listing): rounds 0x1a, speed 0x1c, slow 0x1e, disable 0x20, hp 0x22, hpAmount 0x24, smp 0x26, smpAmount 0x28, code 0x2a (all i16).
const ROUNDS = 0x1a;
const SPEED = 0x1c;
const SLOW = 0x1e;
const DISABLE = 0x20;
const HP_FLAG = 0x22;
const HP_AMOUNT = 0x24;
const SMP_FLAG = 0x26;
const SMP_AMOUNT = 0x28;
const CODE = 0x2a;

const patched = (original: Uint8Array, edits: Readonly<Record<number, readonly number[]>>): Uint8Array => {
  const copy = original.slice();
  for (const [at, bytes] of Object.entries(edits)) copy.set(bytes, Number(at));
  return copy;
};
const i32 = (value: number): number[] => [value & 255, (value >> 8) & 255, (value >> 16) & 255, (value >>> 24) & 255];
const i16 = (value: number): number[] => [value & 255, (value >> 8) & 255];

async function openMove(bytes: Uint8Array = fireball) {
  const host = createMemoryPlatformServices({ files: { [SPC]: bytes } });
  const opened = await openSpecialMoveDocument(host.fs, createDocumentIdentity("memory-project", SPC));
  ok(opened.ok);
  return { host, doc: opened.document };
}

async function openStatus(bytes: Uint8Array = burn) {
  const host = createMemoryPlatformServices({ files: { [STE]: bytes } });
  const opened = await openStatusEffectDocument(host.fs, createDocumentIdentity("memory-project", STE));
  ok(opened.ok);
  return { host, doc: opened.document };
}

test("the registry claims .spc and .ste for the two editors", () => {
  equal(kindForPath("SpcMove/Fireball.SPC")?.id, "special-move");
  equal(kindForPath("StatusE/burn.ste")?.id, "status-effect");
});

test("a special move shows its stored fields with the usability bytes inverted: stored 0 is usable", async () => {
  const { doc } = await openMove();
  const snapshot = doc.getSnapshot();
  equal(snapshot.name, "Fireball");
  equal(snapshot.damage, 12);
  equal(snapshot.smpCost, 5);
  equal(snapshot.program, "fireball.prg");
  equal(snapshot.statusEffect, "burn.ste");
  equal(snapshot.description, "Hurls a ball of fire.");
  // The committed fireball stores battle = 1 and menu = 0.
  deepEqual([snapshot.battleByte, snapshot.menuByte], [1, 0]);
  deepEqual([snapshot.usableInBattle, snapshot.usableFromMenu], [false, true]);
  equal(snapshot.readOnly, null);
  deepEqual(doc.serialize(), fireball, "opening writes nothing");
});

test("choosing usable writes 0 and not usable writes 1, touching no other byte", async () => {
  const { host, doc } = await openMove();
  ok(doc.apply({ type: "set-special-move-usable", context: "battle", usable: true }).ok);
  ok(doc.apply({ type: "set-special-move-usable", context: "menu", usable: false }).ok);
  deepEqual(doc.serialize(), patched(fireball, { [BATTLE]: [0], [MENU]: [1] }));
  deepEqual([doc.getSnapshot().usableInBattle, doc.getSnapshot().usableFromMenu], [true, false]);
  ok((await doc.save()).ok);
  const reopened = await openSpecialMoveDocument(host.fs, createDocumentIdentity("memory-project", SPC));
  ok(reopened.ok);
  deepEqual([reopened.document.getSnapshot().usableInBattle, reopened.document.getSnapshot().usableFromMenu], [true, false]);
  deepEqual(reopened.document.serialize(), patched(fireball, { [BATTLE]: [0], [MENU]: [1] }));
});

test("an authored -1 or 2 stays as stored until the author chooses usable, and 'not usable' on it is refused as already true", async () => {
  const authored = patched(fireball, { [BATTLE]: [0xff], [MENU]: [2] });
  const { doc } = await openMove(authored);
  deepEqual([doc.getSnapshot().usableInBattle, doc.getSnapshot().usableFromMenu], [false, false]);
  deepEqual(doc.serialize(), authored);
  const already = doc.apply({ type: "set-special-move-usable", context: "battle", usable: false });
  ok(!already.ok);
  equal(already.rejection.reason, "invalid");
  deepEqual(doc.serialize(), authored, "a refused command changes nothing");
  ok(doc.apply({ type: "set-special-move-usable", context: "battle", usable: true }).ok);
  deepEqual(doc.serialize(), patched(authored, { [BATTLE]: [0] }), "the untouched menu byte keeps its 2");
  ok(!doc.apply({ type: "set-special-move-usable", context: "battle", usable: true }).ok, "already usable");
});

test("damage, costs and drain are signed 32-bit values stored as entered; a negative damage heals", async () => {
  const { host, doc } = await openMove();
  ok(doc.apply({ type: "set-special-move-amount", field: "damage", value: -30 }).ok);
  ok(doc.apply({ type: "set-special-move-amount", field: "smpCost", value: -2 }).ok);
  ok(doc.apply({ type: "set-special-move-amount", field: "targetSmpDrain", value: 2_147_483_647 }).ok);
  const expected = patched(fireball, { [FP]: i32(-30), [SMP]: i32(-2), [TARGET_SMP]: i32(2_147_483_647) });
  deepEqual(doc.serialize(), expected);
  ok((await doc.save()).ok);
  const reopened = await openSpecialMoveDocument(host.fs, createDocumentIdentity("memory-project", SPC));
  ok(reopened.ok);
  const snapshot = reopened.document.getSnapshot();
  deepEqual([snapshot.damage, snapshot.smpCost, snapshot.targetSmpDrain], [-30, -2, 2_147_483_647]);
  for (const value of [2_147_483_648, -2_147_483_649, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const refused = doc.apply({ type: "set-special-move-amount", field: "damage", value });
    ok(!refused.ok, `${value} is refused`);
  }
  deepEqual(doc.serialize(), expected, "refused values wrote nothing");
});

test("text fields are stored as entered; NUL, text the code page cannot hold and no-ops are refused whole", async () => {
  const { doc } = await openMove();
  ok(doc.apply({ type: "set-special-move-text", field: "name", value: "Inferno" }).ok);
  ok(doc.apply({ type: "set-special-move-text", field: "statusEffect", value: "" }).ok);
  ok(doc.apply({ type: "set-special-move-text", field: "animation", value: "boom.anm" }).ok);
  ok(doc.apply({ type: "set-special-move-text", field: "description", value: "Café fire." }).ok);
  const snapshot = doc.getSnapshot();
  deepEqual([snapshot.name, snapshot.statusEffect, snapshot.animation, snapshot.description], ["Inferno", "", "boom.anm", "Café fire."]);
  const before = doc.serialize();
  for (const command of [
    { type: "set-special-move-text", field: "name", value: "A\u0000B" },
    { type: "set-special-move-text", field: "name", value: "\u4e2d" },
    { type: "set-special-move-text", field: "name", value: "Inferno" },
  ] as const) {
    const refused = doc.apply(command);
    ok(!refused.ok, JSON.stringify(command));
    equal(refused.rejection.reason, "invalid");
  }
  deepEqual(doc.serialize(), before);
});

test("minor 3 and bytes after the description survive an edit, and undo returns the exact original bytes", async () => {
  const withResidue = new Uint8Array([...patched(fireball, { 0x13: [3] }), 0xde, 0xad, 0x00, 0xbe]);
  const { host, doc } = await openMove(withResidue);
  equal(doc.getSnapshot().minor, 3);
  equal(doc.getSnapshot().residueBytes, 4);
  const edited = doc.apply({ type: "set-special-move-amount", field: "damage", value: 99 });
  ok(edited.ok);
  deepEqual(doc.serialize(), patched(withResidue, { [FP]: i32(99) }));
  ok(doc.undo(edited.editId).ok);
  deepEqual(doc.serialize(), withResidue);
  ok(doc.apply({ type: "set-special-move-amount", field: "damage", value: 99 }).ok);
  ok((await doc.save()).ok);
  deepEqual(host.bytesOf(SPC), patched(withResidue, { [FP]: i32(99) }));
});

test("a Toolkit 2 text special move opens read-only with the reason and accepts no edit", async () => {
  const { host, doc } = await openMove(textSpc);
  equal(doc.getSnapshot().minor, 0);
  equal(doc.getSnapshot().readOnly?.code, "no-same-version-writer");
  ok(doc.getSnapshot().name.length > 0);
  const refused = doc.apply({ type: "set-special-move-amount", field: "damage", value: 5 });
  ok(!refused.ok);
  equal(refused.rejection.reason, "read-only");
  equal((await doc.save()).ok, false);
  deepEqual(host.bytesOf(SPC), textSpc);
});

test("a status effect lists its stored fields; a flag is on exactly when its value is non-zero", async () => {
  const { doc } = await openStatus();
  const snapshot = doc.getSnapshot();
  equal(snapshot.name, "Burn");
  equal(snapshot.rounds, 3);
  deepEqual([snapshot.hpEnabled, snapshot.hpPerRound, snapshot.smpEnabled, snapshot.smpPerRound], [true, 2, false, 0]);
  deepEqual([snapshot.speedUp, snapshot.slowDown, snapshot.disable, snapshot.runProgram], [false, false, false, false]);
  deepEqual(doc.serialize(), burn);
});

test("rounds and per-round amounts are signed 16-bit values; a negative amount heals and nothing is clamped", async () => {
  const { host, doc } = await openStatus();
  ok(doc.apply({ type: "set-status-effect-number", field: "rounds", value: 0 }).ok);
  ok(doc.apply({ type: "set-status-effect-number", field: "hpPerRound", value: -7 }).ok);
  ok(doc.apply({ type: "set-status-effect-number", field: "smpPerRound", value: -32_768 }).ok);
  const expected = patched(burn, { [ROUNDS]: i16(0), [HP_AMOUNT]: i16(-7), [SMP_AMOUNT]: i16(-32_768) });
  deepEqual(doc.serialize(), expected);
  ok((await doc.save()).ok);
  const reopened = await openStatusEffectDocument(host.fs, createDocumentIdentity("memory-project", STE));
  ok(reopened.ok);
  deepEqual([reopened.document.getSnapshot().rounds, reopened.document.getSnapshot().hpPerRound, reopened.document.getSnapshot().smpPerRound], [0, -7, -32_768]);
  for (const value of [32_768, -32_769, 0.5, Number.NaN]) {
    ok(!doc.apply({ type: "set-status-effect-number", field: "hpPerRound", value }).ok, `${value} is refused`);
  }
  deepEqual(doc.serialize(), expected);
});

test("turning a flag on writes 1, off writes 0, and an authored non-zero value is kept until the flag is turned off", async () => {
  const authored = patched(burn, { [SPEED]: i16(-1), [SLOW]: i16(7) });
  const { doc } = await openStatus(authored);
  deepEqual([doc.getSnapshot().speedUp, doc.getSnapshot().slowDown], [true, true]);
  deepEqual(doc.getSnapshot().rawFlags, { speedUp: -1, slowDown: 7, disable: 0, hpEnabled: 1, smpEnabled: 0, runProgram: 0 });
  const already = doc.apply({ type: "set-status-effect-flag", field: "speedUp", enabled: true });
  ok(!already.ok);
  equal(already.rejection.reason, "invalid");
  deepEqual(doc.serialize(), authored, "turning on what is already on keeps the authored -1");
  ok(doc.apply({ type: "set-status-effect-flag", field: "disable", enabled: true }).ok);
  ok(doc.apply({ type: "set-status-effect-flag", field: "smpEnabled", enabled: true }).ok);
  ok(doc.apply({ type: "set-status-effect-flag", field: "runProgram", enabled: true }).ok);
  ok(doc.apply({ type: "set-status-effect-flag", field: "slowDown", enabled: false }).ok);
  ok(doc.apply({ type: "set-status-effect-flag", field: "hpEnabled", enabled: false }).ok);
  deepEqual(doc.serialize(), patched(authored, { [DISABLE]: i16(1), [SMP_FLAG]: i16(1), [CODE]: i16(1), [SLOW]: i16(0), [HP_FLAG]: i16(0) }));
  ok(!doc.apply({ type: "set-status-effect-flag", field: "slowDown", enabled: false }).ok, "already off");
});

test("status effect text, minor 3 and trailing bytes are kept; undo restores the bytes", async () => {
  const withResidue = new Uint8Array([...patched(burn, { 0x13: [3] }), 1, 2, 3]);
  const { doc } = await openStatus(withResidue);
  equal(doc.getSnapshot().residueBytes, 3);
  const edited = doc.apply({ type: "set-status-effect-text", field: "program", value: "smoke.prg" });
  ok(edited.ok);
  equal(doc.getSnapshot().program, "smoke.prg");
  ok(doc.serialize().slice(-3).every((byte, index) => byte === [1, 2, 3][index]));
  ok(doc.undo(edited.editId).ok);
  deepEqual(doc.serialize(), withResidue);
  ok(!doc.apply({ type: "set-status-effect-text", field: "name", value: "a\u0000" }).ok);
  ok(!doc.apply({ type: "set-status-effect-text", field: "name", value: "Burn" }).ok);
});

test("a Toolkit 2 text status effect opens read-only with the reason and accepts no edit", async () => {
  const { host, doc } = await openStatus(textSte);
  equal(doc.getSnapshot().minor, 0);
  equal(doc.getSnapshot().readOnly?.code, "no-same-version-writer");
  const refused = doc.apply({ type: "set-status-effect-flag", field: "disable", enabled: true });
  ok(!refused.ok);
  equal(refused.rejection.reason, "read-only");
  equal((await doc.save()).ok, false);
  deepEqual(host.bytesOf(STE), textSte);
});

test("a command that arrives from outside is accepted only in the shape of its kind", () => {
  const move = kindForPath(SPC)!;
  const status = kindForPath(STE)!;
  ok(move.isCommand({ type: "set-special-move-usable", context: "menu", usable: true }));
  ok(!move.isCommand({ type: "set-special-move-usable", context: "elsewhere", usable: true }));
  ok(!move.isCommand({ type: "set-special-move-amount", field: "name", value: 1 }));
  ok(!move.isCommand({ type: "set-status-effect-flag", field: "disable", enabled: true }));
  ok(status.isCommand({ type: "set-status-effect-flag", field: "disable", enabled: false }));
  ok(!status.isCommand({ type: "set-status-effect-flag", field: "name", enabled: false }));
  ok(!status.isCommand({ type: "set-status-effect-number", field: "rounds", value: "3" }));
});

test("a linked status effect is described from its saved bytes, and an unreadable file says so", () => {
  const described = describeLinkedStatusEffect(patched(burn, { [HP_AMOUNT]: i16(-4), [SPEED]: i16(1) }), STE);
  ok(described.ok);
  equal(described.name, "Burn");
  equal(described.rounds, 3);
  deepEqual(described.effects, ["speeds up the fighter's charge", "restores 4 HP each round"]);
  equal(described.text, "Burn: 3 rounds; speeds up the fighter's charge; restores 4 HP each round.");
  const damaging = describeLinkedStatusEffect(burn, STE);
  ok(damaging.ok);
  deepEqual(damaging.effects, ["removes 2 HP each round"]);
  const broken = describeLinkedStatusEffect(new Uint8Array([1, 2, 3]), "StatusE/bad.ste");
  ok(!broken.ok);
  ok(broken.message.includes("StatusE/bad.ste"));
});

test("the saved bytes are exactly the core writer's output, which is what the real battle provider loads", async () => {
  // The provider proof (packages/core/test/battle-data-editor-provider.test.ts) can only reach the core writers, so this
  // case ties the editor's save to them directly: the same bytes, not merely the same fields.
  const { doc } = await openStatus();
  ok(doc.apply({ type: "set-status-effect-number", field: "hpPerRound", value: 4 }).ok);
  ok(doc.apply({ type: "set-status-effect-number", field: "rounds", value: 2 }).ok);
  const read = readStatusEffect(new BinaryReader(burn));
  ok(read.ok);
  const written = writeStatusEffect({ ...read.value, rounds: 2, hpPerRound: 4 });
  ok(written.ok);
  deepEqual(doc.serialize(), written.value);
  const { doc: move } = await openMove();
  ok(move.apply({ type: "set-special-move-amount", field: "damage", value: -12 }).ok);
  const moveRead = readSpecialMove(new BinaryReader(fireball));
  ok(moveRead.ok);
  const moveWritten = writeSpecialMove({ ...moveRead.value, damage: -12 });
  ok(moveWritten.ok);
  deepEqual(move.serialize(), moveWritten.value);
});
