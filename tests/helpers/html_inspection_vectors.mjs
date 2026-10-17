import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Run only the new pure producer over bounded invented inputs. The fixed helper
// path and interpreter receive no source URL, secret, command or caller option.
export function htmlInspectionVectors() {
  const run = spawnSync('python3', ['-B', fileURLToPath(new URL('./html_inspection_vectors.py', import.meta.url))], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8', maxBuffer: 1048576, timeout: 10000,
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.error, undefined);
  return JSON.parse(run.stdout);
}
