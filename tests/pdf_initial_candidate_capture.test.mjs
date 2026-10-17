import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {preparePdfInitialCandidateCaptureForWork as prepare,preparePdfInitialCandidateCaptureRead as read,parseStoredPdfInitialCandidateCapture as parse,PDF_INITIAL_CANDIDATE_CAPTURE_SQL,PDF_INITIAL_CANDIDATE_CAPTURE_READ_SQL} from '../src/server/pdf-initial-candidate-capture.ts';
import {pdfPreparationReviewReport} from '../src/server/pdf-preparation-review-report.ts';
import {canonicalProposalJson as canonical} from '../src/operator-proposal-capture.ts';
import {pdfPreparationReviewFixtures,sha,instantAfter,resignReport,resignIntent} from './helpers/pdf_preparation_review_fixture.mjs';
const rows=pdfPreparationReviewFixtures(),fixture=()=>structuredClone(rows[0]),other='90000000-0000-4000-8000-000000000099';
const work=f=>({runId:JSON.parse(f.report.parts.selection_json).runId,requestFingerprint:'a'.repeat(64),workClaimId:'90000000-0000-4000-8000-000000000098'});
const make=f=>prepare(work(f),f.raw,f.expected),refuse=fn=>assert.throws(fn,/^Error: pdf_initial_candidate_capture_unavailable$/),b64=s=>Buffer.from(s,'utf8').toString('base64');
function receipt(f=fixture()){
 const c=make(f),i=JSON.parse(c.intentJson),p=JSON.parse(f.report.parts.provenance_json),at=instantAfter(f.report.observed_at,3);
 const value={schema_version:1,kind:'invented_pdf_initial_candidate_capture_stored',capture_id:i.capture_id,preparation_operation_id:i.preparation_operation_id,stored_at:instantAfter(f.report.observed_at,2),intent_base64:b64(c.intentJson),report_base64:b64(f.raw),
  capture:{captureId:i.capture_id,runId:i.run_id,decisionId:i.decision_id,issueId:i.issue_id,basePublicationId:null,baseHeadChangedAt:null,baseContentSha256:null,proposalSha256:sha(f.report.parts.payload_json),capturedAt:instantAfter(f.report.observed_at,1),sourceReceipts:[{sourceVersionId:p.current.source_version_id,contentSha256:p.current.content_sha256,retrievedAt:p.current.retrieved_at,languageCode:p.current.language_code}]}};
 return {f,c,value,at};
}
const receive=({f,c,value,at})=>parse(Buffer.from(JSON.stringify(value)),c.intentJson,f.expected,at);
function rewrite(f,fn){const p=JSON.parse(f.report.parts.provenance_json),s=JSON.parse(f.report.parts.selection_json),payload=JSON.parse(f.report.parts.payload_json);fn(p,s,payload,f);
 f.report.parts.payload_json=canonical(payload);f.report.parts.selection_json=canonical(s);p.payload_sha256=sha(f.report.parts.payload_json);p.selection_sha256=sha(f.report.parts.selection_json);p.supplied_context_sha256=sha(f.report.parts.context_json);p.context_sha256=sha(canonical(p.independent_context));f.report.parts.provenance_json=canonical(p);
 const m=JSON.parse(f.report.intent_json);m.payload_sha256=sha(f.report.parts.payload_json);m.selection_sha256=sha(f.report.parts.selection_json);m.provenance_sha256=sha(f.report.parts.provenance_json);m.context_raw_sha256=sha(f.report.parts.context_json);return resignIntent(f,m);}

test('empty-head PDF candidate produces five fixed uninstalled operands retaining four independent provenance identities',t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('No source request'));
 for(const f of [rows[0],rows[2]]){const c=make(f),i=JSON.parse(c.intentJson),m=JSON.parse(f.report.intent_json),s=JSON.parse(f.report.parts.selection_json);
  assert.equal(c.sql,PDF_INITIAL_CANDIDATE_CAPTURE_SQL);assert.match(c.sql,/^SELECT tf_pdf_initial_candidate\.capture_for_work\(/);assert.deepEqual(c.sql.match(/\$\d+/g),['$1','$2','$3','$4','$5']);
  assert.deepEqual(c.values,[work(f).runId,work(f).requestFingerprint,work(f).workClaimId,b64(c.intentJson),b64(f.raw)]);assert.equal('capture' in c,false);assert.equal('genericValues' in c,false);assert.equal(Buffer.from(c.values[4],'base64').toString('utf8'),f.raw);
  assert.equal(i.kind,'invented_pdf_initial_candidate_capture');assert.equal(i.base_publication_id,null);assert.equal(i.snapshot_intent,'single_claim_technical_review_not_issue_replacement');assert.equal(i.capture_id,s.captureId);
  assert.equal(i.preparation_operation_id,f.report.preparation.operation_id);assert.equal(i.preparation_artifact_id,f.expected.preparationArtifactId);assert.equal(i.preparation_full_receipt_sha256,f.report.preparation.receipt_sha256);assert.equal(i.report_sha256,f.expected.reportSha256);assert.equal(i.preparation_intent_sha256,sha(f.expected.preparationIntentJson));
  assert.deepEqual(i.part_sha256,[m.payload_sha256,m.selection_sha256,m.provenance_sha256,m.context_raw_sha256]);assert.equal(i.preparation_observed_at,f.report.observed_at);assert.equal(c.intentSha256,sha(c.intentJson));assert.ok(c.receiptEstimate<=131072);assert.ok(Buffer.byteLength(c.intentJson)<=4096);
  assert.match(c.evidenceState,/unexecuted_not_whole_issue_or_publication/);assert.deepEqual(read(c.intentJson),{sql:PDF_INITIAL_CANDIDATE_CAPTURE_READ_SQL,values:[s.captureId]});assert.ok(Object.isFrozen(c)&&Object.isFrozen(c.values)&&Object.isFrozen(c.work)&&Object.isFrozen(c.expected));}
});
test('known head and every partly-null head refuse without treating one candidate as a whole issue',()=>{
 assert.ok(pdfPreparationReviewReport(rows[1].raw,rows[1].expected));refuse(()=>make(rows[1]));
 for(const key of ['publication_id','content_sha256','changed_at']){const f=rewrite(fixture(),p=>p.independent_context.issue.head[key]=key==='content_sha256'?'f'.repeat(64):key==='changed_at'?p.prepared_at:other);refuse(()=>make(f));}
});
test('all five independent report expectations and exact preparation grammar remain mandatory',()=>{
 for(const key of Object.keys(rows[0].expected)){let f=fixture();delete f.expected[key];refuse(()=>make(f));f=fixture();f.expected[key]=key.endsWith('At')?instantAfter(f.expected[key],1):key==='preparationIntentJson'?f.expected[key]+' ':key==='preparationArtifactId'?other:'f'.repeat(64);refuse(()=>make(f));}
 for(const kind of ['private_html_preparation_review_report','private_detached_preparation_report']){const f=fixture();f.report.kind=kind;resignReport(f);refuse(()=>make(f));}
 const f=fixture();f.expected[Symbol('PRIVATE')]='PRIVATE';refuse(()=>make(f));let calls=0;const g=fixture();Object.defineProperty(g.expected,'reportSha256',{enumerable:true,get(){calls++;throw Error('PRIVATE');}});refuse(()=>make(g));assert.equal(calls,0);
});
test('work selectors preserve accepted once-only own getters while rejecting hidden symbol and post-getter namespace mutation',()=>{
 const f=fixture(),plain=work(f),target=Object.create(null),counts={};for(const key of Object.keys(plain)){counts[key]=0;Object.defineProperty(target,key,{enumerable:true,get(){counts[key]++;return plain[key];}});}
 assert.deepEqual(prepare(target,f.raw,f.expected).values,make(f).values);assert.deepEqual(Object.values(counts),[1,1,1]);
 for(const kind of ['symbol','hidden','late-add','late-delete','late-hide']){const w=work(f);let calls=0;if(kind==='symbol')w[Symbol('PRIVATE')]='PRIVATE';if(kind==='hidden')Object.defineProperty(w,'PRIVATE',{value:'PRIVATE'});
  if(kind.startsWith('late-')){const saved=w.workClaimId;Object.defineProperty(w,'workClaimId',{enumerable:true,get(){calls++;if(kind==='late-add')w.PRIVATE='PRIVATE';if(kind==='late-delete')delete w.runId;if(kind==='late-hide')Object.defineProperty(w,'runId',{value:w.runId,enumerable:false});return saved;}});}
  refuse(()=>prepare(w,f.raw,f.expected));assert.equal(calls,kind.startsWith('late-')?1:0);}
 for(const w of [{...plain,runId:other},{...plain,requestFingerprint:'A'.repeat(64)},{...plain,workClaimId:'90000000-0000-5000-8000-000000000098'},{...plain,url:'postgres://PRIVATE'}])refuse(()=>prepare(w,f.raw,f.expected));
});
test('supplied native-shaped receipt retains entire PDF report source bytes four parts and historical versus fresh times',()=>{
 const data=receipt(),r=receive(data),p=JSON.parse(data.f.report.parts.provenance_json);
 assert.equal(r.reportJson,data.f.raw);assert.deepEqual(r.preparation.report.parts,data.f.report.parts);assert.equal(r.preparation.candidate.proof.current.content_sha256,p.current.content_sha256);assert.equal(r.preparation.candidate.proof.current.selected_pages[0].page_number,1);
 assert.equal(r.capture.basePublicationId,null);assert.equal(r.preparation.report.observed_at,data.f.report.observed_at);assert.equal(r.observedAt,data.at);assert.equal(r.storedAt,data.value.stored_at);assert.equal(r.receiptSha256,sha(Buffer.from(JSON.stringify(data.value))));assert.match(r.evidenceState,/supplied_.*not_authenticated_or_publication/);
 for(const v of [r,r.capture,r.capture.sourceReceipts,r.capture.sourceReceipts[0],r.preparation,r.preparation.candidate.proof.current.selected_pages])assert.ok(Object.isFrozen(v));
});
test('native capture selectors null base and all independently retained intent joins refuse substitution',()=>{
 for(const mutate of [v=>v.capture_id=other,v=>v.preparation_operation_id=other,...['captureId','runId','decisionId','issueId'].map(key=>v=>v.capture[key]=other),v=>v.capture.basePublicationId=other,v=>v.capture.baseHeadChangedAt=v.stored_at,v=>v.capture.baseContentSha256='f'.repeat(64),v=>v.capture.proposalSha256='f'.repeat(64)]){const d=receipt();mutate(d.value);refuse(()=>receive(d));}
 for(const field of ['capture_id','run_id','decision_id','issue_id','preparation_operation_id','preparation_artifact_id','preparation_intent_sha256','preparation_full_receipt_sha256','report_sha256','part_sha256','preparation_observed_at']){const d=receipt(),i=JSON.parse(d.c.intentJson);i[field]=field==='part_sha256'?Array(4).fill('f'.repeat(64)):field.endsWith('_sha256')?'f'.repeat(64):field.endsWith('_at')?instantAfter(i[field],-1):other;const raw=canonical(i);d.value.intent_base64=b64(raw);refuse(()=>parse(Buffer.from(JSON.stringify(d.value)),raw,d.f.expected,d.at));}
});
test('one current source receipt must match binary original SHA retrieval language and version rather than derived text SHA',()=>{
 for(const mutate of [v=>v.capture.sourceReceipts=[],v=>v.capture.sourceReceipts.push(v.capture.sourceReceipts[0]),...['sourceVersionId','contentSha256','retrievedAt','languageCode'].map(key=>v=>v.capture.sourceReceipts[0][key]=key==='sourceVersionId'?other:key==='contentSha256'?'f'.repeat(64):key==='retrievedAt'?instantAfter(v.capture.sourceReceipts[0][key],1):'fr')]){const d=receipt();mutate(d.value);refuse(()=>receive(d));}
 const d=receipt(),p=JSON.parse(d.f.report.parts.provenance_json);assert.notEqual(p.current.content_sha256,p.current.selected_pages[0].page_text_sha256);d.value.capture.sourceReceipts[0].contentSha256=p.current.selected_pages[0].page_text_sha256;refuse(()=>receive(d));
});
test('capture storage and observation chronology preserves exact microseconds and rejects impossible dates',()=>{
 for(const mode of ['before-preparation','stored-before-capture','future-storage','invalid-date']){const d=receipt();if(mode==='before-preparation')d.value.capture.capturedAt=instantAfter(d.f.report.observed_at,-1);if(mode==='stored-before-capture')d.value.stored_at=instantAfter(d.value.capture.capturedAt,-1);if(mode==='future-storage')d.value.stored_at=instantAfter(d.at,1);if(mode==='invalid-date')d.value.stored_at='2026-02-30T00:00:00.000000Z';refuse(()=>receive(d));}
 const d=receipt();d.value.capture.capturedAt=d.f.report.observed_at;d.value.stored_at=d.f.report.observed_at;d.at=d.f.report.observed_at;assert.equal(receive(d).storedAt,d.at);
 for(const at of [undefined,'0000-01-01T00:00:00.000000Z',d.at.replace('.000000Z','Z'),d.at.replace('Z','+00:00'),d.at.replace('000000Z','0000001Z')])refuse(()=>parse(Buffer.from(JSON.stringify(d.value)),d.c.intentJson,d.f.expected,at));
});
test('raw native framing closed keys duplicate and escaped aliases refuse all data',()=>{
 for(const mutate of [v=>v.schema_version=true,v=>v.EXTRA='PRIVATE',v=>v.capture.EXTRA=true,v=>v.capture.sourceReceipts[0].EXTRA=true,v=>delete v.preparation_operation_id]){const d=receipt();mutate(d.value);refuse(()=>receive(d));}
 for(const change of [s=>s.replace('"schema_version":1','"schema_version":true,"schema_version":1'),s=>s.replace('"kind":','"k\\u0069nd":'),s=>s.replace('"sourceVersionId":','"sourceVersionId":"PRIVATE","sourceVersionId":'),s=>s.replace('"captureId":','"captureI\\u0064":')]){const d=receipt(),raw=JSON.stringify(d.value),changed=change(raw);assert.notEqual(changed,raw);refuse(()=>parse(Buffer.from(changed),d.c.intentJson,d.f.expected,d.at));}
});
test('base64 UTF8 BOM byte wrappers and independent expected mutations refuse without leaking private strings',()=>{
 for(const mutate of [v=>v.intent_base64=b64('{}'),v=>v.report_base64=b64('PRIVATE'),v=>v.report_base64+='\n',v=>v.intent_base64='!!!!',v=>v.report_base64=b64(rows[0].raw+' '),v=>v.report_base64=Buffer.from([255]).toString('base64')]){const d=receipt();mutate(d.value);refuse(()=>receive(d));}
 const d=receipt(),raw=Buffer.from(JSON.stringify(d.value));for(const value of [raw.toString(),new DataView(raw.buffer,raw.byteOffset,raw.byteLength),Buffer.alloc(131073),Buffer.from([255]),Buffer.concat([Buffer.from([239,187,191]),raw])])refuse(()=>parse(value,d.c.intentJson,d.f.expected,d.at));
 for(const key of ['intent_base64','report_base64']){const d=receipt();d.value[key]=Buffer.concat([Buffer.from([239,187,191]),Buffer.from(d.value[key],'base64')]).toString('base64');refuse(()=>receive(d));}
 const guarded=Buffer.from(raw);Object.defineProperty(guarded,'length',{get(){throw Error('PRIVATE');}});Object.defineProperty(guarded,'byteLength',{get(){throw Error('PRIVATE');}});assert.equal(parse(guarded,d.c.intentJson,d.f.expected,d.at).capture.captureId,d.value.capture.captureId);
 const e={...d.f.expected,reportSha256:'f'.repeat(64)};refuse(()=>parse(raw,d.c.intentJson,e,d.at));
});
test('full receipt budget refuses an admitted large passive preparation despite its separate report allowance',()=>{
 // Deliberately opaque supplied context is not parsed by the existing passive
 // reader. This is a grammar/budget fixture, not actual producer or SQL proof.
 const f=rewrite(fixture(),(p,s,payload,f)=>f.report.parts.context_json='\u0000'.repeat(20000));
 assert.ok(Buffer.byteLength(f.raw)<262144);assert.ok(pdfPreparationReviewReport(f.raw,f.expected));refuse(()=>make(f));
 for(const raw of ['x'.repeat(262145),'\ud800',Buffer.from(rows[0].raw)])refuse(()=>prepare(work(rows[0]),raw,rows[0].expected));
 for(const raw of ['{}',make(rows[0]).intentJson+' ',Buffer.from(make(rows[0]).intentJson),'x'.repeat(4097)])refuse(()=>read(raw));
});
test('altered candidate support shape and all four bytes cannot enter even after outer report resigning',()=>{
 for(const key of Object.keys(rows[0].report.parts)){const f=fixture();f.report.parts[key]+=' ';resignReport(f);refuse(()=>make(f));}
 for(const fn of [p=>p.kind='detached_html_extraction_proposal',p=>p.limits.publication_authorized=true,p=>p.independent_context.support.assignment_state='approved',(p,s,payload)=>payload.snapshot.claims.push(payload.snapshot.claims[0]),(p,s,payload)=>payload.conflictCoverage='complete']){const f=rewrite(fixture(),fn);refuse(()=>make(f));}
});

test('generic capture UUID4/5 is preserved by retained read and native receipt while preparation UUIDs remain broad',()=>{
 const localSha=s=>createHash('sha256').update(s,'utf8').digest('hex'),localB64=s=>Buffer.from(s,'utf8').toString('base64');
 const f=JSON.parse(readFileSync('fixtures/fictional-stored-pdf-preparation-review.json','utf8')),original=structuredClone(f),r=JSON.parse(f.reportJson),s=JSON.parse(r.parts.selection_json),p=JSON.parse(r.parts.provenance_json);
 const w={runId:s.runId,requestFingerprint:'a'.repeat(64),workClaimId:'90000000-0000-4000-8000-000000000098'},baseline=prepare(w,f.reportJson,f.expected),i=JSON.parse(baseline.intentJson);
 function native(intentJson,report){const j=JSON.parse(intentJson),v=JSON.parse(report),proof=JSON.parse(v.parts.provenance_json);return Buffer.from(JSON.stringify({schema_version:1,kind:'invented_pdf_initial_candidate_capture_stored',capture_id:j.capture_id,preparation_operation_id:j.preparation_operation_id,stored_at:'2026-10-17T15:00:01.000000Z',intent_base64:localB64(intentJson),report_base64:localB64(report),capture:{captureId:j.capture_id,runId:j.run_id,decisionId:j.decision_id,issueId:j.issue_id,basePublicationId:null,baseHeadChangedAt:null,baseContentSha256:null,proposalSha256:localSha(v.parts.payload_json),capturedAt:'2026-10-17T15:00:00.000000Z',sourceReceipts:[{sourceVersionId:proof.current.source_version_id,contentSha256:proof.current.content_sha256,retrievedAt:proof.current.retrieved_at,languageCode:proof.current.language_code}]}}));}
 assert.ok(parse(native(baseline.intentJson,f.reportJson),baseline.intentJson,f.expected,'2026-10-17T15:00:02.000000Z'));
 const v1='90000000-0000-1000-8000-000000000099';s.captureId=v1;p.independent_context.content.capture_id=v1;const context=JSON.parse(r.parts.context_json);context.content.capture_id=v1;r.parts.context_json=canonical(context);r.parts.selection_json=canonical(s);p.context_sha256=localSha(canonical(p.independent_context));p.supplied_context_sha256=localSha(r.parts.context_json);p.selection_sha256=localSha(r.parts.selection_json);r.parts.provenance_json=canonical(p);
 const m=JSON.parse(r.intent_json);m.selection_sha256=localSha(r.parts.selection_json);m.provenance_sha256=localSha(r.parts.provenance_json);m.context_raw_sha256=localSha(r.parts.context_json);r.intent_json=canonical(m);r.preparation.intent_sha256=localSha(r.intent_json);f.expected.preparationIntentJson=r.intent_json;f.reportJson=canonical(r);f.expected.reportSha256=localSha(f.reportJson);
 assert.ok(pdfPreparationReviewReport(f.reportJson,f.expected),'passive review metadata intentionally has broader UUID grammar');assert.throws(()=>prepare(w,f.reportJson,f.expected),/^Error: pdf_initial_candidate_capture_unavailable$/);
 const retained=canonical({...i,capture_id:v1,preparation_intent_sha256:localSha(f.expected.preparationIntentJson),report_sha256:f.expected.reportSha256,part_sha256:[m.payload_sha256,m.selection_sha256,m.provenance_sha256,m.context_raw_sha256]});
 let readAccepted=false,nativeAccepted=false;try{readAccepted=read(retained).values[0]===v1;}catch{}try{nativeAccepted=parse(native(retained,f.reportJson),retained,f.expected,'2026-10-17T15:00:02.000000Z').capture.captureId===v1;}catch{}
 assert.deepEqual({readAccepted,nativeAccepted},{readAccepted:false,nativeAccepted:false});
 for(const key of ['capture_id','run_id','decision_id','issue_id'])assert.throws(()=>read(canonical({...i,[key]:v1})),/^Error: pdf_initial_candidate_capture_unavailable$/);
 // Preparation identifiers are NOT generic capture identifiers. Preserve their
 // broader accepted versions rather than narrowing all UUIDs indiscriminately.
 const broad=JSON.parse(original.reportJson),metadata=JSON.parse(broad.intent_json);metadata.operation_id=v1;broad.preparation.operation_id=v1;broad.preparation.artifact_id=v1;broad.intent_json=canonical(metadata);broad.preparation.intent_sha256=localSha(broad.intent_json);const broadRaw=canonical(broad),broadExpected={...original.expected,preparationIntentJson:broad.intent_json,preparationArtifactId:v1,reportSha256:localSha(broadRaw)},broadCommand=prepare(w,broadRaw,broadExpected);
 assert.ok(parse(native(broadCommand.intentJson,broadRaw),broadCommand.intentJson,broadExpected,'2026-10-17T15:00:02.000000Z'));
});
