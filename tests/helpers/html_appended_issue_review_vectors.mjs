import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
export function htmlAppendedIssueReviewVectors(){
 const r=spawnSync(fileURLToPath(new URL('../../.venv/bin/python',import.meta.url)),['-B',fileURLToPath(new URL('./html_appended_issue_review_vectors.py',import.meta.url))],{cwd:fileURLToPath(new URL('../../',import.meta.url)),encoding:'utf8',timeout:10000,maxBuffer:1048576,env:{PATH:'/usr/bin:/bin',LC_ALL:'C.UTF-8'}});
 assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);
}
