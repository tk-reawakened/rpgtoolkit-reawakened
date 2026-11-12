// Installs the spike's candidate libraries at exact versions into TKR_SPIKE_DEPS (default: <tmpdir>/tkr-e11-spike-deps),
// outside the checkout, with install scripts disabled. The workspace manifests and lockfile are never touched.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deps, depsDir } from "./env.mjs";

mkdirSync(depsDir, { recursive: true });
writeFileSync(
  join(depsDir, "package.json"),
  `${JSON.stringify({ name: "tkr-e11-spike-deps", private: true, description: "Throwaway spike dependencies outside the workspace" }, null, 2)}\n`,
);
const specs = Object.entries(deps).map(([name, version]) => `${name}@${version}`);
const result = spawnSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--save-exact", ...specs], {
  cwd: depsDir,
  stdio: "inherit",
});
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`spike dependencies installed in ${depsDir}`);
