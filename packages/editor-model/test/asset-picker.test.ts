// Reserved folders, relative links and the folder-aware picker (T-05, story 11.4): links keep sub-folders, a file from
// outside is copied in and never over another file, and nothing is attached until the user confirms.
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { platformError, platformOk } from "@tk-reawakened/platform-services";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { copyIntoReservedFolder, createAssetPicker, linkFor, listCandidates, referencePath, reservedFolder, unusableName } from "../src/index.ts";
import { projectLayoutForDocumentPath, projectLayoutOwnerForDocumentPath } from "../src/reserved-folders.ts";
const ROOT = { projectFolder: "" };
const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);

test("a document selects its owning game's exact-case layout", () => {
  deepEqual(projectLayoutForDocumentPath("Game/Example/Boards/nested/Map.brd"), { projectFolder: "Game/Example" });
  deepEqual(projectLayoutForDocumentPath("gAmE/MyGame/Boards/sub/map.brd"), { projectFolder: "gAmE/MyGame" });
  deepEqual(projectLayoutForDocumentPath("Boards/nested/Map.brd"), { projectFolder: "" });
  deepEqual(projectLayoutForDocumentPath("Game/Example/Prg/start.prg"), { projectFolder: "Game/Example" });
  deepEqual(projectLayoutForDocumentPath("Game/Example/Item/nested/chest.itm"), { projectFolder: "Game/Example" });
  deepEqual(projectLayoutForDocumentPath("Game/Example/Misc/chest.anm"), { projectFolder: "Game/Example" });
  deepEqual(projectLayoutForDocumentPath("samples/Game/MyGame/Bitmap/art.tbm"), { projectFolder: "samples/Game/MyGame" });
});
test("a game layout supports multiple nested project path components", () => {
  deepEqual(projectLayoutForDocumentPath("Game/a/b/Boards/nested/Map.brd"), { projectFolder: "Game/a/b" });
  deepEqual(projectLayoutForDocumentPath("Game/A/Tiles/B/Boards/map.brd"), { projectFolder: "Game/A/Tiles/B" });
  deepEqual(projectLayoutForDocumentPath("Game/Quest/Boards/Region/Boards/map.brd"), { projectFolder: "Game/Quest/Boards/Region" });
});

test("declared main layouts own nested board folders, not the last reserved folder in a path", () => {
  const owners = [
    { mainPath: "Main/quest.gam", layout: { projectFolder: "Game/Quest" } },
    { mainPath: "Main/other.gam", layout: { projectFolder: "Game/Other" } },
  ];
  deepEqual(projectLayoutOwnerForDocumentPath("Game/Quest/Boards/Region/Boards/Map.brd", owners), owners[0]);
  deepEqual(projectLayoutOwnerForDocumentPath("Game/Other/Boards/Map.brd", owners), owners[1]);
  deepEqual(projectLayoutOwnerForDocumentPath("Boards/Old.brd", owners), { mainPath: null, layout: ROOT });
  const rootOwner = { mainPath: "Main/Quest.gam", layout: ROOT };
  deepEqual(projectLayoutOwnerForDocumentPath("Boards/Map.brd", [rootOwner]), rootOwner);
  const nestedOwner = { mainPath: "Main/nested.gam", layout: { projectFolder: "Game/A/B" } };
  const duplicateParentOwners = [
    { mainPath: "Main/a.gam", layout: { projectFolder: "Game/A" } },
    { mainPath: "Main/other-a.gam", layout: { projectFolder: "Game/A" } },
    nestedOwner,
  ];
  deepEqual(projectLayoutOwnerForDocumentPath("Game/A/B/Boards/Map.brd", duplicateParentOwners), nestedOwner);
  deepEqual(projectLayoutOwnerForDocumentPath("Game/A/B/Boards/Map.brd", duplicateParentOwners.reverse()), nestedOwner);
});

test("a link is the path inside the type folder, sub-folders kept, with the legacy separator", () => {
  deepEqual(linkFor(ROOT, "boards", "Boards/inn.brd"), { inside: true, reference: "inn.brd" });
  deepEqual(linkFor(ROOT, "boards", "Boards/village/inn.brd"), { inside: true, reference: "village\\inn.brd" });
  deepEqual(linkFor(ROOT, "boards", "boards/VILLAGE/inn.brd"), { inside: true, reference: "VILLAGE\\inn.brd" }, "the folder matches ASCII-folded; the rest keeps its case");
  deepEqual(linkFor(ROOT, "boards", "Chrs/hero.tem"), { inside: false });
  deepEqual(linkFor(ROOT, "boards", "Boards"), { inside: false });
  deepEqual(linkFor(ROOT, "boards", "Boards/"), { inside: false });
  deepEqual(linkFor({ projectFolder: "Game/Quest" }, "tiles", "Game/Quest/Tiles/a/b.tan"), { inside: true, reference: "a\\b.tan" });
  deepEqual(linkFor({ projectFolder: "Game/Quest" }, "tiles", "Tiles/b.tan"), { inside: false }, "another project's folder is not this one's");
});

test("a reference names its path again, with or without the type-folder prefix", () => {
  equal(referencePath(ROOT, "boards", "village\\inn.brd"), "Boards/village/inn.brd");
  equal(referencePath(ROOT, "boards", "Boards\\inn.brd"), "Boards/inn.brd");
  equal(reservedFolder({ projectFolder: "/Game/Quest/" }, "characters"), "Game/Quest/Chrs");
});

test("candidates are the folder's files and sub-folders' files that the field accepts, and a missing folder is empty", async () => {
  const host = createMemoryPlatformServices({
    files: {
      "Bitmap/a.png": bytes(1),
      "Bitmap/sub/b.PNG": bytes(2),
      "Bitmap/sub/deep/c.bmp": bytes(3),
      "Bitmap/notes.txt": bytes(4),
      "Boards/x.brd": bytes(5),
    },
  });
  const png = await listCandidates(host.fs, ROOT, "bitmaps", [".png"]);
  deepEqual(png.candidates.map((candidate) => candidate.reference), ["a.png", "sub\\b.PNG"]);
  const all = await listCandidates(host.fs, ROOT, "bitmaps", []);
  equal(all.candidates.length, 4);
  deepEqual((await listCandidates(host.fs, ROOT, "fonts", [])).candidates, []);
  deepEqual((await listCandidates(host.fs, ROOT, "fonts", [])).failures, []);
});
test("legacy board candidates resolve a case-variant reserved folder on case-sensitive hosts", async () => {
  const fs = {
    list: async (path: string) => {
      if (path === "") return { ok: true as const, value: [{ name: "boards", kind: "directory" as const }] };
      if (path === "boards") return { ok: true as const, value: [{ name: "Village.brd", kind: "file" as const }] };
      return platformError("not-found", "missing");
    },
  };
  const listed = await listCandidates(fs, ROOT, "boards", [".brd"]);
  deepEqual(listed.candidates.map((candidate) => candidate.path), ["boards/Village.brd"]);
  deepEqual(listed.candidates.map((candidate) => candidate.reference), ["Village.brd"]);
  deepEqual(listed.failures, []);
});

test("legacy board candidate lookup refuses ambiguous case-variant reserved folders", async () => {
  const fs = {
    list: async (path: string) =>
      path === ""
        ? { ok: true as const, value: [{ name: "Boards", kind: "directory" as const }, { name: "boards", kind: "directory" as const }] }
        : platformError("not-found", "missing"),
  };
  const listed = await listCandidates(fs, ROOT, "boards", [".brd"]);
  deepEqual(listed.candidates, []);
  ok(listed.failures[0]?.error.message.includes("multiple entries matching Boards"));
});


test("a folder the host cannot read is reported, not hidden as an empty list", async () => {
  const host = createMemoryPlatformServices({ files: { "Bitmap/a.png": bytes(1), "Bitmap/locked/b.png": bytes(2) } });
  const fs = { list: (path: string) => (path === "Bitmap/locked" ? Promise.resolve(platformError("permission-denied", "no access")) : host.fs.list(path)) };
  const listed = await listCandidates(fs, ROOT, "bitmaps", [".png"]);
  deepEqual(listed.candidates.map((candidate) => candidate.reference), ["a.png"]);
  equal(listed.failures[0]?.path, "Bitmap/locked");
});

test("an outside file is copied into the type folder (and a sub-folder) and linked", async () => {
  const host = createMemoryPlatformServices();
  const copied = await copyIntoReservedFolder(host, ROOT, "bitmaps", { name: "hero.png", bytes: bytes(7, 8) });
  deepEqual(copied, { ok: true, reference: "hero.png", path: "Bitmap/hero.png", copied: true });
  deepEqual(host.bytesOf("Bitmap/hero.png"), bytes(7, 8));
  const nested = await copyIntoReservedFolder(host, ROOT, "bitmaps", { name: "tree.png", bytes: bytes(9) }, "scenery/forest");
  deepEqual(nested, { ok: true, reference: "scenery\\forest\\tree.png", path: "Bitmap/scenery/forest/tree.png", copied: true });
});

test("the same bytes under the same name are linked with nothing written, even if the case differs", async () => {
  const host = createMemoryPlatformServices({ files: { "Bitmap/Hero.PNG": bytes(1, 2) } });
  const copied = await copyIntoReservedFolder(host, ROOT, "bitmaps", { name: "hero.png", bytes: bytes(1, 2) });
  deepEqual(copied, { ok: true, reference: "Hero.PNG", path: "Bitmap/Hero.PNG", copied: false });
  equal(host.questions.length, 0, "an identical file is not a question");
  equal(host.bytesOf("Bitmap/hero.png") !== undefined && host.bytesOf("Bitmap/Hero.PNG") !== undefined, true);
});

test("a different file under a taken name asks, and never replaces the one there", async () => {
  const taken = (): ReturnType<typeof createMemoryPlatformServices> =>
    createMemoryPlatformServices({ files: { "Bitmap/hero.png": bytes(1), "Bitmap/hero (2).png": bytes(5) } });

  const both = taken();
  both.answerQuestions("keep-both");
  const kept = await copyIntoReservedFolder(both, ROOT, "bitmaps", { name: "hero.png", bytes: bytes(2) });
  deepEqual(kept, { ok: true, reference: "hero (3).png", path: "Bitmap/hero (3).png", copied: true });
  deepEqual(both.bytesOf("Bitmap/hero.png"), bytes(1), "the original is untouched");
  deepEqual(both.bytesOf("Bitmap/hero (2).png"), bytes(5), "a numbered file already there is untouched");
  ok(both.questions[0]?.message.includes("Bitmap/hero.png"));

  const existing = taken();
  existing.answerQuestions("use-existing");
  deepEqual(await copyIntoReservedFolder(existing, ROOT, "bitmaps", { name: "hero.png", bytes: bytes(2) }), { ok: true, reference: "hero.png", path: "Bitmap/hero.png", copied: false });
  deepEqual(existing.bytesOf("Bitmap/hero.png"), bytes(1));

  const cancelled = taken();
  cancelled.answerQuestions("cancel");
  deepEqual(await copyIntoReservedFolder(cancelled, ROOT, "bitmaps", { name: "hero.png", bytes: bytes(2) }), { ok: false, reason: "cancelled" });
  const dismissed = taken();
  deepEqual(await copyIntoReservedFolder(dismissed, ROOT, "bitmaps", { name: "hero.png", bytes: bytes(2) }), { ok: false, reason: "cancelled" }, "a dismissed question is a cancel");
  deepEqual(dismissed.bytesOf("Bitmap/hero.png"), bytes(1));
});

test("a name that is not one file name inside the folder, and a failed write, copy nothing and say why", async () => {
  const host = createMemoryPlatformServices();
  for (const name of ["", "..", "a/b.png", "a\\b.png", "nul\u0000.png"]) {
    const result = await copyIntoReservedFolder(host, ROOT, "bitmaps", { name, bytes: bytes(1) });
    ok(!result.ok && result.reason === "failed", JSON.stringify(name));
    ok(unusableName(name) !== null);
  }
  const escaped = await copyIntoReservedFolder(host, ROOT, "bitmaps", { name: "a.png", bytes: bytes(1) }, "../Boards");
  ok(!escaped.ok && escaped.reason === "failed");
  host.failWrites({ code: "permission-denied", message: "the folder is read-only" });
  const refused = await copyIntoReservedFolder(host, ROOT, "bitmaps", { name: "a.png", bytes: bytes(1) });
  ok(!refused.ok && refused.reason === "failed" && refused.message.includes("the folder is read-only"));
  equal(host.bytesOf("Bitmap/a.png"), undefined);
});

const picker = (host: ReturnType<typeof createMemoryPlatformServices>, extensions = [".png"]) =>
  createAssetPicker({ services: host, layout: ROOT, kind: "bitmaps", extensions, field: "the hero's picture" });

test("selecting changes nothing until it is confirmed, and cancelling leaves the reference unresolved", async () => {
  const host = createMemoryPlatformServices({ files: { "Bitmap/a.png": bytes(1), "Bitmap/sub/b.png": bytes(2) } });
  const chooser = picker(host);
  await chooser.refresh();
  deepEqual(chooser.getSnapshot().candidates.map((candidate) => candidate.reference), ["a.png", "sub\\b.png"]);
  equal(await chooser.confirm().then((outcome) => outcome.chosen), false, "nothing selected: nothing to confirm");
  ok(chooser.getSnapshot().message?.includes("Select a file first"));

  chooser.select("sub\\b.png");
  equal(chooser.getSnapshot().selected, "sub\\b.png");
  equal(chooser.getSnapshot().phase, "browsing", "a selection alone attaches nothing");
  host.answerQuestions("cancel");
  deepEqual(await chooser.confirm(), { chosen: false });
  equal(chooser.getSnapshot().phase, "browsing", "a cancelled confirmation leaves the picker open for another choice");
  ok(host.questions[0]?.message.includes("the hero's picture"));

  host.answerQuestions("use");
  deepEqual(await chooser.confirm(), { chosen: true, reference: "sub\\b.png" });
  equal(chooser.getSnapshot().phase, "closed");
});

test("a dismissed confirmation, a cancel and a vanished file all choose nothing", async () => {
  const host = createMemoryPlatformServices({ files: { "Bitmap/a.png": bytes(1) } });
  const chooser = picker(host);
  await chooser.refresh();
  chooser.select("a.png");
  deepEqual(await chooser.confirm(), { chosen: false }, "no answer is queued, so the question is dismissed");
  chooser.select("missing.png");
  equal(chooser.getSnapshot().selected, "a.png", "a reference that is not offered is refused");
  await host.fs.delete("Bitmap/a.png");
  await chooser.refresh();
  equal(chooser.getSnapshot().selected, null, "the selection of a deleted file is dropped");
  deepEqual(chooser.cancel(), { chosen: false });
  equal(chooser.getSnapshot().phase, "closed");
});

test("choosing a file from outside copies it in only after the user agrees", async () => {
  const host = createMemoryPlatformServices({ capabilities: ["folderWrite", "pickFile"] });
  const chooser = picker(host);
  equal(chooser.getSnapshot().outsideUnavailable, null);

  host.answerFilePicks({ name: "hero.png", bytes: bytes(1, 2, 3) });
  host.answerQuestions("cancel");
  deepEqual(await chooser.pickOutside(), { chosen: false });
  equal(host.bytesOf("Bitmap/hero.png"), undefined, "cancel copies nothing");
  equal(chooser.getSnapshot().phase, "browsing");

  host.answerFilePicks(null);
  deepEqual(await chooser.pickOutside(), { chosen: false });
  equal(host.questions.length, 1, "cancelling the file dialog asks nothing");

  host.answerFilePicks({ name: "hero.png", bytes: bytes(1, 2, 3) });
  host.answerQuestions("copy");
  deepEqual(await chooser.pickOutside("people"), { chosen: true, reference: "people\\hero.png" });
  deepEqual(host.bytesOf("Bitmap/people/hero.png"), bytes(1, 2, 3));
  deepEqual(host.filePickRequests[0], { title: "Choose a file for the hero's picture", extensions: [".png"] });
});

test("a host that cannot choose an outside file says so, in the picker's own words", async () => {
  const host = createMemoryPlatformServices({ capabilities: ["folderWrite"] });
  const chooser = picker(host);
  ok(chooser.getSnapshot().outsideUnavailable?.includes("cannot choose a file from outside the project"));
  deepEqual(await chooser.pickOutside(), { chosen: false });
  ok(chooser.getSnapshot().message?.includes("cannot choose a file from outside"));
  equal(host.filePickRequests.length, 0);
});

test("a folder that cannot be read is shown in the picker's message", async () => {
  const host = createMemoryPlatformServices({ files: { "Bitmap/a.png": bytes(1) } });
  const services = { ...host, fs: { ...host.fs, list: () => Promise.resolve(platformError("permission-denied", "no access")) } };
  const chooser = createAssetPicker({ services, layout: ROOT, kind: "bitmaps", extensions: [], field: "a picture" });
  await chooser.refresh();
  ok(chooser.getSnapshot().message?.includes("no access"));
  deepEqual(chooser.getSnapshot().candidates, []);
});

// The bytes that make a file a WAV or a MIDI to the game, whatever it is called (docs/spec/engine/audio-media.md#audio-format-policy).
const wavBytes = bytes(82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69);
const midiBytes = bytes(77, 84, 104, 100);
const AUDIO_FILES = {
  "Media/battle.mp3": wavBytes,
  "Media/sub/theme.ogg": midiBytes,
  "Media/tagged.mp3": bytes(73, 68, 51, 4, 0, 0, 0, 0, 0, 0, 0, 0),
  "Media/claimed.wav": bytes(1, 2, 3),
  "Media/notes.txt": bytes(4),
};

test("an audio field also lists a WAV or MIDI kept under another name, judged by its first bytes", async () => {
  const host = createMemoryPlatformServices({ files: AUDIO_FILES });
  const byExtension = await listCandidates(host.fs, ROOT, "media", [".wav", ".mid", ".midi"]);
  deepEqual(byExtension.candidates.map((candidate) => candidate.reference), ["claimed.wav"], "the extension list alone hides a valid WAV named .mp3");
  const byContent = await listCandidates(host.fs, ROOT, "media", [".wav", ".mid", ".midi"], "audio");
  deepEqual(byContent.candidates.map((candidate) => candidate.reference), ["battle.mp3", "claimed.wav", "sub\\theme.ogg"], "bytes that are not a header stay out; a listed extension is kept as it was");
  deepEqual(byContent.failures, []);
});
test("content candidate checks prefer bounded header reads when the host supports them", async () => {
  const host = createMemoryPlatformServices({ files: AUDIO_FILES });
  const reads: { path: string; length: number }[] = [];
  const fs = {
    list: host.fs.list.bind(host.fs),
    read: async () => { throw new Error("whole-file read should not be used"); },
    readPrefix: async (path: string, length: number) => {
      reads.push({ path, length });
      const file = await host.fs.read(path);
      return file.ok ? platformOk(file.value.slice(0, length)) : file;
    },
  };
  const listed = await listCandidates(fs, ROOT, "media", [".wav", ".mid", ".midi"], "audio");
  deepEqual(listed.candidates.map((candidate) => candidate.reference), ["battle.mp3", "claimed.wav", "sub\\theme.ogg"]);
  deepEqual(reads, [
    { path: "Media/battle.mp3", length: 12 },
    { path: "Media/tagged.mp3", length: 12 },
    { path: "Media/notes.txt", length: 12 },
    { path: "Media/sub/theme.ogg", length: 12 },
  ]);
});


test("a file that cannot be read for its header is reported, not silently dropped", async () => {
  const host = createMemoryPlatformServices({ files: AUDIO_FILES });
  const fs = { list: host.fs.list.bind(host.fs), read: (path: string) => path === "Media/battle.mp3" ? Promise.resolve(platformError("permission-denied", "no access")) : host.fs.read(path) };
  const listed = await listCandidates(fs, ROOT, "media", [".wav"], "audio");
  deepEqual(listed.candidates.map((candidate) => candidate.reference), ["claimed.wav", "sub\\theme.ogg"]);
  equal(listed.failures[0]?.path, "Media/battle.mp3");
});

test("a host that cannot read files lists by extension only", async () => {
  const host = createMemoryPlatformServices({ files: AUDIO_FILES });
  const listed = await listCandidates({ list: host.fs.list.bind(host.fs) }, ROOT, "media", [".wav"], "audio");
  deepEqual(listed.candidates.map((candidate) => candidate.reference), ["claimed.wav"]);
});

test("the picker offers a mismatched-name WAV and chooses it as listed, without renaming it", async () => {
  const host = createMemoryPlatformServices({ files: AUDIO_FILES });
  const chooser = createAssetPicker({ services: host, layout: ROOT, kind: "media", extensions: [".wav", ".mid", ".midi"], content: "audio", field: "the battle music" });
  await chooser.refresh();
  ok(chooser.getSnapshot().candidates.some((candidate) => candidate.reference === "battle.mp3"));
  chooser.select("battle.mp3");
  host.answerQuestions("use");
  deepEqual(await chooser.confirm(), { chosen: true, reference: "battle.mp3" });
  deepEqual(host.bytesOf("Media/battle.mp3"), wavBytes, "the file is untouched");
});
