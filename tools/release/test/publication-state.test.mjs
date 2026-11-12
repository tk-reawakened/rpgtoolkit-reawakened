import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { publicationState } from '../publication-state.mjs';

const inspect = (status, metadata) => publicationState(status, metadata, '@tk-reawakened/core', '1.0.0', 'sha512-candidate');

test('publishes an absent version', () => assert.equal(inspect(404, null), 'missing'));
test('resumes only when the published tarball has the same integrity', () => {
  assert.equal(inspect(200, { dist: { integrity: 'sha512-candidate' } }), 'matching');
  assert.throws(() => inspect(200, { dist: { integrity: 'sha512-different' } }), /different integrity/);
  assert.throws(() => inspect(200, {}), /different integrity/);
});
test('does not treat authorization or registry errors as absence', () => {
  for (const status of [401, 403, 429, 500]) assert.throws(() => inspect(status, null), /HTTP/);
});
