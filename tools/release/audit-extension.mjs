// Audit every source esbuild put into the four shipped extension bundles.
import { builtinModules } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateLicense, loadBlueOakList, loadConfig } from '../licences/check.mjs';

const root = resolve(process.argv[2] ?? resolve(import.meta.dirname, '../..'));
const policyRoot = fileURLToPath(new URL('../licences/', import.meta.url));
const policy = { ...loadConfig(join(policyRoot, 'config.json')), blueOakList: loadBlueOakList(join(policyRoot, 'blue-oak-list.json')) };
const notices = readFileSync(join(root, 'THIRD_PARTY_NOTICES'), 'utf8');
const metafiles = JSON.parse(readFileSync(join(root, 'extensions/rpgcode/dist/bundle-metafiles.json'), 'utf8'));
if (!Array.isArray(metafiles) || metafiles.length !== 4) throw new Error('expected four extension bundle metafiles');
const packages = new Map();
const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

function manifestFor(input) {
  let dir = dirname(resolve(root, input));
  while (true) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest) && typeof JSON.parse(readFileSync(manifest, 'utf8')).name === 'string') return manifest;
    const parent = dirname(dir);
    if (parent === dir || dir === parse(dir).root) throw new Error(`no package manifest for ${input}`);
    dir = parent;
  }
}

for (const metafile of metafiles) {
  for (const input of Object.keys(metafile.inputs)) {
    const path = manifestFor(input);
    if (!packages.has(path)) packages.set(path, JSON.parse(readFileSync(path, 'utf8')));
  }
  for (const output of Object.values(metafile.outputs)) {
    for (const dependency of output.imports) {
      if (dependency.external && dependency.path !== 'vscode' && !builtins.has(dependency.path)) {
        throw new Error(`unaccounted external extension dependency: ${dependency.path}`);
      }
    }
  }
}
if (packages.size === 0) throw new Error('extension bundle has no audited inputs');
for (const manifest of packages.values()) {
  const result = evaluateLicense(manifest.license, policy);
  if (!result.pass) throw new Error(`${manifest.name}: ${result.reason}`);
  const firstParty = manifest.name === 'rpgtoolkit-reawakened' || manifest.name === 'rpgcode-language' || manifest.name.startsWith('@tk-reawakened/');
  if (!firstParty && !notices.includes(manifest.name)) throw new Error(`missing extension notice for ${manifest.name}@${manifest.version}`);
  console.log(`${manifest.name}@${manifest.version}: ${manifest.license} OK`);
}
console.log(`extension bundle licence audit passed: ${packages.size} packages`);
