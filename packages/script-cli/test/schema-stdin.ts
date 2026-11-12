// Release preflight uses the same fail-closed schema validator as CLI tests.
import { readFileSync } from 'node:fs';
import { loadSchema, problems } from './schema.ts';

const data: unknown = JSON.parse(readFileSync(0, 'utf8'));
const issues = problems(data, loadSchema('tkr-script-result.schema.json'));
if (issues.length > 0) {
  process.stderr.write(`${issues.join('\n')}\n`);
  process.exitCode = 1;
}
