// Audit actual installed production packages with the same policy as the workspace G6 gate.
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateLicense, loadBlueOakList, loadConfig } from '../licences/check.mjs';

const root = resolve(process.argv[2] ?? '.');
const policyRoot = fileURLToPath(new URL('../licences/', import.meta.url));
const policy = {
  ...loadConfig(join(policyRoot, 'config.json')),
  blueOakList: loadBlueOakList(join(policyRoot, 'blue-oak-list.json')),
};
const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const directDependencies = new Set([
  ...Object.keys(rootManifest.dependencies ?? {}),
  ...Object.keys(rootManifest.optionalDependencies ?? {}),
  ...Object.keys(rootManifest.peerDependencies ?? {}),
]);
const visited = new Set();
let count = 0;
let failures = 0;

function packages(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = join(directory, entry.name);
    if (entry.name.startsWith('@')) {
      packages(path);
      continue;
    }
    const real = realpathSync(path);
    if (visited.has(real)) continue;
    visited.add(real);
    const manifest = JSON.parse(readFileSync(join(real, 'package.json'), 'utf8'));
    const tier = directDependencies.has(manifest.name) ? 'direct' : 'transitive';
    const result = evaluateLicense(manifest.license, policy, tier);
    console.log(`${manifest.name}@${manifest.version} [${tier}]: ${manifest.license ?? '<missing>'} ${result.pass ? 'OK' : result.reason}`);
    count++;
    if (!result.pass) failures++;
    try { packages(join(real, 'node_modules')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

packages(join(root, 'node_modules'));
if (count === 0 || failures > 0) throw new Error(`production licence audit failed: ${count} packages, ${failures} violations`);
console.log(`production licence audit passed: ${count} packages`);
