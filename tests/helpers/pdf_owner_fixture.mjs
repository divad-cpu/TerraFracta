import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
// Actual retained invented native receipt. No PDF process or database is run.
export const hash=raw=>createHash('sha256').update(raw).digest('hex');
export function pdfOwnerFixture(){
 const f=JSON.parse(readFileSync(new URL('../../fixtures/fictional-pdf-appended-capture.json',import.meta.url),'utf8'));
 const raw=Buffer.from(f.receiptBase64,'base64'),native=JSON.parse(raw),intent=JSON.parse(f.intentJson);
 const names=['candidateReportJson','baselineJson','canonicalBaselineJson','contextJson','proposalJson','compositionJson'];
 const bundle=Object.fromEntries(names.map((name,index)=>[name,Buffer.from(native.parts_base64[index],'base64').toString('utf8')]));
 const work={runId:intent.run_id,requestFingerprint:'d'.repeat(64),workClaimId:'00000000-0000-4000-8000-000000000997'};
 return {f,raw,native,intent,bundle,expected:f.expected,work,scope:{retainedIntentJson:f.intentJson,expected:f.expected,observedAt:f.observedAt}};
}

export function pdfLookupFixture(){
 const f=pdfOwnerFixture(),report=JSON.parse(f.bundle.candidateReportJson),p=report.preparation;
 const reportExpected={reportSha256:f.expected.candidateReportSha256,preparationIntentJson:f.expected.preparationIntentJson,preparationArtifactId:f.expected.preparationArtifactId,preparationStoredAt:f.expected.preparationStoredAt,observedAt:report.observed_at};
 const lookup={schema_version:1,kind:'invented_pdf_appended_capture_lookup',scope:{preparation_operation_id:p.operation_id,preparation_artifact_id:p.artifact_id,preparation_stored_at:p.stored_at,preparation_intent_sha256:p.intent_sha256,preparation_packet_sha256:p.packet_sha256,preparation_receipt_sha256:p.receipt_sha256},principal:'postgres',session_principal:'postgres',transaction_isolation:'repeatable read',transaction_read_only:true,preparation_matched:true,observed_at:f.f.observedAt,matches:[{capture_id:f.intent.capture_id,preparation_operation_id:p.operation_id,stored_at:f.native.stored_at,intent_sha256:hash(f.f.intentJson)}]};
 const selection={preparationReportJson:f.bundle.candidateReportJson,preparationExpected:reportExpected,lookupRaw:Buffer.from(JSON.stringify(lookup)),captureId:f.intent.capture_id,captureIntentJson:f.f.intentJson,captureExpected:f.expected,observedAt:f.f.observedAt};
 return {...f,report,reportExpected,lookup,selection};
}
