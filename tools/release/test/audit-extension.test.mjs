import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const audit = resolve('tools/release/audit-extension.mjs');

function run({ license = 'MIT', notice = 'fixture', external = 'vscode' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'tkr-bundle-'));
  try {
    mkdirSync(join(root, 'node_modules/fixture/lib/esm'), { recursive: true });
    mkdirSync(join(root, 'extensions/rpgcode/dist'), { recursive: true });
    writeFileSync(join(root, 'node_modules/fixture/package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', license }));
    // Some ESM packages have a nested package.json without a name or licence.
    writeFileSync(join(root, 'node_modules/fixture/lib/esm/package.json'), '{"type":"module"}');
    writeFileSync(join(root, 'THIRD_PARTY_NOTICES'), notice);
    const meta = { inputs: { 'node_modules/fixture/lib/esm/index.js': {} }, outputs: { 'out.js': { imports: [{ path: external, external: true }] } } };
    writeFileSync(join(root, 'extensions/rpgcode/dist/bundle-metafiles.json'), JSON.stringify([meta, meta, meta, meta]));
    return spawnSync(process.execPath, [audit, root], { encoding: 'utf8' });
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('accepts accounted bundled code with a permissive licence', () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /fixture@1\.0\.0: MIT OK/);
});

test('rejects a forbidden bundled licence', () => {
  const result = run({ license: 'GPL-3.0-only' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /fixture/);
});

test('rejects missing third-party notices', () => {
  const result = run({ notice: '' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing extension notice for fixture/);
});

test('rejects an unaccounted external dependency', () => {
  const result = run({ external: 'unknown-package' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unaccounted external/);
});
