// Publish only missing immutable versions. Existing versions must match the exact candidate bytes.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { publicationState } from './publication-state.mjs';

const repo = resolve(import.meta.dirname, '../..');
const work = mkdtempSync(join(tmpdir(), 'tkr-publish-'));
const names = ['core', 'plugin-tk2-compat', 'runner-harness', 'runner-headless', 'script-tools', 'script-spec', 'script-cli'];
const registry = 'https://registry.npmjs.org/';

function run(command, args, cwd = repo) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${result.stderr}`);
}

async function registered(name, version, integrity) {
  const response = await fetch(`${registry}${encodeURIComponent(name)}/${encodeURIComponent(version)}`, { signal: AbortSignal.timeout(30000) });
  const metadata = response.status === 200 ? await response.json() : null;
  return publicationState(response.status, metadata, name, version, integrity) === 'matching';
}

try {
  const candidates = [];
  for (const name of names) {
    const dir = join(repo, 'packages', name);
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    if (manifest.name !== `@tk-reawakened/${name}` || manifest.version !== '1.0.0' || manifest.private === true) throw new Error(`unexpected package manifest: ${name}`);
    run('pnpm', ['--dir', dir, 'pack', '--pack-destination', work]);
    const archive = join(work, `tk-reawakened-${name}-1.0.0.tgz`);
    if (!readdirSync(work).includes(`tk-reawakened-${name}-1.0.0.tgz`)) throw new Error(`missing packed archive: ${name}`);
    const integrity = `sha512-${createHash('sha512').update(readFileSync(archive)).digest('base64')}`;
    candidates.push({ name: manifest.name, version: manifest.version, archive, integrity });
  }
  // Refuse mismatches across the complete closure before the first publish.
  for (const candidate of candidates) candidate.exists = await registered(candidate.name, candidate.version, candidate.integrity);
  for (const candidate of candidates) {
    if (candidate.exists) {
      console.log(`${candidate.name}@${candidate.version} already matches; skipping`);
      continue;
    }
    console.log(`Publishing ${candidate.name}@${candidate.version}`);
    run('npm', ['publish', candidate.archive, '--registry', registry, '--access', 'public']);
    if (!await registered(candidate.name, candidate.version, candidate.integrity)) throw new Error(`${candidate.name}@${candidate.version} is not visible after publish; verify before resuming`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
