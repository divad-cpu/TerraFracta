import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export function htmlHeldProposalVectors() {
  return JSON.parse(execFileSync(fileURLToPath(new URL('../../.venv/bin/python', import.meta.url)),
    ['-B', fileURLToPath(new URL('./html_held_proposal_vectors.py', import.meta.url))],
    { cwd: fileURLToPath(new URL('../../', import.meta.url)), env: { PATH: '/usr/bin:/bin', LC_ALL: 'C.UTF-8' },
      encoding: 'utf8', timeout: 10000, maxBuffer: 1048576 }));
}
