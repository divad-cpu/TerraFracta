import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadTsx} from './helpers/tsx_loader.mjs';
import {preparePdfAppendedIssueCapture} from '../src/server/pdf-appended-issue-capture.ts';
const{PdfAppendedCaptureReviewView:View}=loadTsx(new URL('../src/pdf-appended-capture-review-view.tsx',import.meta.url));
// Manually framed receipt over an already retained actual Python composition.
// This is a reader correspondence vector, not a native storage/source proof.
function supplied(){
 const f=JSON.parse(readFileSync(new URL('../fixtures/fictional-pdf-appended-issue-review.json',import.meta.url),'utf8')),p=preparePdfAppendedIssueCapture(f.bundle,f.expected),i=JSON.parse(p.intentJson),proposal=JSON.parse(f.bundle.proposalJson),report=JSON.parse(f.bundle.candidateReportJson),current=JSON.parse(report.parts.provenance_json).current,context=JSON.parse(f.bundle.contextJson);
 const plus=n=>new Date(Date.parse(f.expected.observedAt)+n*1000).toISOString().replace('.000Z','.000000Z');
 const raw=Buffer.from(JSON.stringify({schema_version:1,kind:'invented_pdf_appended_issue_capture_stored',capture_id:i.capture_id,preparation_operation_id:i.preparation_operation_id,stored_at:plus(2),intent_base64:p.values[0],parts_base64:p.values.slice(1),capture:{captureId:i.capture_id,runId:i.run_id,decisionId:i.decision_id,issueId:i.issue_id,basePublicationId:i.base_publication_id,baseHeadChangedAt:context.baseline.head_changed_at,baseContentSha256:i.part_sha256[1],proposalSha256:createHash('sha256').update(f.bundle.proposalJson).digest('hex'),capturedAt:plus(1),sourceReceipts:proposal.dependencyManifest.sourceVersionIds.map(id=>({sourceVersionId:id,contentSha256:id===current.source_version_id?current.content_sha256:'f'.repeat(64),retrievedAt:proposal.snapshot.claims.flatMap(c=>c.evidence).find(e=>e.sourceVersionId===id).retrievedAt,languageCode:'en'}))}}));
 return{receipt:raw,intentJson:p.intentJson,expected:f.expected,observedAt:plus(3)};
}
test('captured whole PDF issue separates later association from unchanged older composition and original preparation',t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('No network or database'));
 const v=supplied(),h=renderToStaticMarkup(View(v));for(const s of['Captured PDF whole-issue proposal','Historical publication basis','Whole proposal captured','Complete composition companion stored','Later receipt observation','earlier composition below keeps its original uncaptured wording','PDF whole-issue preparation for review','2 preserved statements','1 proposed new statement','Saved PDF preparation','Detached PDF candidate','No editorial action is available'])assert.ok(h.includes(s),s);
 assert.doesNotMatch(h,/<form|<input|<button|<script|<iframe|href="https?:|base64|%PDF-/);
 const ids=[...h.matchAll(/\bid="([^"]+)"/g)].map(v=>v[1]);assert.equal(new Set(ids).size,ids.length);for(const m of h.matchAll(/href="#([^"]+)"/g))assert.ok(ids.includes(m[1]),m[1]);
});
test('corrupted full receipt or any external selector withholds complete and detached contents together',()=>{
 const original=supplied();for(const v of[{...original,receipt:Buffer.from('PRIVATE_CANARY')},{...original,intentJson:'PRIVATE_CANARY'},{...original,observedAt:'PRIVATE_CANARY'},...Object.keys(original.expected).map(key=>({...original,expected:{...original.expected,[key]:'PRIVATE_CANARY'}}))]){
  const h=renderToStaticMarkup(View(v));assert.match(h,/Captured PDF whole-issue review unavailable/);assert.doesNotMatch(h,/PRIVATE_CANARY|Historical statement|Saved PDF|Detached PDF|Historical publication|source version/);
 }
});
test('native-looking unknown fields cannot become active markup or partial stored identities',()=>{
 const v=supplied(),raw=JSON.parse(v.receipt.toString());raw.capture.captureId='<img src=x onerror=PRIVATE>';const h=renderToStaticMarkup(View({...v,receipt:Buffer.from(JSON.stringify(raw))}));assert.match(h,/Captured PDF whole-issue review unavailable/);assert.doesNotMatch(h,/<img|PRIVATE|Historical statement|Supplied whole/);
});
