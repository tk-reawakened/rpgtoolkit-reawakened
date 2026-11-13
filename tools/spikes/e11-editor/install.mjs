// Installs the spike's candidate libraries at exact versions into TKR_SPIKE_DEPS (default: <tmpdir>/tkr-e11-spike-deps),
// outside the checkout, with install scripts disabled. The workspace manifests and lockfile are never touched.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deps, depsDir, here } from "./env.mjs";

mkdirSync(depsDir, { recursive: true });
writeFileSync(
  join(depsDir, "package.json"),
  `${JSON.stringify({ name: "tkr-e11-spike-deps", private: true, description: "Throwaway spike dependencies outside the workspace", dependencies: deps }, null, 2)}\n`,
);
copyFileSync(join(here, "spike-package-lock.json"), join(depsDir, "package-lock.json"));
const result = spawnSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
  cwd: depsDir,
  stdio: "inherit",
});
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`spike dependencies installed in ${depsDir}`);
