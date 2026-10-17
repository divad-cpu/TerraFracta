import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
function run(extra=[]) {
  const result=spawnSync(fileURLToPath(new URL('../../.venv/bin/python',import.meta.url)),['-B',fileURLToPath(new URL('./html_preparation_review_vectors.py',import.meta.url)),...extra],
    {cwd:fileURLToPath(new URL('../../',import.meta.url)),encoding:'utf8',timeout:10000,maxBuffer:1048576,env:{PATH:'/usr/bin:/bin',LC_ALL:'C.UTF-8'}});
  assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
}

export function htmlPreparationReviewVectors(){return run();}
export function htmlPreparationMarkupVector(){return run(["--markup"]);}
