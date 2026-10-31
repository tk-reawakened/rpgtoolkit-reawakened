/**
 * The authored media-package golden (entry 21.7, issue #486): the three pure-RPGCode
 * packages under `packages/core/test/fixtures/media-packages/` — ducking, stems and
 * region-music — loaded by name from a game's package list, driven through the real
 * engine with the null-audio sink, and pinned by their cue stream and final state hash.
 *
 * docs/spec/engine/audio-media.md#media-1 (the voice and track objects),
 * #media-2 (the past-tense notifications the packages listen to) and #media-3 (the
 * cancelable `beforePlay` the region package mutates). The game is composed here from
 * core's public writers, so the pin needs no fetched sample game and no legacy data.
 */
import {
  assetKey,
  createAssetIndex,
  createEmptyBoard,
  createEmptyMainFile,
  createEngine,
  fileProgramRef,
  hashGameState,
  PACKAGE_ROOT,
  writeBoard,
  writeMainFile,
  type AudioCue,
  type Engine,
  type GameState,
  type PackageCatalogueEntry,
  type ProgramLoader,
} from "@tk-reawakened/core";

/** Package name -> its authored file name; a package name is letters, digits, `-` or `_` (PKG-2). */
export const MEDIA_PACKAGE_FILES: Readonly<Record<string, string>> = {
  media_ducking: "ducking.prg",
  media_stems: "stems.prg",
  media_region_music: "region-music.prg",
};
/** The fixture folder, relative to the repository root. */
export const MEDIA_PACKAGE_FOLDER = "packages/core/test/fixtures/media-packages";
/** The start-up that exercises all three packages: a `ui` sound, then the first stem. */
export const MEDIA_PACKAGE_STARTUP = [
  'mediaPlay("ready.wav", { track: "ui" })',
  'mediaPlay("stem1.wav", { track: "ambience", loop: 0 })',
  "sleep(4)",
  "end()",
].join("\n");
export const MEDIA_PACKAGE_TICKS = 240;

export type MediaPackagesRun = {
  readonly ticks: number;
  readonly cues: readonly AudioCue[];
  readonly stateHash: string;
  readonly finalTick: number;
};

export type MediaPackagesRecord = {
  readonly schema: 1;
  readonly comment: string;
  readonly run: MediaPackagesRun;
};

export type MediaPackagesCheck = { readonly ok: boolean; readonly lines: readonly string[] };

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** A one-track Standard MIDI File lasting five seconds (300 ticks). */
function midi(): Uint8Array {
  return new Uint8Array([
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 0x60,
    0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 12,
    0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20,
    0x87, 0x40, 0xff, 0x2f, 0x00,
  ]);
}

/** An 8-bit mono 8 kHz WAV of 4000 frames: half a second (30 ticks). */
function wav(): Uint8Array {
  const frames = 4000;
  const le32 = (value: number): number[] => [value & 255, (value >> 8) & 255, (value >> 16) & 255, (value >> 24) & 255];
  const le16 = (value: number): number[] => [value & 255, (value >> 8) & 255];
  const ascii = (text: string): number[] => [...text].map((character) => character.charCodeAt(0));
  return new Uint8Array([
    ...ascii("RIFF"), ...le32(36 + frames), ...ascii("WAVE"),
    ...ascii("fmt "), ...le32(16), ...le16(1), ...le16(1), ...le32(8000), ...le32(8000), ...le16(1), ...le16(8),
    ...ascii("data"), ...le32(frames), ...new Array<number>(frames).fill(128),
  ]);
}

/** The authored game: one board with its own music, the start-up above, and the three packages listed. */
function authoredGame(packages: Readonly<Record<string, Uint8Array>>, startup: Uint8Array): { readonly files: Map<string, Uint8Array>; readonly paths: readonly string[] } {
  const files = new Map<string, Uint8Array>();
  const paths = [
    "main.gam", "Boards/region.brd", "Chrs/hero.tem", "Prg/start.prg",
    ...Object.keys(packages).map((name) => `Prg/${name}.prg`),
    "Media/board.mid", "Media/region.mid", "Media/ready.wav", "Media/stem1.wav", "Media/stem2.wav", "Media/stem3.wav",
  ];
  const board = createEmptyBoard();
  const main = {
    ...createEmptyMainFile(),
    major: 2,
    minor: 9,
    startupPrg: "start.prg",
    initBoard: "region.brd",
    initChar: "hero.tem",
    packagePlugins: Object.keys(packages),
  };
  files.set(assetKey("main.gam"), unwrap(writeMainFile(main)));
  files.set(assetKey("boards/region.brd"), unwrap(writeBoard({ ...board, properties: { ...board.properties, backgroundMusic: "board.mid" } })));
  files.set(assetKey("chrs/hero.tem"), new Uint8Array([0]));
  files.set(assetKey("prg/start.prg"), startup);
  for (const [name, source] of Object.entries(packages)) files.set(assetKey(`prg/${name}.prg`), source);
  files.set(assetKey("media/board.mid"), midi());
  files.set(assetKey("media/region.mid"), midi());
  files.set(assetKey("media/ready.wav"), wav());
  files.set(assetKey("media/stem1.wav"), wav());
  files.set(assetKey("media/stem2.wav"), wav());
  files.set(assetKey("media/stem3.wav"), wav());
  return { files, paths };
}

/** The three packages as catalogue entries, their start-up programs resolved from the authored files (PKG-4/PKG-7). */
function mediaCatalogue(packages: readonly string[], files: Map<string, Uint8Array>, paths: readonly string[]): readonly PackageCatalogueEntry[] {
  const loader: ProgramLoader = { index: createAssetIndex(paths), root: PACKAGE_ROOT, read: (key) => files.get(key) };
  return packages.map((name) => ({
    name,
    version: "1.0.0",
    namespace: name,
    requests: [],
    definition: { id: name, version: "1.0.0", commands: [] },
    startup: fileProgramRef(loader, `Prg/${name}.prg`),
  }));
}

/** Run the authored game with the null-audio sink, answering every asset request. */
export function runMediaPackages(packages: Readonly<Record<string, Uint8Array>>, startup: Uint8Array): MediaPackagesRun {
  const { files, paths } = authoredGame(packages, startup);
  const cues: AudioCue[] = [];
  let latest: GameState | null = null;
  const engine: Engine = createEngine({
    seed: 11,
    assetIndex: createAssetIndex(paths),
    assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam",
    gameIdentity: "media-packages-217",
    width: 320,
    height: 240,
    maxTicks: MEDIA_PACKAGE_TICKS + 600,
    packageCatalogue: mediaCatalogue(Object.keys(packages), files, paths),
    startup: { presence: { hasPlayer: () => true }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
    phaseRegistrations: [{ phase: "events", run: (state) => { latest = state; } }],
  });
  let replies: { readonly tick: number; readonly event: { kind: "asset"; reqId: number; bytes: Uint8Array | null } }[] = [];
  let elapsed = 0;
  for (let guard = 0; guard < MEDIA_PACKAGE_TICKS * 20 && elapsed < MEDIA_PACKAGE_TICKS; guard += 1) {
    const report = engine.advance(Math.min(5, MEDIA_PACKAGE_TICKS - elapsed), replies);
    elapsed += report.ticksRun;
    cues.push(...report.audioCues);
    replies = report.loading
      ? report.requests.flatMap((request) => (request.kind === "asset"
        ? [{ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: files.get(request.key) ?? null } }]
        : []))
      : [];
  }
  const state = latest as GameState | null;
  if (state === null) throw new Error("the media-packages golden run never reached a tick");
  return { ticks: MEDIA_PACKAGE_TICKS, cues, stateHash: hashGameState(state), finalTick: state.time.tick };
}

const COMMENT = "Entry 21.7 authored media packages: the ducking, stems and region-music .prg packages under packages/core/test/fixtures/media-packages/ loaded by name from the game's package list, run through the real engine with the null-audio sink. The cue stream and final state hash are deliberate G5 additions; they are not sample-game goldens.";

export function formatMediaPackagesGolden(run: MediaPackagesRun): string {
  const record: MediaPackagesRecord = { schema: 1, comment: COMMENT, run };
  return `${JSON.stringify(record, null, 2)}\n`;
}

/** Compare the computed run with the committed record; every drift is named. */
export function checkMediaPackagesGolden(run: MediaPackagesRun, expectedText: string): MediaPackagesCheck {
  try {
    const expected = JSON.parse(expectedText) as MediaPackagesRecord;
    if (expected.schema !== 1 || typeof expected.comment !== "string" || expected.run === undefined) {
      return { ok: false, lines: ["schema or record shape is invalid"] };
    }
    const problems: string[] = [];
    if (expected.run.stateHash !== run.stateHash) problems.push(`final state hash ${run.stateHash} != committed ${expected.run.stateHash}`);
    if (expected.run.finalTick !== run.finalTick) problems.push(`final tick ${String(run.finalTick)} != committed ${String(expected.run.finalTick)}`);
    if (JSON.stringify(expected.run.cues) !== JSON.stringify(run.cues)) problems.push("cue stream drifted");
    if (problems.length > 0) return { ok: false, lines: problems };
    return { ok: true, lines: [`authored media packages: ${String(run.cues.length)} cues and state ${run.stateHash} stable`] };
  } catch (error) {
    return { ok: false, lines: [error instanceof Error ? error.message : String(error)] };
  }
}
