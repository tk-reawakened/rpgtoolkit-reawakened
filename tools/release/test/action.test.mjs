import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const runner = resolve('.github/actions/script/run.sh');

function exercise(version, failure = '') {
  const dir = mkdtempSync(join(tmpdir(), 'tkr-action-'));
  try {
    const log = join(dir, 'calls');
    writeFileSync(join(dir, 'npx'), '#!/usr/bin/env bash\nprintf "%s\\0" "$@" >> "$CALL_LOG"\nprintf "\\n" >> "$CALL_LOG"\nif [[ " $* " == *" script $FAIL_COMMAND "* ]]; then exit 1; fi\n', { mode: 0o755 });
    const result = spawnSync('bash', [runner], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, TKR_VERSION: version, TKR_PROJECT: 'game dir', CALL_LOG: log, FAIL_COMMAND: failure },
      encoding: 'utf8',
    });
    let calls = '';
    try { calls = readFileSync(log, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return { result, calls: calls.split('\n').filter(Boolean).map((line) => line.split('\0').filter(Boolean)) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('runs all three commands with exact package version and a single path argument', () => {
  const { result, calls } = exercise('1.0.0');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls, [
    ['--yes', '--package', '@tk-reawakened/script-cli@1.0.0', '--', 'tkr', 'script', 'check', 'game dir', '--json'],
    ['--yes', '--package', '@tk-reawakened/script-cli@1.0.0', '--', 'tkr', 'script', 'fmt', '--check', 'game dir', '--json'],
    ['--yes', '--package', '@tk-reawakened/script-cli@1.0.0', '--', 'tkr', 'script', 'test', 'game dir', '--json'],
  ]);
});

test('rejects a non-exact version without invoking npm', () => {
  const { result, calls } = exercise('latest');
  assert.equal(result.status, 2);
  assert.deepEqual(calls, []);
});

test('stops and fails when a check reports findings', () => {
  const { result, calls } = exercise('1.0.0', 'fmt');
  assert.equal(result.status, 1);
  assert.equal(calls.length, 2);
});
