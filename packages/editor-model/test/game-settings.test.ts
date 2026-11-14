// Story 11.6 (#1704): every game setting of editor-features T-10 to T-14 through the main-file document's one staged
// command. The oracle is the core reader: a saved file must read back as the original model with exactly the hand-written
// row changes below, and the bytes the editor does not read must be the ones it was given.
import { test } from "node:test";
import { deepEqual, equal, match, ok } from "node:assert/strict";
import { BinaryReader, readMainFile, type MainFile } from "@tk-reawakened/core";
import { createMemoryPlatformServices, type MemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import {
  createDocumentIdentity,
  mainCodec,
  mainSettingsNotes,
  openMainDocument,
  pluginSources,
  scanCodeOfKey,
  settingsWarnings,
  type MainDocument,
  type MainSettingsChanges,
} from "../src/index.ts";
import { concat, exampleMain, trailingBlocks } from "./fixtures.ts";

const PATH = "Main/example.gam";
const identity = createDocumentIdentity("memory-project", PATH);

async function opened(bytes: Uint8Array): Promise<{ readonly host: MemoryPlatformServices; readonly doc: MainDocument }> {
  const host = createMemoryPlatformServices({ files: { [PATH]: bytes } });
  const result = await openMainDocument(host.fs, identity);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return { host, doc: result.document };
}

function read(bytes: Uint8Array): MainFile {
  const result = readMainFile(new BinaryReader(bytes));
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function storedBytes(host: MemoryPlatformServices): Uint8Array {
  const bytes = host.bytesOf(PATH);
  ok(bytes !== undefined, "the file is still there");
  return bytes;
}

test("one Apply changes a field in every T-10 to T-14 category; saved and reopened, only those rows changed and unknown bytes survive", async () => {
  const original = concat(exampleMain(9), trailingBlocks());
  const before = read(original);
  const { host, doc } = await opened(original);
  const extKeys = before.extKeys.map((row, slot) => (slot === 0 ? { asciiKey: 72, program: "help.prg" } : row));
  const enemies = before.enemies.map((row, slot) => (slot === 1 ? { enemyFile: "bat.ene", skillLevel: 3 } : row));
  const changes: MainSettingsChanges = {
    // T-10
    useJoystick: false,
    mouseMovement: false,
    movementScanCodes: [0x20, 0, 0x1f, 0, 0x1e, 0, 0x11, 0],
    cursorMoveSound: "move.wav",
    defaultSoundFont: "media/gm.sf2",
    // T-11
    initBoard: "forest.brd",
    runTimeKey: 82,
    extKeys,
    gameSpeed: -2,
    mouseCursor: "arrow.bmp",
    hotSpotX: 3,
    pathfindHeuristic: 3,
    // T-12
    battlesEnabled: false,
    enemies,
    fightType: 1,
    chances: 12,
    // T-13
    resolution: 4,
    resX: 960,
    resY: 540,
    showFpsInTitle: true,
    drawVectorsFlags: 1 | 4,
    pathColor: { r: 10, g: 200, b: 30 },
    // T-14
    menuPlugin: "",
    packages: ["stock_battle", "stock_menu", "someone_elses_pack"],
  };
  const applied = doc.apply({ type: "apply-settings", changes });
  ok(applied.ok, applied.ok ? "" : applied.rejection.message);
  equal(doc.getSnapshot().edits.length, 1, "the whole staged set is one edit");
  equal(doc.getSnapshot().dirty, true);
  deepEqual(storedBytes(host), original, "Apply changes the document, not the file");
  ok((await doc.save()).ok);

  const after = read(storedBytes(host));
  deepEqual(after, {
    ...before,
    useJoystick: 0,
    movementControls: before.movementControls & ~2,
    movementScanCodes: [0x20, 0, 0x1f, 0, 0x1e, 0, 0x11, 0],
    cursorMoveSound: "move.wav",
    audioSettings: { ...before.audioSettings!, defaultSoundFont: "media/gm.sf2" },
    initBoard: "forest.brd",
    runTimeKey: 82,
    extKeys,
    gameSpeed: -2,
    mouseCursor: "arrow.bmp",
    hotSpotX: 3,
    pathfindHeuristic: 3,
    fightingDisabled: 1,
    enemies,
    fightType: 1,
    chances: 12,
    resolution: 4,
    resX: 960,
    resY: 540,
    showFpsInTitle: 1,
    drawVectorsFlags: 5,
    pathColor: { r: 10, g: 200, b: 30 },
    menuPlugin: "",
    packagePlugins: ["stock_battle", "stock_menu", "someone_elses_pack"],
  });
  deepEqual(after.residue, Uint8Array.from([0xde, 0xad, 0xbe, 0xef]), "bytes after the last block the editor reads are kept");

  const reopened = await opened(storedBytes(host));
  const settings = reopened.doc.getSnapshot().settings;
  equal(settings.initBoard, "forest.brd");
  equal(settings.defaultSoundFont, "media/gm.sf2");
  deepEqual(settings.packages, ["stock_battle", "stock_menu", "someone_elses_pack"]);
  equal(settings.battlesEnabled, false);
  equal(reopened.doc.getSnapshot().dirty, false);
});

test("undoing an Apply writes the original bytes back exactly", async () => {
  const original = concat(exampleMain(9), trailingBlocks());
  const { host, doc } = await opened(original);
  ok(doc.apply({ type: "apply-settings", changes: { colorDepth: 2, initChar: "bob.tem", packages: [] } }).ok);
  ok(doc.undo().ok);
  equal(doc.getSnapshot().dirty, false);
  ok(doc.apply({ type: "apply-settings", changes: { colorDepth: 2 } }).ok);
  ok(doc.apply({ type: "apply-settings", changes: { colorDepth: 0 } }).ok);
  ok((await doc.save()).ok);
  deepEqual(storedBytes(host), original);
});

test("a refused Apply changes nothing and names each field it refuses", async () => {
  const original = exampleMain(9);
  const { host, doc } = await opened(original);
  const before = doc.getSnapshot();
  const result = doc.apply({ type: "apply-settings", changes: { gameSpeed: 9, initBoard: "snow\u2603.brd", packages: ["a", "A"], runTimeKey: 1.5 } });
  ok(!result.ok);
  match(result.rejection.message, /Game speed .*from -4 to 4/);
  match(result.rejection.message, /Initial board: .*U\+2603/);
  match(result.rejection.message, /"A" is listed twice/);
  match(result.rejection.message, /Run-time key .*whole number/);
  equal(doc.getSnapshot(), before, "no new snapshot");
  equal(doc.getSnapshot().edits.length, 0);
  ok((await doc.save()).ok);
  deepEqual(storedBytes(host), original);
  const nothing = doc.apply({ type: "apply-settings", changes: { colorDepth: before.settings.colorDepth } });
  ok(!nothing.ok);
  match(nothing.rejection.message, /already in force/);
});

test("an older file keeps its version: rows it does not store are refused and disclosed with the engine's value", async () => {
  const { doc } = await opened(exampleMain(3));
  const snapshot = doc.getSnapshot();
  equal(snapshot.settings.pathfindHeuristic, 2, "absent row 57 is diagonal for the engine");
  deepEqual(snapshot.settings.movementScanCodes, [0xcd, 0, 0xd0, 0, 0xcb, 0, 0xc8, 0], "absent row 61 is the arrow keys");
  ok(snapshot.notes.some((note) => /minor 3\. It does not store .*default path-finding/.test(note.message)));
  const refused = doc.apply({ type: "apply-settings", changes: { pathfindHeuristic: 1 } });
  ok(!refused.ok);
  match(refused.rejection.message, /minor 3, which does not store it \(minor 9 and later do\)/);
  const custom = doc.apply({ type: "apply-settings", changes: { resolution: 4 } });
  ok(!custom.ok, "a custom size needs rows 54–55");
  ok(doc.apply({ type: "apply-settings", changes: { colorDepth: 1, useJoystick: false, cursorSelectSound: "ok.wav" } }).ok, "rows minor 3 stores are editable");
  equal(doc.getSnapshot().minor, 3);
  const minor5 = await opened(exampleMain(5));
  ok(!minor5.doc.apply({ type: "apply-settings", changes: { mouseCursor: "arrow.bmp" } }).ok, "minor 5 stores only on or off");
  ok(minor5.doc.apply({ type: "apply-settings", changes: { mouseCursor: "" } }).ok);
  equal(minor5.doc.getSnapshot().settings.mouseCursor, "");
});

test("legacy values the editor does not offer are kept and disclosed; a flag keeps its stored truth value", async () => {
  const base = read(exampleMain(9));
  const legacy: MainFile = { ...base, pathfindHeuristic: 0, fightingDisabled: -1, colorDepth: 7, movementScanCodes: [0xcd, 0, 0xd0, 0, 0xcb, 0, 0xc8, 0xfe] };
  const written = mainCodec.write(legacy);
  ok(written.ok);
  const { host, doc } = await opened(written.value);
  const messages = doc.getSnapshot().notes.map((note) => note.message).join("\n");
  match(messages, /Default path-finding is stored as 0/);
  match(messages, /Colour depth is stored as 7/);
  match(messages, /Random battles are off, stored as -1/);
  match(messages, /North-east is bound to DirectInput scan code 0xfe/);
  ok(doc.apply({ type: "apply-settings", changes: { initBoard: "other.brd", movementScanCodes: [0xcd, 0x51, 0xd0, 0, 0xcb, 0, 0xc8, 0xfe] } }).ok, "an untouched unmappable slot is not refused");
  ok((await doc.save()).ok);
  const after = read(storedBytes(host));
  equal(after.pathfindHeuristic, 0);
  equal(after.fightingDisabled, -1);
  equal(after.colorDepth, 7);
  equal(after.initBoard, "other.brd");
  ok(doc.apply({ type: "apply-settings", changes: { battlesEnabled: true } }).ok);
  equal(doc.getSnapshot().settings.battlesEnabled, true);
  ok((await doc.save()).ok);
  equal(read(storedBytes(host)).fightingDisabled, 0);
});

test("the SoundFont uses the existing audio block: absent block gains the engine defaults plus the font; null on no block is no change", async () => {
  const original = exampleMain(9);
  const { host, doc } = await opened(original);
  equal(doc.getSnapshot().settings.defaultSoundFont, null);
  ok(!doc.apply({ type: "apply-settings", changes: { defaultSoundFont: null } }).ok);
  ok(doc.apply({ type: "apply-settings", changes: { defaultSoundFont: "media/gm.sf2" } }).ok);
  ok((await doc.save()).ok);
  deepEqual(read(storedBytes(host)).audioSettings, {
    tracks: [{ name: "music", voiceCount: 1 }, { name: "sfx", voiceCount: 1 }, { name: "ambience", voiceCount: 4 }, { name: "voice", voiceCount: 2 }, { name: "ui", voiceCount: 4 }],
    voiceCap: 32,
    defaultSoundFont: "media/gm.sf2",
  });
  ok(doc.apply({ type: "apply-settings", changes: { defaultSoundFont: null } }).ok);
  ok((await doc.save()).ok);
  equal(read(storedBytes(host)).audioSettings?.defaultSoundFont, null, "the block stays; its font flag says none");
});

test("plugin sources say what the game starts with and which row owns it; an unknown package is a warning, never enabled by the editor", () => {
  const base = read(exampleMain(9));
  const sources = pluginSources({ ...base, menuPlugin: "tk3menu.dll", fightPlugin: "myfight.dll", packagePlugins: ["Stock_Battle", "mystery"] });
  deepEqual(sources.map((source) => [source.package, source.owner]), [
    ["stock_battle", "the TKR package list"],
    ["mystery", "the TKR package list"],
    ["stock_menu", 'the legacy menu plugin row ("tk3menu.dll")'],
    [null, 'the legacy battle plugin row ("myfight.dll")'],
  ]);
  match(sources[3]!.detail, /plugin\.legacy-unmapped/);
  const warnings = settingsWarnings({ ...mainCodec.fields(base).settings, packages: ["mystery"] }, 9);
  ok(warnings.some((issue) => issue.key === "packages" && /not a package this editor knows/.test(issue.message)));
});

test("conflicts are warnings: a key on two directions, one ASCII code on two jobs, a key with no program", () => {
  const settings = mainCodec.fields(read(exampleMain(9))).settings;
  const d = scanCodeOfKey("KeyD");
  equal(d, 0x20);
  equal(scanCodeOfKey("NoSuchKey"), null);
  const warnings = settingsWarnings({
    ...settings,
    movementScanCodes: [0x20, 0x20, 0, 0, 0, 0, 0, 0],
    menuKey: 13,
    activationKey: 13,
    extKeys: [{ asciiKey: 65, program: "" }],
  }, 9).map((issue) => issue.message);
  ok(warnings.includes("KeyD moves the player East and South-east."), warnings.join("\n"));
  ok(warnings.includes("Enter is the menu key and the activation key."), warnings.join("\n"));
  ok(warnings.includes('Extended run-time key 1 ("A") has no program, so the game ignores it.'), warnings.join("\n"));
});

test("a command from a webview is applied only when every value has its setting's shape", () => {
  const valid = { type: "apply-settings", changes: { initBoard: "a.brd", pathColor: { r: 1, g: 2, b: 3 }, extKeys: [{ asciiKey: 1, program: "p" }], defaultSoundFont: null } };
  ok(mainCodec.isCommand(valid));
  for (const changes of [
    { unknownField: 1 },
    { initBoard: 3 },
    { battlesEnabled: "yes" },
    { pathColor: { r: 1, g: 2 } },
    { extKeys: [{ asciiKey: "A", program: "p" }] },
    { chances: Number.NaN },
    { packages: "stock_menu" },
    [],
  ]) {
    equal(mainCodec.isCommand({ type: "apply-settings", changes }), false, JSON.stringify(changes));
  }
  equal(mainCodec.isCommand({ type: "apply-settings" }), false);
});

test("the notes disclose kept data and stored-only rows", () => {
  const notes = mainSettingsNotes({ ...read(exampleMain(9)), residue: Uint8Array.from([1, 2]) }).map((note) => note.message);
  ok(notes.some((message) => /2 bytes after the last block this editor reads/.test(message)));
  ok(notes.some((message) => /Stored-only fields/.test(message)));
});

test("a TKR input block and unknown residue survive when package and audio settings are edited", async () => {
  const inputBlock = Uint8Array.from([84, 82, 75, 73, 78, 80, 0, 1, 1, 0, 0]);
  const opaque = Uint8Array.from([0xde, 0xad, 0xbe, 0xef]);
  const { host, doc } = await opened(concat(exampleMain(9), inputBlock, opaque));
  const result = doc.apply({ type: "apply-settings", changes: { packages: ["stock_menu"], defaultSoundFont: "media/gm.sf2" } });
  ok(result.ok, result.ok ? "" : result.rejection.message);
  ok((await doc.save()).ok);
  const written = storedBytes(host);
  const decoded = read(written);
  deepEqual(decoded.inputSettings, { controllerEnabled: true, actions: {} });
  deepEqual(decoded.residue, opaque);
  deepEqual(
    written.subarray(written.length - inputBlock.length - opaque.length),
    concat(inputBlock, opaque),
    "the recognized input block and unknown trailing bytes remain byte-identical",
  );
});
