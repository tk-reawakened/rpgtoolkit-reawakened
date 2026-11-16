import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const audit = resolve('tools/release/audit-installed.mjs');

function run(license) {
  const root = mkdtempSync(join(tmpdir(), 'tkr-licence-'));
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { fixture: '1.0.0' } }));
    const dir = join(root, 'node_modules', 'fixture');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', license }));
    return spawnSync(process.execPath, [audit, root], { encoding: 'utf8' });
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('accepts a permitted installed dependency', () => {
  const result = run('MIT');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /fixture@1\.0\.0 \[direct\]: MIT OK/);
});

test('rejects a prohibited installed dependency', () => {
  const result = run('GPL-3.0-only');
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /fixture@1\.0\.0/);
});

test('rejects an installed dependency with no licence', () => {
  const result = run(undefined);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /<missing>/);
});

test('accepts a known non-copyleft transitive dependency', () => {
  const root = mkdtempSync(join(tmpdir(), 'tkr-licence-'));
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { parent: '1.0.0' } }));
    const parent = join(root, 'node_modules', 'parent');
    const nested = join(parent, 'node_modules', 'fixture');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(parent, 'package.json'), JSON.stringify({ name: 'parent', version: '1.0.0', license: 'MIT' }));
    writeFileSync(join(nested, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', license: 'CC-BY-4.0' }));
    const result = spawnSync(process.execPath, [audit, root], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /fixture@1\.0\.0 \[transitive\]: CC-BY-4\.0 OK/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
