// A host that builds the package catalogue core consumes (ticket 19.20;
// docs/spec/engine/rpgcode-package-loader.md).
//
// Core never reads a package folder (G2). The host reads each folder's `manifest.json` and start-up
// program and hands core a `PackageCatalogueEntry[]`; these tests use the real `stock/stock_battle`
// folder and a full engine boot, so the path a runner takes is the path under test.
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { TextEncoder } from "node:util";
import {
  assetKey,
  createAssetIndex,
  createEmptyBoard,
  createEmptyMainFile,
  createEngine,
  PACKAGE_ROOT,
  writeBoard,
  writeMainFile,
  type Engine,
  type GameState,
  type InputRecord,
} from "@tk-reawakened/core";
import { buildPackageCatalogue, parsePackageManifest, type PackageFolder } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const encoder = new TextEncoder();

/** The real stock battle package, read the way a host reads any package folder. */
function stockBattleFolder(): PackageFolder {
  const folder = join(repoRoot, "stock", "stock_battle");
  const manifestText = readFileSync(join(folder, "manifest.json"), "utf8");
  const parsed = parsePackageManifest(manifestText, "stock_battle/manifest.json");
  if (!parsed.ok) throw new Error(parsed.message);
  return {
    label: "stock_battle",
    manifestText,
    programSource: readFileSync(join(folder, parsed.manifest.program), "utf8"),
  };
}

type Booted = {
  readonly engine: Engine;
  readonly files: Map<string, Uint8Array>;
  readonly state: () => GameState;
};

/** A package-rooted game whose `.gam` list names `packages`, exactly as a runner boots one. */
function bootGame(packages: readonly string[], catalogue: Parameters<typeof createEngine>[0]["packageCatalogue"]): Booted {
  const main = { ...createEmptyMainFile(), major: 2, minor: 9, startupPrg: "start.prg", initBoard: "start.brd", packagePlugins: packages };
  const written = writeMainFile(main);
  if (!written.ok) throw new Error(written.error.message);
  const board = writeBoard(createEmptyBoard());
  if (!board.ok) throw new Error(board.error.message);
  const files = new Map<string, Uint8Array>([
    [assetKey("main.gam"), written.value],
    [assetKey("boards/start.brd"), board.value],
    [assetKey("prg/start.prg"), encoder.encode("end()\n")],
  ]);
  let latest: GameState | null = null;
  const engine = createEngine({
    seed: 5,
    assetIndex: createAssetIndex([...files.keys()]),
    assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam",
    gameIdentity: "package-catalogue-test",
    width: 64,
    height: 64,
    maxTicks: 40,
    ...(catalogue === undefined ? {} : { packageCatalogue: catalogue }),
    startup: {
      presence: { hasPlayer: () => true },
      savedGame: { load: () => ({ kind: "missing" }), restored: () => false },
    },
    phaseRegistrations: [{ phase: "events", run: (state) => { latest = state; } }],
  });
  return { engine, files, state: () => {
    if (latest === null) throw new Error("the engine never ran a tick");
    return latest;
  } };
}

/** Advance until the game is running (or the guard runs out), answering asset requests. */
type BriefDiagnostic = { readonly code: string; readonly message: string; readonly file: string; readonly line: number };

function boot(booted: Booted): { readonly diagnostics: readonly BriefDiagnostic[] } {
  let replies: InputRecord[] = [];
  const diagnostics: BriefDiagnostic[] = [];
  for (let guard = 0; guard < 40; guard += 1) {
    const report = booted.engine.advance(1, replies);
    replies = [];
    for (const diagnostic of report.diagnostics) {
      diagnostics.push({ code: diagnostic.code, message: diagnostic.message, file: diagnostic.file, line: diagnostic.line });
    }
    for (const request of report.requests) {
      if (request.kind === "asset") {
        replies.push({ tick: report.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: booted.files.get(request.key) ?? null } });
      }
    }
    if (!report.loading && booted.state().engine.boot?.stage === "running") break;
  }
  return { diagnostics };
}

test("the host catalogue boots a game naming stock_battle from the real package folder", () => {
  const built = buildPackageCatalogue([stockBattleFolder()]);
  ok(built.ok, built.ok ? "" : built.problems.join("; "));
  if (!built.ok) throw new Error("unreachable");
  const entry = built.entries[0];
  equal(entry?.name, "stock_battle");
  equal(entry?.version, "1.0.0");
  equal(entry?.namespace, "stock_battle");
  deepEqual(entry?.requests, ["asset"]);

  const booted = bootGame(["stock_battle"], built.entries);
  const { diagnostics } = boot(booted);
  deepEqual(diagnostics.filter((diagnostic) => diagnostic.code === "plugin.unresolved"), [], "the catalogue resolved the name");
  equal(booted.state().engine.boot?.stage, "running", "the game boots");
  ok(booted.state().vm.globals["stockbattle"] !== undefined, "the package start-up ran and defined its table");
});

test("a name the catalogue lacks is one located diagnostic and the game still boots", () => {
  const built = buildPackageCatalogue([stockBattleFolder()]);
  if (!built.ok) throw new Error(built.problems.join("; "));
  const booted = bootGame(["stock_battle", "ghost_pkg"], built.entries);
  const { diagnostics } = boot(booted);
  const unresolved = diagnostics.filter((diagnostic) => diagnostic.code === "plugin.unresolved");
  equal(unresolved.length, 1, JSON.stringify(unresolved));
  ok(unresolved[0]?.message.includes("ghost_pkg"), unresolved[0]?.message);
  equal(unresolved[0]?.file, "main.gam", "the diagnostic is located at the main file");
  equal(unresolved[0]?.line, 1, "and at the package's list position");
  equal(booted.state().engine.boot?.stage, "running", "a missing package never refuses the boot");
});

test("a folder that cannot be a package is reported by name before boot", () => {
  const bad = parsePackageManifest(JSON.stringify({ name: "Stock-battle", version: "1", requests: [], program: "startup.prg" }), "bad/manifest.json");
  equal(bad.ok, false);
  if (bad.ok) throw new Error("unreachable");
  ok(bad.message.includes("bad/manifest.json") && bad.message.includes("name"), bad.message);

  // The grammar is core's, in both directions: PKG-2's separators are legal, and a
  // trailing or doubled separator is not.
  const hyphenated = parsePackageManifest(JSON.stringify({ name: "stock-battle", version: "1", requests: ["asset", "saveBlob"], program: "Prg\\startup.prg" }), "ok/manifest.json");
  ok(hyphenated.ok, hyphenated.ok ? "" : hyphenated.message);
  if (hyphenated.ok) deepEqual(hyphenated.manifest.requests, ["asset", "saveBlob"]);
  const trailing = parsePackageManifest(JSON.stringify({ name: "stock-", version: "1", requests: [], program: "startup.prg" }), "bad2/manifest.json");
  equal(trailing.ok, false);

  // Request kinds are core's list, not an invented one, and a repeated kind is refused
  // exactly as core's own manifest reader refuses it.
  const unknownKind = parsePackageManifest(JSON.stringify({ name: "pkg", version: "1", requests: ["audio"], program: "startup.prg" }), "bad3/manifest.json");
  equal(unknownKind.ok, false);
  if (!unknownKind.ok) ok(unknownKind.message.includes("unknown host-request kind"), unknownKind.message);
  const twice = parsePackageManifest(JSON.stringify({ name: "pkg", version: "1", requests: ["asset", "asset"], program: "startup.prg" }), "bad4/manifest.json");
  equal(twice.ok, false);
  if (!twice.ok) ok(twice.message.includes("declared twice"), twice.message);

  // The start-up path must stay inside the package folder.
  for (const program of ["/startup.prg", "C:\\startup.prg", "..\\startup.prg", "a/../startup.prg"]) {
    const escape = parsePackageManifest(JSON.stringify({ name: "pkg", version: "1", requests: [], program }), "bad5/manifest.json");
    equal(escape.ok, false, `${program} must be refused`);
  }

  const built = buildPackageCatalogue([
    stockBattleFolder(),
    { label: "twice/manifest.json", manifestText: readFileSync(join(repoRoot, "stock", "stock_battle", "manifest.json"), "utf8"), programSource: "end()\n" },
  ]);
  equal(built.ok, false);
  if (built.ok) throw new Error("unreachable");
  ok(built.problems.some((problem) => problem.includes("appears twice")), built.problems.join("; "));
});
