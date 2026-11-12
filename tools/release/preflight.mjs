// Exercise packed candidates or publicly published versions outside the workspace. Never publishes.
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '../..');
const work = mkdtempSync(join(tmpdir(), 'tkr-release-'));
const names = ['core', 'plugin-tk2-compat', 'runner-harness', 'runner-headless', 'script-tools', 'script-spec', 'script-cli'];
const published = process.argv.slice(2).includes('--published');
if (process.argv.slice(2).some((arg) => arg !== '--published')) throw new Error('usage: preflight.mjs [--published]');
const isolatedEnv = {
  ...process.env,
  HOME: work,
  NPM_CONFIG_CACHE: join(work, 'npm-cache'),
  NPM_CONFIG_USERCONFIG: join(work, 'npmrc.user'),
  NPM_CONFIG_GLOBALCONFIG: join(work, 'npmrc.global'),
  NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/',
  NODE_AUTH_TOKEN: '',
};

function run(command, args, cwd, expected = 0, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  assert.equal(result.status, expected, `${command} ${args.join(' ')}\n${result.stderr}\n${result.stdout}`);
  return result.stdout;
}

function validate(result) {
  const checked = spawnSync(process.execPath, [join(repo, 'packages/script-cli/test/schema-stdin.ts')], {
    cwd: repo, input: JSON.stringify(result), encoding: 'utf8',
  });
  if (checked.error) throw checked.error;
  assert.equal(checked.status, 0, `result schema validation failed: ${checked.stderr}`);
}

try {
  let dependencies;
  if (published) {
    dependencies = names.map((name) => `@tk-reawakened/${name}@1.0.0`);
  } else {
    run('pnpm', ['build'], repo);
    for (const name of names) run('pnpm', ['--dir', join(repo, 'packages', name), 'pack', '--pack-destination', work], repo);
    dependencies = readdirSync(work).filter((file) => file.endsWith('.tgz')).map((file) => join(work, file));
    assert.equal(dependencies.length, names.length);
  }
  run('npm', ['install', '--registry=https://registry.npmjs.org/', '--no-audit', '--no-fund', '--ignore-scripts', ...dependencies], work, 0, isolatedEnv);
  if (published) run('npm', ['ls', '--omit=dev', '--all'], work, 0, isolatedEnv);
  run(process.execPath, [join(repo, 'tools/release/audit-installed.mjs'), work], work);
  cpSync(join(repo, 'stock/stock_rpg'), join(work, 'game'), { recursive: true });
  cpSync(join(repo, 'packages/script-cli/test/fixtures/pass-project'), join(work, 'specs'), { recursive: true });
  writeFileSync(join(work, 'invalid.prg'), 'x = (\n');
  const cli = join(work, 'node_modules/@tk-reawakened/script-cli/dist/cli.js');
  for (const runtime of [process.execPath, 'bun']) {
    for (const [args, expected] of [
      [['check', 'game'], 0],
      [['fmt', '--check', 'game'], 0],
      [['test', 'specs'], 0],
      [['check', 'invalid.prg'], 1],
      [['check', 'missing.prg'], 2],
    ]) {
      const stdout = run(runtime, [cli, 'script', ...args, '--json'], work, expected);
      const result = JSON.parse(stdout);
      validate(result);
      assert.equal(result.exitCode, expected);
      if (args[0] === 'test') assert.ok(result.summary.passed > 0, 'fixture must execute real cases');
    }
  }
  // Run the actual Action shell through npx against the local installed candidate.
  // A GitHub-hosted consumer and the published package remain separate release gates.
  for (const [project, expected, subcommands] of [
    ['game', 0, ['check', 'fmt', 'test']],
    ['invalid.prg', 1, ['check']],
  ]) {
    const env = { ...isolatedEnv, TKR_PROJECT: project, TKR_VERSION: '1.0.0' };
    const stdout = run('bash', [join(repo, '.github/actions/script/run.sh')], work, expected, env);
    const documents = stdout.trim().split(/(?<=\})\s*(?=\{)/u).map((text) => JSON.parse(text));
    assert.deepEqual(documents.map((item) => item.subcommand), subcommands);
    for (const document of documents) validate(document);
    assert.equal(documents.at(-1).exitCode, expected);
  }
  console.log(`${published ? 'Published packages' : 'Packed candidate'} passed isolated Node/Bun CLI, schema, negative-case and licence checks.${published ? '' : ' Published-registry proof is still required.'}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
