import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { goldenJob, parseClosingPlan, runAudioGoldens, runFetchedCorpus, type AudioGoldenRuns } from "@tk-reawakened/runner-harness";
import { loadGameFiles, runClosing } from "./closing.ts";
import { runDump } from "./dump/cli.ts";

function readFileOrUndefined(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, "utf8");
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      err.code === "ENOENT"
    ) {
      return undefined;
    }
    throw err;
  }
}

/** `golden [<root>] [--record]`: replay (or record) the committed golden tree. */
function runGolden(argv: string[]): number {
  try {
    let record = false;
    const positionals: string[] = [];

    for (const arg of argv) {
      if (arg.startsWith("-")) {
        if (arg === "--record") {
          record = true;
        } else {
          console.error(`golden: unknown flag: ${arg}`);
          return 1;
        }
      } else {
        positionals.push(arg);
      }
    }

    if (positionals.length > 1) {
      console.error(`golden: unexpected argument '${positionals[1] as string}'`);
      return 1;
    }

    const root = positionals[0] ?? process.cwd();

    const vectors = readFileOrUndefined(join(root, "golden/hash-vectors.json"));
    const run = readFileOrUndefined(join(root, "golden/test-double/run.json"));
    const golden = readFileOrUndefined(join(root, "golden/test-double/golden.json"));
    const scriptsGolden =
      readFileOrUndefined(join(root, "golden/scripts/golden.json")) ?? (record ? undefined : "");
    const ledgerText = readFileOrUndefined(join(root, "golden/ledger.json")) ?? (record ? undefined : "");
    const sceneGoldens = ledgerText === undefined ? undefined : ledgerText === "" ? [] : readdirSync(join(root, "golden/scenes")).filter((name) => name.endsWith(".json")).sort().map((name) => {
      const sceneText = readFileSync(join(root, "golden/scenes", name), "utf8");
      const scene = JSON.parse(sceneText) as { readonly boardFiles: readonly string[]; readonly name: string };
      const ledger = JSON.parse(ledgerText) as { readonly goldens: readonly { readonly scene: string; readonly path: string }[] };
      const row = ledger.goldens.find((entry) => entry.scene === scene.name);
      if (row === undefined) throw new Error(`${scene.name}: no ledger entry`);
      return {
        sceneText,
        assets: scene.boardFiles.map((path) => ({ path, bytes: new Uint8Array(readFileSync(join(root, path))) })),
        referencePng: new Uint8Array(readFileSync(join(root, row.path))),
        ledgerText,
      };
    });
    const closingPlanText = readFileOrUndefined(join(root, "golden/closing/plan.json"));
    const audioGolden = readFileOrUndefined(join(root, "golden/audio/cues.json")) ?? (record ? "" : undefined);
    let audioRuns: AudioGoldenRuns | undefined;
    // Build the runs whenever the corpus and its plan exist, so a missing baseline is detected below rather than
    // silently removing the audio stage from the job.
    if (closingPlanText !== undefined) {
      const closingPlan = parseClosingPlan(closingPlanText);
      const bundled = new Map<string, Uint8Array>();
      for (const folder of closingPlan.bundled) for (const [path, bytes] of loadGameFiles(join(root, folder))) bundled.set(`${folder}/${path}`, bytes);
      const fetchedRoot = join(root, "fixtures", "legacy");
      if (existsSync(fetchedRoot)) {
        audioRuns = runAudioGoldens(closingPlan, (name) => loadGameFiles(join(fetchedRoot, name)), bundled);
      }
    }
    // The corpus and its closing plan exist (CI fetches the fixtures): a missing cue baseline is then a failure,
    // not a silently dropped stage. Without the fixtures the local flow is `fixtures:fetch` first, so it stays out.
    if (!record && audioRuns !== undefined && audioGolden === undefined) {
      console.error("golden: error: golden/audio/cues.json is absent");
      return 1;
    }
    const result = goldenJob({
      vectors,
      run,
      golden,
      scriptsGolden,
      sceneGoldens,
      ...(audioRuns !== undefined ? {
        audioGolden,
        audioRuns: audioRuns.runs,
        audioSynthetic: audioRuns.synthetic,
      } : {}),
    }, record);

    if (!result.ok) {
      const completed = result.lines.slice(0, -1);
      for (const line of completed) {
        console.log(line);
      }
      const failure = result.lines[result.lines.length - 1];
      if (failure !== undefined) {
        console.error(failure);
      }
      return 1;
    }

    for (const line of result.lines) {
      console.log(line);
    }

    if (record && result.golden !== undefined) {
      const targetPath = join(root, "golden/test-double/golden.json");
      const targetDir = dirname(targetPath);
      mkdirSync(targetDir, { recursive: true });
      const tmpPath = join(targetDir, `golden.json.tmp.${process.pid}`);
      writeFileSync(tmpPath, result.golden, "utf8");
      renameSync(tmpPath, targetPath);
    }
    if (record && result.scriptsGolden !== undefined) {
      const targetPath = join(root, "golden/scripts/golden.json");
      const targetDir = dirname(targetPath);
      mkdirSync(targetDir, { recursive: true });
      const tmpPath = join(targetDir, `golden.json.tmp.${process.pid}`);
      writeFileSync(tmpPath, result.scriptsGolden, "utf8");
      renameSync(tmpPath, targetPath);
    }
    if (record && result.audioGolden !== undefined) {
      const targetPath = join(root, "golden/audio/cues.json");
      const targetDir = dirname(targetPath);
      mkdirSync(targetDir, { recursive: true });
      const tmpPath = join(targetDir, `cues.json.tmp.${process.pid}`);
      writeFileSync(tmpPath, result.audioGolden, "utf8");
      renameSync(tmpPath, targetPath);
    }

    return 0;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`golden: error: ${message}`);
    return 1;
  }
}

/** `corpus [<fixtures-dir>]`: runs the whole fetched corpus across both sample games headlessly. */
function runCorpus(argv: string[]): number {
  try {
    const root = argv[0] ?? join(process.cwd(), "fixtures", "legacy");
    const demoPrg = join(root, "demo", "Prg");
    const basicPrg = join(root, "Basic", "Prg");

    if (!existsSync(demoPrg) || !existsSync(basicPrg)) {
      console.error(
        `corpus: fixtures directory not found at '${root}'. Run 'pnpm fixtures:fetch' first.`,
      );
      return 1;
    }

    const demoFiles: Record<string, Uint8Array> = {};
    for (const name of readdirSync(demoPrg).sort()) {
      if (name.endsWith(".prg")) {
        demoFiles[name] = readFileSync(join(demoPrg, name));
      }
    }

    const basicFiles: Record<string, Uint8Array> = {};
    for (const name of readdirSync(basicPrg).sort()) {
      if (name.endsWith(".prg")) {
        basicFiles[name] = readFileSync(join(basicPrg, name));
      }
    }

    const results = runFetchedCorpus({ demo: demoFiles, basic: basicFiles });
    for (const res of results) {
      console.log(`${res.id}: ${res.ticks} ticks ok (hash ${res.stateHash})`);
    }
    console.log(
      `corpus: ${results.length}/${results.length} fetched programs passed (both games, snapshot/restore verified)`,
    );
    return 0;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`corpus: error: ${message}`);
    return 1;
  }
}

/** The headless shell: `golden` replays the G5 suite, `closing` boots the sample games, `dump` walks a legacy project. */
export function main(argv: string[]): number {
  const subcommand = argv[0];

  if (subcommand === undefined) {
    console.error("missing subcommand");
    return 1;
  }

  if (subcommand === "golden") {
    return runGolden(argv.slice(1));
  }
  if (subcommand === "corpus") {
    return runCorpus(argv.slice(1));
  }
  if (subcommand === "closing") {
    return runClosing(argv.slice(1));
  }
  if (subcommand === "dump") {
    try {
      return runDump(argv.slice(1));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`dump: error: ${message}`);
      return 1;
    }
  }

  console.error(`unknown subcommand '${subcommand}'`);
  return 1;
}
