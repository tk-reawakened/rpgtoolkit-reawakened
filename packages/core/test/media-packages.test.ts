// Entry 21.7 (issue #486): three authored pure-RPGCode media packages loaded by name
// from the main file's package list, driven through the real engine. The ducking package
// fades `music` while a `ui` voice plays, the stems package starts the next layer when
// one ends, and the region-music package replaces a board's music through `beforePlay`
// (docs/spec/engine/audio-media.md#media-1, #media-2, #media-3). Every package is
// authored from the spec's documented surface only (G7).
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TextEncoder } from "node:util";
import { test } from "node:test";
import {
  assetKey,
  createAssetIndex,
  createEmptyBoard,
  createEmptyMainFile,
  createEngine,
  hashGameState,
  IR_VERSION,
  PACKAGE_ROOT,
  restoreGameState,
  snapshot,
  writeBoard,
  writeMainFile,
  fileProgramRef,
  type AudioCue,
  type Engine,
  type GameState,
  type PackageCatalogueEntry,
  type ProgramLoader,
} from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const encoder = new TextEncoder();
/** The authored packages, read as the host-supplied catalogue's start-up programs (PKG-4/PKG-7). */
const PACKAGES = join(here, "fixtures", "media-packages");
/** Package name -> its authored file (a package name is letters, digits, `-` or `_`, PKG-2). */
const PACKAGE_FILES: Readonly<Record<string, string>> = { media_ducking: "ducking.prg", media_stems: "stems.prg", media_region_music: "region-music.prg" };

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** A one-track Standard MIDI File that lasts five seconds (300 ticks). */
function midi(): Uint8Array {
  return new Uint8Array([
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 0x60,
    0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 12,
    0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20,
    0x87, 0x40, 0xff, 0x2f, 0x00,
  ]);
}

/** An 8-bit mono PCM WAV lasting half a second (30 ticks), as the audio fixtures use. */
function wav(): Uint8Array {
  const frames = 4000;
  const le32 = (value: number): number[] => [value & 255, (value >> 8) & 255, (value >> 16) & 255, (value >> 24) & 255];
  const le16 = (value: number): number[] => [value & 255, (value >> 8) & 255];
  return new Uint8Array([
    ...encoder.encode("RIFF"), ...le32(36 + frames), ...encoder.encode("WAVE"),
    ...encoder.encode("fmt "), ...le32(16), ...le16(1), ...le16(1), ...le32(8000), ...le32(8000), ...le16(1), ...le16(8),
    ...encoder.encode("data"), ...le32(frames), ...new Array<number>(frames).fill(128),
  ]);
}

/** The authored game's files as a `Prg/` loader, so a package start-up is a real program reference. */
function loaderFor(files: Map<string, Uint8Array>, paths: readonly string[]): ProgramLoader {
  return { index: createAssetIndex(paths), root: PACKAGE_ROOT, read: (key) => files.get(key) };
}

/** The three packages as catalogue entries: name, version, namespace, host requests and start-up program. */
function mediaCatalogue(loader: ProgramLoader): readonly PackageCatalogueEntry[] {
  return Object.keys(PACKAGE_FILES).map((name) => ({
    name,
    version: "1.0.0",
    namespace: name,
    requests: [],
    definition: { id: name, version: "1.0.0", commands: [] },
    startup: fileProgramRef(loader, `Prg/${name}.prg`),
  }));
}

type Authored = { readonly files: Map<string, Uint8Array>; readonly paths: readonly string[] };

/** The authored game: one board with its own music, a start-up that plays a `ui` sound and a stem. */
function authoredGame(startup: string): Authored {
  const paths = ["main.gam", "Boards/region.brd", "Chrs/hero.tem", "Prg/start.prg", "Prg/media_ducking.prg", "Prg/media_stems.prg", "Prg/media_region_music.prg", "Media/board.mid", "Media/region.mid", "Media/ready.wav", "Media/stem1.wav", "Media/stem2.wav", "Media/stem3.wav"];
  const files = new Map<string, Uint8Array>();
  const board = createEmptyBoard();
  const main = {
    ...createEmptyMainFile(),
    major: 2,
    minor: 9,
    startupPrg: "start.prg",
    initBoard: "region.brd",
    initChar: "hero.tem",
    packagePlugins: ["media_ducking", "media_stems", "media_region_music"],
  };
  files.set(assetKey("main.gam"), unwrap(writeMainFile(main)));
  files.set(assetKey("boards/region.brd"), unwrap(writeBoard({ ...board, properties: { ...board.properties, backgroundMusic: "board.mid" } })));
  files.set(assetKey("chrs/hero.tem"), new Uint8Array([0]));
  for (const [name, file] of Object.entries(PACKAGE_FILES)) files.set(assetKey(`prg/${name}.prg`), readFileSync(join(PACKAGES, file)));
  files.set(assetKey("prg/start.prg"), encoder.encode(startup));
  files.set(assetKey("media/board.mid"), midi());
  files.set(assetKey("media/region.mid"), midi());
  files.set(assetKey("media/ready.wav"), wav());
  files.set(assetKey("media/stem1.wav"), wav());
  files.set(assetKey("media/stem2.wav"), wav());
  files.set(assetKey("media/stem3.wav"), wav());
  return { files, paths };
}

type Played = {
  readonly cues: readonly AudioCue[];
  readonly state: GameState;
  readonly hashes: readonly string[];
};

/** Boot the authored game with the three packages and answer every asset request. */
function play(startup: string, ticks: number, observe?: (state: GameState) => void): Played {
  const { files, paths } = authoredGame(startup);
  const cues: AudioCue[] = [];
  const hashes: string[] = [];
  let latest: GameState | null = null;
  const engine: Engine = createEngine({
    seed: 11,
    assetIndex: createAssetIndex(paths),
    assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam",
    gameIdentity: "media-packages-217",
    width: 320,
    height: 240,
    maxTicks: ticks + 600,
    packageCatalogue: mediaCatalogue(loaderFor(files, paths)),
    startup: { presence: { hasPlayer: () => true }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
    phaseRegistrations: [{ phase: "events", run: (state) => { latest = state; observe?.(state); } }],
  });
  let replies: { readonly tick: number; readonly event: { kind: "asset"; reqId: number; bytes: Uint8Array | null } }[] = [];
  let elapsed = 0;
  for (let guard = 0; guard < ticks * 20 && elapsed < ticks; guard += 1) {
    const report = engine.advance(Math.min(5, ticks - elapsed), replies);
    elapsed += report.ticksRun;
    cues.push(...report.audioCues);
    if (report.ticksRun > 0) hashes.push(report.stateHash);
    replies = report.loading
      ? report.requests.flatMap((request) => {
          if (request.kind !== "asset") return [];
          const bytes = files.get(request.key) ?? null;
          return [{ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes } }];
        })
      : [];
  }
  if (latest === null) throw new Error("the engine never ran a tick");
  return { cues, state: latest, hashes };
}

/** The start-up that exercises all three packages: a board music start, a `ui` sound and a stem chain. */
const STARTUP = [
  'mediaPlay("ready.wav", { track: "ui" })',
  'mediaPlay("stem1.wav", { track: "ambience", loop: 0 })',
  "sleep(4)",
  "end()",
].join("\n");

test("the three authored media packages drive the documented surface", () => {
  const played = play(STARTUP, 240);
  
  // The region package replaced the board's own file through `beforePlay` (MEDIA-3): the board
  // asked for media/board.mid and the music track got media/region.mid, once.
  const musicStarts = played.cues.filter((cue) => cue.kind === "media.play" && cue.track === "music");
  deepEqual(musicStarts.map((cue) => cue.asset), ["media/region.mid"], "the region package replaced the board's own music");
  // The ducking package faded the music track down while the `ui` voice played and back up after it
  // ended (MEDIA-1 track fade; the fade completes once per applied fade, MEDIA-2).
  const fades = played.cues.filter((cue) => cue.kind === "media.fade" && cue.track === "music");
  deepEqual(fades.map((cue) => cue.tick), [6, 35], "the ducking package faded down on the ui start and back on its end");
  // The start-up played one `ui` sound; the stems package then walked three layers of `ambience`,
  // each one starting on the previous layer's `ended` notification (MEDIA-2).
  equal(played.cues.filter((cue) => cue.kind === "media.play" && cue.track === "ui").length, 1, "one ui sound");
  deepEqual(
    played.cues.filter((cue) => cue.kind === "media.play" && cue.track === "ambience").map((cue) => cue.asset),
    ["media/stem1.wav", "media/stem2.wav", "media/stem3.wav"],
    "the stems package started the next layer on each end",
  );
});

test("the authored game saves and restores at every tick with the same hashes", () => {
  let ticks = 0;
  const played = play(STARTUP, 120, (state) => {
    const restored = restoreGameState(snapshot(state));
    equal(hashGameState(restored), hashGameState(state), `the save taken at tick ${String(state.time.tick)} restores to the same state`);
    ticks += 1;
  });
  ok(ticks > 100, "a save was taken at every tick of the run");
  equal(played.hashes.length > 0, true);
});

test("the same seed replays the same cue stream and the same per-tick hashes", () => {
  const first = play(STARTUP, 120);
  const second = play(STARTUP, 120);
  deepEqual(second.cues, first.cues, "the same seed produced the same cue stream");
  deepEqual(second.hashes, first.hashes, "the same seed produced the same state hash every tick");
});
