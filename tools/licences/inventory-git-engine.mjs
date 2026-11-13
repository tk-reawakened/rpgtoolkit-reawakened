import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateLicense, loadBlueOakList, loadConfig } from "./check.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = join(repoRoot, "tools/licences/fixtures/git-engine");
const manifestPath = join(fixtureRoot, "package.json");
const lockPath = join(fixtureRoot, "package-lock.json");
const outputPath = join(repoRoot, "docs/findings/git-engine-g6-inventory/inventory.json");
const policy = {
  ...loadConfig(join(repoRoot, "tools/licences/config.json")),
  blueOakList: loadBlueOakList(join(repoRoot, "tools/licences/blue-oak-list.json")),
};

function fail(message) {
  throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function licenseFiles(packagePath) {
  return readdirSync(packagePath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^(?:licen[cs]e|copying)(?:[._-].*)?$/i.test(entry.name))
    .map((entry) => {
      const filePath = join(packagePath, entry.name);
      const content = readFileSync(filePath);
      return {
        path: relative(fixtureRoot, filePath).split("\\").join("/"),
        sha256: sha256(content),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

function identifiers(expression) {
  return [...new Set(expression.match(/[A-Za-z0-9.+-]+/g) ?? [])]
    .filter((id) => id !== "AND" && id !== "OR")
    .sort();
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const lock = JSON.parse(readFileSync(lockPath, "utf8"));
const lockedDirect = lock.packages?.[""]?.dependencies ?? {};
if (JSON.stringify(manifest.dependencies) !== JSON.stringify(lockedDirect)) {
  fail("Fixture package.json dependencies do not exactly match package-lock.json");
}

const packages = [];
const failures = [];
for (const [packagePath, locked] of Object.entries(lock.packages ?? {})
  .filter(([path]) => path.startsWith("node_modules/"))
  .sort(([a], [b]) => a.localeCompare(b))) {
  const installedPath = join(fixtureRoot, packagePath);
  const packageJsonPath = join(installedPath, "package.json");
  if (!existsSync(packageJsonPath)) fail(`Missing installed package: ${packagePath}; run npm ci in ${relative(repoRoot, fixtureRoot)}`);

  const metadata = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  if (metadata.version !== locked.version) fail(`${metadata.name} version differs from package-lock.json`);
  const spdx = typeof metadata.license === "string" ? metadata.license : "";
  if (!spdx || spdx !== locked.license) fail(`${metadata.name}@${metadata.version} SPDX metadata differs from package-lock.json`);

  const gate = evaluateLicense(spdx, policy);
  const ratings = Object.fromEntries(identifiers(spdx).map((id) => [id, policy.blueOakList.licenseMap.get(id) ?? null]));
  const entry = {
    name: metadata.name,
    version: metadata.version,
    packagePath,
    resolved: locked.resolved,
    integrity: locked.integrity,
    spdx,
    blueOakRatings: ratings,
    g6: gate.pass ? "pass" : "fail",
    reason: gate.reason ?? null,
    licenseFiles: licenseFiles(installedPath),
  };
  packages.push(entry);
  if (!locked.resolved || !locked.integrity) failures.push(`${metadata.name}@${metadata.version}: missing tarball URL or integrity`);
  if (!gate.pass) failures.push(`${metadata.name}@${metadata.version}: ${gate.reason}`);
}

if (packages.length === 0) fail("No locked dependency packages found");
const inventory = {
  schemaVersion: 1,
  generatedBy: "node tools/licences/inventory-git-engine.mjs",
  fixtureManifest: "tools/licences/fixtures/git-engine/package.json",
  fixtureLock: "tools/licences/fixtures/git-engine/package-lock.json",
  policy: {
    minimumRating: policy.minimumRating,
    blocked: policy.blocked,
    blueOakVersion: policy.blueOakList.version,
  },
  directDependencies: Object.fromEntries(Object.entries(manifest.dependencies).sort(([a], [b]) => a.localeCompare(b))),
  packageCount: packages.length,
  gateFailures: failures,
  packages,
};

const output = `${JSON.stringify(inventory, null, 2)}\n`;
if (process.argv.includes("--check")) {
  if (!existsSync(outputPath) || readFileSync(outputPath, "utf8") !== output) {
    fail(`Inventory differs from ${relative(repoRoot, outputPath)}; regenerate with --write`);
  }
  console.log(`G6 inventory verified: ${packages.length} packages, ${failures.length} failures`);
} else {
  if (failures.length > 0) fail(`G6 inventory has ${failures.length} failures`);
  writeFileSync(outputPath, output);
  console.log(`Wrote ${relative(repoRoot, outputPath)}: ${packages.length} packages, 0 G6 failures`);
}
