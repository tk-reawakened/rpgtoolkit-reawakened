// Temporary transition for #2119: every byte of the source manifest selects exactly
// one complete corpus baseline. Unknown configurations fail before the dump runs.
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const baselines = new Map([
  ["35262c4d0624df2bbd7154a421dbd6927ffd50ca8f92d99a7fc66749da38363f", "golden/legacy-corpus.json"],
  ["61a46d56f1cb7d19bdbd3e48da82bc3fedce2359f288366fd11e1c7a720f14e4", "golden/legacy-corpus-demo-main.json"],
]);

export function corpusBaseline(sourceBytes) {
  const hash = createHash("sha256").update(sourceBytes).digest("hex");
  const baseline = baselines.get(hash);
  if (baseline === undefined) throw new Error(`unknown fixture source configuration: ${hash}`);
  return baseline;
}

if (process.argv[1] !== undefined && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  try {
    const baseline = corpusBaseline(readFileSync("tools/fixtures/sources.json"));
    const result = spawnSync(process.execPath, ["packages/runner-headless/dist/cli.js", "dump", "--check", baseline, "fixtures/legacy"], { stdio: "inherit" });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(`corpus check: ${error.message}`);
    process.exitCode = 1;
  }
}
