import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// One actual invented producer invocation per test module; cases reuse its
// immutable JSON output. No per-Node-case PDF replay or database is involved.
let cached;
export function pdfAppendedIssueReviewVector(onProduced){
 if(cached!==undefined)return structuredClone(cached);
 const program=`import json
from hashlib import sha256
from unittest.mock import patch
from tests.test_pdf_appended_issue_review import fixture
from workers.pdf_appended_issue_review import prepare_pdf_appended_issue_review,pdf_composition_parts
from workers.pdf_passage_binding import _stamp
import workers.pdf_text_inspection as inspector
children=[]
real=inspector.subprocess.Popen
def start(*args,**kwargs):
 child=real(*args,**kwargs);children.append(child);return child
with patch.object(inspector.subprocess,'Popen',side_effect=start):
 values,_=fixture()
 prepared=prepare_pdf_appended_issue_review(**values)
assert len(children)==10
assert all(c.poll()is not None and all(getattr(c,k).closed for k in ('stdin','stdout','stderr'))for c in children)
parts=pdf_composition_parts(prepared)
b=dict(zip(('candidateReportJson','baselineJson','canonicalBaselineJson','contextJson','proposalJson','compositionJson'),(p.decode()for p in parts)))
r=json.loads(b['candidateReportJson'])
e=dict(compositionSha256=sha256(parts[5]).hexdigest(),candidateReportSha256=sha256(parts[0]).hexdigest(),preparationIntentJson=r['intent_json'],baselineSha256=sha256(parts[1]).hexdigest(),contextSha256=sha256(parts[3]).hexdigest(),observedAt=_stamp(values['observed_at']),preparationArtifactId=values['expected'].artifact_id,preparationStoredAt=_stamp(values['expected'].stored_at))
print(json.dumps(dict(kind='fictional_pdf_appended_issue_review',bundle=b,expected=e,producer=dict(fixtureAndCompositionChildren=len(children),allChildrenExitedAndThreePipesClosed=True)),ensure_ascii=False,separators=(',',':')))
`;
 const r=spawnSync(fileURLToPath(new URL('../../.venv/bin/python',import.meta.url)),['-B','-c',program],{cwd:fileURLToPath(new URL('../../',import.meta.url)),encoding:'utf8',timeout:30000,maxBuffer:1048576,env:{PATH:'/usr/bin:/bin',LC_ALL:'C.UTF-8'}});
 assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);assert.equal(r.stderr,'');
 if(onProduced!==undefined)onProduced(r.stdout);cached=JSON.parse(r.stdout);return structuredClone(cached);
}
