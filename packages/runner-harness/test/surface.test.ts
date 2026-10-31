import { deepEqual } from "node:assert/strict";
import { test } from "node:test";
import * as harness from "../src/index.ts";

test("runner-harness public surface matches the pinned export list with no double", () => {
  const actualExports = Object.keys(harness).sort();
  const pinnedExports = [
    "CLOSING_BASELINE_PATH",
    "checkAudioGoldens",
    "CLOSING_PLAN_PATH",
    "buildCorpus",
    "buildFetchedCorpus",
    "buildPackageCatalogue",
    "catalogueEntry",
    "checkClosingSuite",
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
    "formatGolden",
    "formatScriptsGolden",
    "goldenJob",
    "parseClosingPlan",
    "parseGolden",
    "parsePackageManifest",
    "parseRun",
    "randomSplit",
    "resolvePluginManifest",
    "restoreScriptHost",
    "runAllCorpusPrograms",
    "runAudioGoldens",
    "runClosingGame",
    "runClosingSuite",
    "runCorpusProgram",
    "runFetchedCorpus",
    "runLog",
    "runTracerScene",
    "summariseCensus",
    "verifyCatalogueCompleteness",
  ].sort();

  deepEqual(actualExports, pinnedExports);
});
