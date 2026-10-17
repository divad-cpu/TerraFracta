import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const code=String.raw`
import base64,json
from copy import deepcopy
from datetime import timedelta
from tests.test_pdf_extraction_held_proposal import inputs,prepare,context,UID,ARTIFACT
from workers.pdf_result_custody import _intent
from workers.pdf_passage_binding import _stamp
from workers.private_extraction_held_proposal import _json
from scripts.rehearse_pdf_result_custody import variant
rows=[]
for name in ('empty-head','known-head','unicode-assertion'):
 data=list(inputs());ctx=deepcopy(data[-1])
 if name=='known-head':ctx['issue']['head']=dict(publication_id=UID(22),content_sha256='e'*64,changed_at=_stamp(data[1].prepared_at-timedelta(days=1)))
 if name=='unicode-assertion':
  packet=json.loads(data[0]);raw=base64.b64decode(packet['packet_base64']);raw,e=variant(raw,data[1],assertion='🙂'*600)
  intent=_intent(raw,e);proposal=json.loads(base64.b64decode(json.loads(raw)['output']['base64']))
  receipt=_json(dict(schema_version=1,kind='invented_pdf_result_stored',operation_id=e.operation_id,artifact_id=ARTIFACT,stored_at=_stamp(e.prepared_at+timedelta(seconds=1)),intent_base64=base64.b64encode(intent).decode(),packet_base64=base64.b64encode(raw).decode(),intent_sha256=__import__('hashlib').sha256(intent).hexdigest(),packet_sha256=e.packet_sha256,intent_bytes=len(intent),packet_bytes=len(raw)))
  data[:3]=receipt,e,intent;ctx=context(e,proposal)
 result=prepare(tuple(data),ctx)
 rows.append(dict(name=name,payloadJson=result.payload_raw.decode(),selectionJson=result.selection_raw.decode(),provenanceJson=result.provenance_raw.decode(),contextJson=result.context_raw.decode()))
print(json.dumps(rows,ensure_ascii=False,separators=(',',':')))
`;
let cached;
export function pdfHeldProposalVectors(){
 if(cached)return cached;
 const run=spawnSync(root+'.venv/bin/python',['-B','-c',code],{cwd:root,encoding:'utf8',timeout:60000,maxBuffer:131072});
 if(run.status!==0||run.error||run.stderr)throw Error('invented_pdf_preparation_vectors_unavailable');
 cached=JSON.parse(run.stdout);return cached;
}
