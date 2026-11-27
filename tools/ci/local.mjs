// Run a CI job from the checked-out workflow, with warm workspaces but no cached verdicts (#3607).
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { browserJobLines } from "./check-playwright-image.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const target = args.shift();
const usage = "node tools/ci/local.mjs <job|browser-lane> [--fresh] [--plan] [--runtime=docker|podman]";

async function run() {
  if (!target || target === "--help") {
    console.log(usage);
    return 0;
  }
  if (args.some((arg) => !["--fresh", "--plan", "--runtime=docker", "--runtime=podman"].includes(arg))) {
    throw new Error(usage);
  }
  const runtimes = args.filter((arg) => arg.startsWith("--runtime="));
  if (runtimes.length > 1) throw new Error("Choose one container runtime.");
  const runtime = runtimes[0]?.slice("--runtime=".length) ?? "podman";
  const source = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8").replaceAll("\r\n", "\n");
  // Omit the aggregate gate, native desktop/mobile jobs and golden's system-Python pip install.
  const jobs = ["changes", "checks", "unit", "golden-bun", "script-dogfood", "vscode-web"];
  let job = target;
  let workflow = source;
  if (!jobs.includes(target)) {
    const browser = browserJobLines(source)?.join("\n");
    // Additional axes or include rows can run unselected lanes.
    const matrix = browser?.match(/^      matrix:\n        lane: \[([a-z0-9, -]+)\]\n(?=\n*    [a-z])/m);
    if (!matrix) throw new Error("The browser matrix shape changed; update the local selector before running a browser lane.");
    const lanes = matrix[1].split(",").map((lane) => lane.trim());
    if (!lanes.includes(target)) {
      throw new Error(`Choose a CI job or browser lane: ${[...jobs, ...lanes].join(", ")}`);
    }
    job = "browser";
    // Change only the selected matrix axis, never the steps, dependency versions or assertions.
    workflow = source.replace(browser, browser.replace(matrix[0], `      matrix:\n        lane: [${target}]\n`));
  }
  if (!source.split("\n").includes(`  ${job}:`)) throw new Error(`CI no longer defines job ${job}.`);
  const cache = join(root, ".cache/wrkflw");
  mkdirSync(cache, { recursive: true });
  const lock = join(cache, "running");
  try {
    mkdirSync(lock);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    throw new Error(`A local run owns ${lock}. If it was interrupted, confirm it stopped before removing that directory.`);
  }
  try {
    // A stable filename lets wrkflw retain dependencies/build outputs per checkout and selection.
    const path = join(cache, `${target}.yml`);
    const temporary = join(lock, "workflow.yml");
    writeFileSync(temporary, workflow, { flag: "wx" });
    renameSync(temporary, path);
    const command = args.includes("--plan") ? "plan" : "run";
    const commandArgs = [command, "--runtime", runtime, "--job", job,
      "--event", "push", "--branch", "main", "--changed-files", ".github/workflows/ci.yml"];
    if (args.includes("--fresh")) commandArgs.push("--fresh-workspace");
    if (command === "run") commandArgs.push("--format", "json", "--stream-output");
    commandArgs.push(path);
    console.error(`Local CI: ${target}; ${runtime}; ${args.includes("--fresh") ? "fresh" : "retained"} workspace; one job at a time.`);
    console.error("Simulating a push to main to force execution, not PR classification. Partial/unverified results are NOT a GitHub gate pass.");
    const child = spawn("wrkflw", commandArgs, {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, WRKFLW_MAX_PARALLEL_JOBS: "1" },
    });
    let cancelled = 0;
    function cancel(code) {
      if (cancelled) return;
      cancelled = code;
      // wrkflw 0.9 uses SIGINT for its interrupt handler.
      child.kill("SIGINT");
    }
    const interrupt = () => cancel(130);
    const terminate = () => cancel(143);
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    try {
      return await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code) => resolve(cancelled || (code ?? 1)));
      });
    } finally {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
    }
  } finally {
    rmSync(lock, { recursive: true });
  }
}

try {
  process.exitCode = await run();
} catch (error) {
  console.error(`Local CI: ${error.message}`);
  process.exitCode = 1;
}
