// Local affected-package selection. Uncertainty selects the complete suite (G5).
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { isEntryPoint, repoRoot, run } from "./run.mjs";

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`git ${args[0]} failed: ${(result.stderr || result.error?.message || "unknown error").trim()}`);
  return result.stdout;
}

function pathsFromNul(output) {
  if (!output) return [];
  if (!output.endsWith("\0")) throw new Error("incomplete NUL-delimited Git output");
  const paths = output.slice(0, -1).split("\0");
  if (paths.some((path) => !path)) throw new Error("empty path in Git output");
  return paths;
}

export function changedPaths(root, base = "origin/main") {
  // Resolve the ref as an argument, never as shell syntax or a Git option.
  const commit = git(root, ["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`]).trim();
  if (!/^[0-9a-f]{40,64}$/.test(commit)) throw new Error("invalid resolved base commit");
  const mergeBase = git(root, ["merge-base", commit, "HEAD"]).trim();
  if (!/^[0-9a-f]{40,64}$/.test(mergeBase)) throw new Error("invalid merge base");
  return [...new Set([
    ...pathsFromNul(git(root, ["diff", "--no-renames", "--name-only", "-z", mergeBase, "--"])),
    ...pathsFromNul(git(root, ["diff", "--cached", "--no-renames", "--name-only", "-z", "--"])),
    ...pathsFromNul(git(root, ["diff", "--no-renames", "--name-only", "-z", "--"])),
    ...pathsFromNul(git(root, ["ls-files", "--others", "--exclude-standard", "-z"])),
  ])];
}

function closure(start, edges) {
  const seen = new Set(start);
  const queue = [...seen];
  for (const name of queue) for (const [dependency, dependent] of edges) {
    if (dependency === name && !seen.has(dependent)) { seen.add(dependent); queue.push(dependent); }
  }
  return seen;
}

export function loadGraph(root) {
  const workspace = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
  const packageSection = /^packages:\s*\n((?:[ \t]+[^\n]*\n|[ \t]*\n)*)/m.exec(workspace)?.[1];
  const patterns = packageSection?.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  if (!patterns || patterns.length !== 1 || !/^-\s+['"]?packages\/\*['"]?$/.test(patterns[0])) throw new Error("unsupported workspace package configuration");
  const dirs = readdirSync(join(root, "packages"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  if (!dirs.length) throw new Error("no workspace packages found");
  const manifests = dirs.map((dir) => JSON.parse(readFileSync(join(root, "packages", dir, "package.json"), "utf8")));
  const names = new Map();
  for (let i = 0; i < dirs.length; i++) {
    const name = manifests[i].name;
    if (typeof name !== "string" || !name || names.has(name)) throw new Error(`invalid package name in ${dirs[i]}`);
    names.set(name, dirs[i]);
  }
  const graph = JSON.parse(readFileSync(join(root, "tools/deps/edges.json"), "utf8"));
  if (!Array.isArray(graph.packages) || graph.packages.some((name) => typeof name !== "string" || !name) || new Set(graph.packages).size !== graph.packages.length || dirs.some((dir) => !graph.packages.includes(dir))) throw new Error("graph package coverage does not match workspace");
  if (!Array.isArray(graph.edges) || graph.edges.some((edge) => !Array.isArray(edge) || edge.length !== 2 || !graph.packages.includes(edge[0]) || !graph.packages.includes(edge[1]))) throw new Error("invalid graph edges");
  for (let i = 0; i < dirs.length; i++) for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    const deps = manifests[i][field] ?? {};
    if (typeof deps !== "object" || Array.isArray(deps) || deps === null) throw new Error(`invalid ${field} in ${dirs[i]}`);
    for (const [name, version] of Object.entries(deps)) {
      if (typeof version !== "string") throw new Error(`invalid dependency ${name} in ${dirs[i]}`);
      const dependency = names.get(name);
      if (version.startsWith("workspace:") && !dependency) throw new Error(`unknown workspace dependency ${name} in ${dirs[i]}`);
      if (dependency && !closure([dependency], graph.edges).has(dirs[i])) throw new Error(`graph missing dependency ${dependency} -> ${dirs[i]}`);
    }
  }
  return { packages: dirs, edges: graph.edges };
}

export function selectPackages(paths, graph) {
  const all = (reason) => ({ packages: graph.packages, reason });
  const changed = new Set();
  for (const path of paths) {
    const parts = path.split("/");
    if (parts[0] !== "packages" || parts.length < 3 || !graph.packages.includes(parts[1]) || parts.includes("fixtures")) return all(`shared or unmapped path: ${path}`);
    if (parts[1] === "core") return all(`core changed: ${path}`);
    changed.add(parts[1]);
  }
  // runner-web/test/csp.test.ts reads desktop source and scans every runner app page.
  // These test-only dependencies are not represented by the package dependency graph.
  const testEdges = graph.packages.includes("runner-web")
    ? graph.packages.filter((name) => name.startsWith("runner-") && name !== "runner-web").map((name) => [name, "runner-web"])
    : [];
  return { packages: [...closure(changed, [...graph.edges, ...testEdges])].filter((name) => graph.packages.includes(name)).sort(), reason: paths.length ? "affected packages and downstream dependents" : "no changes" };
}

export function testFiles(root, packages) {
  return packages.flatMap((pkg) => {
    const dir = join(root, "packages", pkg, "test");
    try { return readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts")).map((entry) => posix.join("packages", pkg, "test", entry.name)).sort(); }
    catch (error) { if (error.code === "ENOENT") return []; throw error; }
  });
}

export function main(argv, root = repoRoot) {
  if (argv.length > 2 || (argv.length && (argv[0] !== "--base" || !argv[1]))) {
    console.error("usage: pnpm test:affected [--base <ref>]"); return 1;
  }
  let graph, selection;
  try {
    graph = loadGraph(root);
    selection = selectPackages(changedPaths(root, argv[1]), graph);
  } catch (error) {
    console.log(`test:affected: selecting all tests: ${error.message}`);
    // Enumerate independently of the graph, which may itself be unusable.
    try { graph = { packages: readdirSync(join(root, "packages"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() }; }
    catch (enumerationError) { console.error(`test:affected: cannot enumerate packages: ${enumerationError.message}`); return 1; }
    selection = { packages: graph.packages, reason: "fallback to all tests" };
  }
  console.log(`test:affected: ${selection.reason}`);
  if (!selection.packages.length) { console.log("test:affected: no changes; no tests to run"); return 0; }
  let files;
  try { files = testFiles(root, selection.packages); }
  catch (error) { console.error(`test:affected: cannot enumerate tests: ${error.message}`); return 1; }
  if (!files.length) { console.log("test:affected: affected packages have no test files"); return 0; }
  console.log(`test:affected: ${selection.packages.join(", ")} (${files.length} test files)`);
  const build = spawnSync("pnpm", ["build"], { cwd: root, stdio: "inherit" });
  if (build.status !== 0) return build.status ?? 1;
  const result = run(root, files);
  if (result.code !== 0) console.error(`test:affected: test failure or skipped/todo tests (${result.counts.skipped} skipped, ${result.counts.todo} todo)`);
  return result.code;
}

if (isEntryPoint(import.meta.url)) process.exitCode = main(process.argv.slice(2));
