import { equal, deepEqual } from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";

import { deepLinkPath, NO_GAME_REASON, resolveLaunchTarget, type LaunchInputs, type LibraryRow } from "../src/launch.ts";

const EXE = "/opt/player";
const DATA = "/home/player/.config/tk";
const RESOURCES = "/opt/player/resources";

const ROWS: readonly LibraryRow[] = [
  { gameId: "g1", title: "Game one", version: "1.0", lastPlayedAt: null },
];

/** Build the inputs for one case: the file set, the JSON bodies, the library rows and any argv. */
function inputs(options: {
  readonly argv?: readonly string[];
  readonly files?: readonly string[];
  readonly json?: Readonly<Record<string, unknown>>;
  readonly rows?: readonly LibraryRow[] | null;
  readonly warnings?: string[];
}): LaunchInputs {
  const files = new Set((options.files ?? []).map((path) => resolve(path)));
  const json = options.json ?? {};
  return {
    argv: options.argv ?? [],
    executableDir: EXE,
    dataDir: DATA,
    resourcesDir: RESOURCES,
    isFile: (path) => files.has(resolve(path)),
    readJson: (path) => {
      if (!(path in json)) throw new Error(`ENOENT ${path}`);
      return json[path];
    },
    library: () => options.rows ?? null,
    onWarning: (message) => options.warnings?.push(message),
  };
}

test("--game wins over every other source", () => {
  const config = resolve(EXE, "player.json");
  const target = resolve("/games/a.tpk");
  const resolution = resolveLaunchTarget(
    inputs({
      argv: ["--game", target],
      files: [target, resolve("/games/b.tpk"), config, resolve(RESOURCES, "game.tpk")],
      json: { [config]: { schema: 1, defaultGame: "/games/b.tpk" } },
      rows: ROWS,
    }),
  );
  deepEqual(resolution, { step: "argument", path: target });
});

test("a --game that is not a file falls through to the next step, with a warning", () => {
  const warnings: string[] = [];
  const config = resolve(EXE, "player.json");
  const target = resolve("/games/b.tpk");
  const resolution = resolveLaunchTarget(
    inputs({
      argv: ["--game", "/games/missing.tpk"],
      files: [target, config],
      json: { [config]: { schema: 1, defaultGame: "/games/b.tpk" } },
      warnings,
    }),
  );
  deepEqual(resolution, { step: "config", path: target });
  equal(warnings.length, 1);
  equal(warnings[0]?.includes("/games/missing.tpk"), true);
});

test("a tkr://play link resolves like --game, and a link with no game parameter does not", () => {
  const linked = resolve("/games/linked.tpk");
  equal(
    JSON.stringify(resolveLaunchTarget(inputs({ argv: ["tkr://play?game=%2Fgames%2Flinked.tpk"], files: [linked] }))),
    JSON.stringify({ step: "deep-link", path: linked }),
  );
  const warnings: string[] = [];
  const resolution = resolveLaunchTarget(inputs({ argv: ["tkr://play"], rows: ROWS, warnings }));
  deepEqual(resolution, { step: "library", rows: ROWS });
  equal(warnings.length, 1);
  equal(deepLinkPath("tkr://play?game=/a.tpk"), "/a.tpk");
  equal(deepLinkPath("tkr://play"), null);
  equal(deepLinkPath("https://example.test/?game=/a.tpk"), null);
  equal(deepLinkPath("not a url"), null);
});

test("player.json beside the executable wins over the one in the application-data directory", () => {
  const portable = resolve(EXE, "player.json");
  const installed = resolve(DATA, "player.json");
  const portableGame = resolve(EXE, "game.tpk");
  const installedGame = resolve("/elsewhere/game.tpk");
  const resolution = resolveLaunchTarget(
    inputs({
      files: [portable, installed, portableGame, installedGame],
      json: {
        [portable]: { schema: 1, defaultGame: "game.tpk" },
        [installed]: { schema: 1, defaultGame: installedGame },
      },
    }),
  );
  deepEqual(resolution, { step: "config", path: portableGame });
});

test("an installed player.json resolves a relative path against its own directory", () => {
  const installed = resolve(DATA, "player.json");
  const installedGame = resolve(DATA, "packages/demo.tpk");
  const resolution = resolveLaunchTarget(
    inputs({
      files: [installed, installedGame],
      json: { [installed]: { schema: 1, defaultGame: "packages/demo.tpk" } },
    }),
  );
  deepEqual(resolution, { step: "config", path: installedGame });
});

test("a corrupt or unnamed player.json is ignored and the baked default opens", () => {
  const warnings: string[] = [];
  const portable = resolve(EXE, "player.json");
  const baked = resolve(RESOURCES, "game.tpk");
  const resolution = resolveLaunchTarget(
    inputs({ files: [portable, baked], json: { [portable]: { schema: 1 } }, warnings }),
  );
  deepEqual(resolution, { step: "baked", path: baked });
  equal(warnings.length, 1);
  equal(warnings[0]?.includes("defaultGame"), true);
});

test("no source at all reports the library or the reason, never nothing", () => {
  deepEqual(resolveLaunchTarget(inputs({ rows: ROWS })), { step: "library", rows: ROWS });
  deepEqual(resolveLaunchTarget(inputs({ rows: [] })), { step: "none", reason: NO_GAME_REASON });
  deepEqual(resolveLaunchTarget(inputs({ rows: null })), { step: "none", reason: NO_GAME_REASON });
});

test("an unreadable library is treated as empty and says so", () => {
  const warnings: string[] = [];
  const base = inputs({ warnings });
  const resolution = resolveLaunchTarget({
    ...base,
    library: () => {
      throw new Error("library.schema must be 1");
    },
  });
  deepEqual(resolution, { step: "none", reason: NO_GAME_REASON });
  equal(warnings.length, 1);
  equal(warnings[0]?.includes("library.schema must be 1"), true);
});
