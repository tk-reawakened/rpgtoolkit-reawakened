import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const lock = JSON.parse(readFileSync('extensions/rpgcode/package-lock.json', 'utf8'));
const workspaceLock = readFileSync('pnpm-lock.yaml', 'utf8');

test('publisher lockfiles exclude the restricted VSIX signing helper', () => {
  assert.ok(!Object.keys(lock.packages).some((path) => path.includes('vsce-sign')));
  assert.ok(!workspaceLock.includes('@vscode/vsce-sign'));
});

test('extension publisher uses patched Markdown and XML parsers', () => {
  assert.equal(lock.packages['node_modules/markdown-it'].version, '14.3.3');
  assert.equal(lock.packages['node_modules/linkify-it'].version, '5.0.2');
  assert.equal(lock.packages['node_modules/xml2js'].version, '0.6.2');
});
