import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {preparePdfAppendedIssueCapture as prepare,preparePdfAppendedIssueCaptureRead as read,parseStoredPdfAppendedIssueCapture as parse,PDF_APPENDED_CAPTURE_SQL,PDF_APPENDED_CAPTURE_READ_SQL} from '../src/server/pdf-appended-issue-capture.ts';
import {admitPdfAppendedIssueReview as admit} from '../src/server/pdf-appended-issue-review.ts';
import {canonicalProposalJson as canonical} from '../src/operator-proposal-capture.ts';
import {pdfAppendedIssueReviewVector} from './helpers/pdf_appended_issue_review_vectors.mjs';
const fixture=pdfAppendedIssueReviewVector(),sample=()=>structuredClone(fixture),b64=s=>Buffer.from(s,'utf8').toString('base64'),sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
const refuse=fn=>assert.throws(fn,/^Error: pdf_appended_issue_capture_unavailable$/);
const fields=['candidateReportJson','baselineJson','canonicalBaselineJson','contextJson','proposalJson','compositionJson'];
function plus(at,delta){const value=BigInt(Date.parse(at.slice(0,19)+'Z'))*1000n+BigInt(at.slice(20,26))+BigInt(delta);return new Date(Number(value/1000n)).toISOString().slice(0,19)+'.'+String(value%1000000n).padStart(6,'0')+'Z';}
function receipt(vector=sample()){
 const command=prepare(vector.bundle,vector.expected),i=JSON.parse(command.intentJson),p=JSON.parse(vector.bundle.proposalJson),ctx=JSON.parse(vector.bundle.contextJson),report=JSON.parse(vector.bundle.candidateReportJson),current=JSON.parse(report.parts.provenance_json).current;
 const sourceReceipts=p.dependencyManifest.sourceVersionIds.map(id=>({sourceVersionId:id,contentSha256:id===current.source_version_id?current.content_sha256:'f'.repeat(64),retrievedAt:p.snapshot.claims.flatMap(c=>c.evidence).find(e=>e.sourceVersionId===id).retrievedAt,languageCode:'en'}));
 const value={schema_version:1,kind:'invented_pdf_appended_issue_capture_stored',capture_id:i.capture_id,preparation_operation_id:i.preparation_operation_id,stored_at:plus(i.composition_observed_at,2000000),intent_base64:b64(command.intentJson),parts_base64:command.values.slice(1),
 capture:{captureId:i.capture_id,runId:i.run_id,decisionId:i.decision_id,issueId:i.issue_id,basePublicationId:i.base_publication_id,baseHeadChangedAt:ctx.baseline.head_changed_at,baseContentSha256:i.part_sha256[1],proposalSha256:sha(vector.bundle.proposalJson),capturedAt:plus(i.composition_observed_at,1000000),sourceReceipts}};
 return{command,value,raw:Buffer.from(JSON.stringify(value,null,1)),at:plus(i.composition_observed_at,3000000),expected:vector.expected};
}
function parseValue(value,r,intent=r.command.intentJson,expected=r.expected,at=r.at){return parse(Buffer.from(JSON.stringify(value)),intent,expected,at);}
// Large manually resealed semantic correspondence, not a new Python producer
// or source fact. The opaque raw context keeps exact independently bound bytes.
function expanded(vector,extra){
 const {bundle:b,expected:e}=structuredClone(vector),report=JSON.parse(b.candidateReportJson),p=JSON.parse(report.parts.provenance_json),s=JSON.parse(report.parts.selection_json),payload=JSON.parse(report.parts.payload_json),ctx=JSON.parse(report.parts.context_json);
 Object.assign(ctx.content,{title:'😀'.repeat(230),summary:'😀'.repeat(1550),period_label:'😀'.repeat(150),publisher:'😀'.repeat(150),source_title:'😀'.repeat(230)});ctx.support.assertion='😀'.repeat(590);
 Object.assign(payload.snapshot,{title:ctx.content.title,summary:ctx.content.summary});Object.assign(payload.snapshot.claims[0],{assertion:ctx.support.assertion,periodLabel:ctx.content.period_label});
 Object.assign(payload.snapshot.claims[0].evidence[0],{publisher:ctx.content.publisher,title:ctx.content.source_title,url:'https://example.org/'+('a'.repeat(1900))});
 for(const source of [p.current,p.previous]){source.source_url=payload.snapshot.claims[0].evidence[0].url;source.selected_pages=[source.selected_pages[0],...Array.from({length:7},(_,i)=>({locator:'😀'.repeat(199)+String(i),page_number:i+2,page_text_sha256:(source===p.current?'a':'b').repeat(64)}))];}
 p.independent_context=ctx;p.context_sha256=sha(canonical(ctx));report.parts.context_json=canonical(ctx)+' '.repeat(extra);p.supplied_context_sha256=sha(report.parts.context_json);
 report.parts.payload_json=canonical(payload);p.payload_sha256=sha(report.parts.payload_json);report.parts.provenance_json=canonical(p);
 const metadata=JSON.parse(report.intent_json);for(const[k,name]of[['payload_sha256','payload_json'],['selection_sha256','selection_json'],['provenance_sha256','provenance_json'],['context_raw_sha256','context_json']])metadata[k]=sha(report.parts[name]);
 report.intent_json=canonical(metadata);report.preparation.intent_sha256=sha(report.intent_json);b.candidateReportJson=canonical(report);e.candidateReportSha256=sha(b.candidateReportJson);e.preparationIntentJson=report.intent_json;
 const proposal=JSON.parse(b.proposalJson);proposal.snapshot.claims[proposal.snapshot.claims.length-1]=payload.snapshot.claims[0];b.proposalJson=canonical(proposal);
 const proof=JSON.parse(b.compositionJson);proof.candidate_report_sha256=e.candidateReportSha256;proof.candidate_preparation_intent_sha256=sha(report.intent_json);proof.candidate_part_sha256=[metadata.payload_sha256,metadata.selection_sha256,metadata.provenance_sha256,metadata.context_raw_sha256];proof.proposal_sha256=sha(b.proposalJson);proof.appended_claim_sha256=sha(canonical(payload.snapshot.claims[0]));b.compositionJson=canonical(proof);e.compositionSha256=sha(b.compositionJson);
 return{bundle:b,expected:e,contextBytes:Buffer.byteLength(report.parts.context_json),transfer:Buffer.byteLength(canonical(Object.fromEntries(fields.map((name,i)=>[['candidate_report','baseline','canonical_baseline','context','proposal','composition'][i]+'_base64',b64(b[name])]))))};
}
test('fixed uninstalled seven-part command preserves complete expected intent and no companionless generic command',t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('No request'));
 const v=sample(),c=prepare(v.bundle,v.expected),i=JSON.parse(c.intentJson);
 assert.deepEqual(fixture.producer,{fixtureAndCompositionChildren:10,allChildrenExitedAndThreePipesClosed:true});
 assert.equal(c.sql,PDF_APPENDED_CAPTURE_SQL);assert.equal(c.values.length,7);assert.deepEqual(c.sql.match(/\$\d+/g),['$1','$2','$3','$4','$5','$6','$7']);assert.equal(c.values[0],b64(c.intentJson));
 assert.deepEqual(c.values.slice(1),fields.map(k=>b64(v.bundle[k])));assert.deepEqual(c.expected,v.expected);assert.equal(i.preparation_artifact_id,v.expected.preparationArtifactId);assert.equal(i.preparation_stored_at,v.expected.preparationStoredAt);assert.equal(i.preparation_intent_sha256,sha(v.expected.preparationIntentJson));assert.equal(i.part_sha256.length,6);
 assert.ok(c.receiptEstimate<=131072);assert.ok(Object.isFrozen(c)&&Object.isFrozen(c.values)&&Object.isFrozen(c.bundle)&&Object.isFrozen(c.expected));assert.match(c.evidenceState,/unexecuted_complete_companion_contract_not_work_or_publication/);
 for(const key of ['capturePreparation','capture','generic','work'])assert.equal(Object.hasOwn(c,key),false);
 assert.deepEqual(read(c.intentJson),{sql:PDF_APPENDED_CAPTURE_READ_SQL,values:[i.capture_id]});
});
test('manual native-shaped full receipt opens only with independent eight-channel expectations and all six exact parts',()=>{
 const r=receipt(),opened=parse(r.raw,r.command.intentJson,r.expected,r.at);assert.deepEqual(opened.bundle,fixture.bundle);assert.deepEqual(opened.expected,fixture.expected);assert.equal(opened.receiptSha256,sha(r.raw));
 assert.equal(opened.capture.sourceReceipts.length,3);assert.ok(Object.isFrozen(opened)&&Object.isFrozen(opened.capture)&&Object.isFrozen(opened.capture.sourceReceipts)&&Object.isFrozen(opened.capture.sourceReceipts[0]));assert.match(opened.evidenceState,/not_authenticated_current_qualification_or_publication/);
 for(const key of Object.keys(r.expected)){const e={...r.expected};delete e[key];refuse(()=>parse(r.raw,r.command.intentJson,e,r.at));}
 for(const[key,value]of[['preparationIntentJson','{}'],['preparationArtifactId','cd000000-0000-4000-8000-000000000999'],['preparationStoredAt',r.at],['observedAt',r.at]])refuse(()=>parse(r.raw,r.command.intentJson,{...r.expected,[key]:value},r.at));
});
test('retained prewrite intent critical UUID and metadata bindings are canonical bounded and cannot be replaced',()=>{
 const r=receipt();for(const raw of['{}',r.command.intentJson+' ',r.command.intentJson.replace('"schema_version":1','"schema_version":1,"schema_version":1'),r.command.intentJson.replace('"schema_version":1','"schema_version":true'),'x'.repeat(4097)])refuse(()=>read(raw));
 for(const key of ['capture_id','run_id','decision_id','issue_id','base_publication_id']){const i=JSON.parse(r.command.intentJson);i[key]='cd000000-0000-1000-8000-000000000999';refuse(()=>read(canonical(i)));}
 for(const[key,value]of[['preparation_intent_sha256','f'.repeat(64)],['preparation_full_receipt_sha256','f'.repeat(64)],['preparation_artifact_id','cd000000-0000-4000-8000-000000000999'],['preparation_stored_at',r.at]]){const i=JSON.parse(r.command.intentJson);i[key]=value;const v=structuredClone(r.value);v.intent_base64=b64(canonical(i));refuse(()=>parseValue(v,r,canonical(i)));}
});
test('each part exact base64 full receipt shape nested key duplicate and lexical spelling remains material',()=>{
 const r=receipt();for(let index=0;index<6;index++){const v=structuredClone(r.value);v.parts_base64[index]=b64('PRIVATE');refuse(()=>parseValue(v,r));}
 for(const change of[v=>v.intent_base64=b64('{}'),v=>v.parts_base64[0]+='\n',v=>v.parts_base64[1]='!!!!',v=>v.extra=true,v=>v.capture.extra=true,v=>v.capture.sourceReceipts[0].extra=true]){const v=structuredClone(r.value);change(v);refuse(()=>parseValue(v,r));}
 for(const change of[s=>s.replace('"schema_version":1','"schema_version":true,"schema_version":1'),s=>s.replace('"schema_version":1','"schema_version":1e0'),s=>s.replace('"capturedAt":','"capturedAt":"PRIVATE","capturedAt":'),s=>s.replace('"kind":','"k\\u0069nd":'),s=>s.replace('"sourceVersionId":','"sourceVersionId":"PRIVATE","sourceVersionId":')]){const before=JSON.stringify(r.value),raw=change(before);assert.notEqual(raw,before);refuse(()=>parse(Buffer.from(raw),r.command.intentJson,r.expected,r.at));}
});
test('known head capture selector hashes source coverage retrieval language and exact microsecond chronology all stay bound',()=>{
 const r=receipt();for(const change of[v=>v.capture_id='cd000000-0000-4000-8000-000000000999',v=>v.capture.runId='cd000000-0000-4000-8000-000000000999',v=>v.capture.basePublicationId=null,v=>v.capture.baseContentSha256='f'.repeat(64),v=>v.capture.baseHeadChangedAt=r.at,v=>v.capture.proposalSha256='f'.repeat(64),v=>v.capture.sourceReceipts.pop(),v=>v.capture.sourceReceipts.push(v.capture.sourceReceipts[0]),v=>v.capture.sourceReceipts.at(-1).contentSha256='f'.repeat(64),v=>v.capture.sourceReceipts.at(-1).languageCode='no',v=>v.capture.sourceReceipts[0].retrievedAt=plus(v.capture.sourceReceipts[0].retrievedAt,1),v=>v.capture.capturedAt=plus(r.expected.observedAt,-1),v=>v.stored_at=plus(v.capture.capturedAt,-1),v=>v.stored_at=plus(r.at,1)]){const v=structuredClone(r.value);change(v);refuse(()=>parseValue(v,r));}
 assert.equal(parse(r.raw,r.command.intentJson,r.expected,r.value.stored_at).storedAt,r.value.stored_at);refuse(()=>parse(r.raw,r.command.intentJson,r.expected,plus(r.value.stored_at,-1)));
 for(const at of['2026-02-30T00:00:00.000000Z','0000-01-01T00:00:00.000000Z',r.at.replace('Z','+00:00'),r.at.slice(0,-2)+'Z',new Date()])refuse(()=>parse(r.raw,r.command.intentJson,r.expected,at));
});
test('all seven BOM carriers byte corruption oversized native wrappers and shadowed intrinsic length are handled without coercion',()=>{
 const r=receipt();for(let index=-1;index<6;index++){const v=structuredClone(r.value),raw=Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(index<0?v.intent_base64:v.parts_base64[index],'base64')]).toString('base64');if(index<0)v.intent_base64=raw;else v.parts_base64[index]=raw;refuse(()=>parseValue(v,r));}
 for(const value of[r.raw.toString(),{},Buffer.alloc(131073),Buffer.from([0xff]),Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),r.raw])])refuse(()=>parse(value,r.command.intentJson,r.expected,r.at));
 let calls=0;const guarded=Buffer.from(r.raw);Object.defineProperty(guarded,'byteLength',{get(){calls++;throw Error('PRIVATE');}});Object.defineProperty(guarded,'length',{get(){calls++;throw Error('PRIVATE');}});assert.equal(parse(guarded,r.command.intentJson,r.expected,r.at).capture.captureId,JSON.parse(r.command.intentJson).capture_id);assert.equal(calls,0);
});
test('closed expected and complete-bundle channels refuse getters symbols hidden prototypes and wrong types without partial commands',()=>{
 const v=sample();let calls=0;const getter={...v.expected};Object.defineProperty(getter,'preparationArtifactId',{enumerable:true,get(){calls++;throw Error('PRIVATE');}});refuse(()=>prepare(v.bundle,getter));
 const r=receipt();refuse(()=>parse(r.raw,r.command.intentJson,getter,r.at));assert.equal(calls,0);
 for(const mutate of[o=>o[Symbol('PRIVATE')]='x',o=>Object.defineProperty(o,'PRIVATE',{value:'x'}),o=>Object.setPrototypeOf(o,{PRIVATE:'x'}),o=>o.extra='x',o=>o.preparationArtifactId=Buffer.from('PRIVATE')]){const e={...v.expected};mutate(e);refuse(()=>prepare(v.bundle,e));}
 for(const value of[null,[],{...v.bundle,extra:true},{...v.bundle,proposalJson:Buffer.from('PRIVATE')},{...v.bundle,proposalJson:'\ud800'}])refuse(()=>prepare(value,v.expected));
 assert.equal(prepare(v.bundle,Object.assign(Object.create(null),v.expected)).intentJson,r.command.intentJson);
});
test('larger valid portable composition is explicitly held by the smaller complete native receipt estimate',()=>{
 // Find a finite independently measured transfer <=126976 but whose parts
 // alone plus the documented native reserve already exceed 131072 bytes.
 let selected;for(let extra=0;extra<=18000;extra+=500){const v=expanded(fixture,extra);if(v.contextBytes>32768)break;if(v.transfer>=123500&&v.transfer<=126976){selected=v;break;}}
 assert.ok(selected,'finite valid-capacity vector exists');const v=selected;assert.notEqual(admit(v.bundle,v.expected),null);
 const minimum=Buffer.byteLength(canonical({parts_base64:fields.map(k=>b64(v.bundle[k]))}))+8192+3*320;assert.ok(minimum>131072);refuse(()=>prepare(v.bundle,v.expected));
});
