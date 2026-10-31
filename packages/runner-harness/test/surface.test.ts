import { deepEqual } from "node:assert/strict";
import { test } from "node:test";
import * as harness from "../src/index.ts";

test("runner-harness public surface matches the pinned export list with no double", () => {
  const actualExports = Object.keys(harness).sort();
  const pinnedExports = [
    "CLOSING_BASELINE_PATH",
    "checkAudioGoldens",
    "CLOSING_PLAN_PATH",
    "MEDIA_PACKAGE_FILES",
    "MEDIA_PACKAGE_FOLDER",
    "MEDIA_PACKAGE_STARTUP",
    "MEDIA_PACKAGE_TICKS",
    "buildCorpus",
    "buildFetchedCorpus",
    "checkClosingSuite",
    "checkMediaPackagesGolden",
    "checkSceneGolden",
    "checkSnapshotRestore",
    "checkVectors",
    "closingLedgerRows",
    "compareGolden",
    "comparePngPixels",
    "compareRgbaWithPng",
    "compareScriptsGolden",
    "createMemoryLoader",
    "createNullAudio",
    "createScriptHost",
    "encodeRgbaPng",
    "formatAudioGolden",
    "formatClosingBaseline",
    "formatMediaPackagesGolden",
    "formatGolden",
    "formatScriptsGolden",
    "goldenJob",
    "parseClosingPlan",
    "parseGolden",
    "parseRun",
    "randomSplit",
    "resolvePluginManifest",
    "restoreScriptHost",
    "runAllCorpusPrograms",
    "runAudioGoldens",
    "runClosingGame",
    "runClosingSuite",
    "runMediaPackages",
    "runCorpusProgram",
    "runFetchedCorpus",
    "runLog",
    "runTracerScene",
    "summariseCensus",
    "verifyCatalogueCompleteness",
  ].sort();

  deepEqual(actualExports, pinnedExports);
});
