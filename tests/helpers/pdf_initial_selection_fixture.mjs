import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const hash=raw=>createHash('sha256').update(raw).digest('hex');
export function initialPdfLookupFixture(){
 const f=JSON.parse(readFileSync(new URL('../../fixtures/fictional-pdf-initial-candidate-capture.json',import.meta.url),'utf8'));
 const raw=Buffer.from(f.receiptBase64,'base64'),native=JSON.parse(raw),intent=JSON.parse(f.intentJson);
 const reportJson=Buffer.from(native.report_base64,'base64').toString('utf8'),report=JSON.parse(reportJson),p=report.preparation;
 const expected={...f.expected};
 const lookup={schema_version:1,kind:'invented_pdf_initial_candidate_capture_lookup',scope:{preparation_operation_id:p.operation_id,preparation_artifact_id:p.artifact_id,preparation_stored_at:p.stored_at,preparation_intent_sha256:hash(report.intent_json),preparation_packet_sha256:p.packet_sha256,preparation_receipt_sha256:p.receipt_sha256},principal:'postgres',session_principal:'postgres',transaction_isolation:'repeatable read',transaction_read_only:true,preparation_matched:true,observed_at:f.observedAt,matches:[{capture_id:native.capture_id,preparation_operation_id:p.operation_id,stored_at:native.stored_at,intent_sha256:hash(f.intentJson)}]};
 const selection={preparationReportJson:reportJson,preparationExpected:{...expected},lookupRaw:Buffer.from(JSON.stringify(lookup)),captureId:native.capture_id,captureIntentJson:f.intentJson,captureExpected:{...expected},observedAt:f.observedAt};
 return {f,raw,native,intent,reportJson,report,expected,reportExpected:{...expected},lookup,selection};
}
