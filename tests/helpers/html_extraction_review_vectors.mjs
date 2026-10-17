import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Fixed local Python producer over illustrative complete receipts. No old test
// suite, backend, provider, URL request or caller-selected command is executed.
export function htmlExtractionReviewVectors() {
  const run = spawnSync(fileURLToPath(new URL('../../.venv/bin/python', import.meta.url)), ['-B', fileURLToPath(new URL('./html_extraction_review_vectors.py', import.meta.url))], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8', timeout: 10000, maxBuffer: 1048576,
  });
  assert.equal(run.status, 0, run.stderr); assert.equal(run.error, undefined);
  return JSON.parse(run.stdout);
}
