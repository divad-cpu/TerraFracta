import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const hash=raw=>createHash('sha256').update(raw).digest('hex');
export function htmlCaptureFixture(){
 const f=JSON.parse(readFileSync(new URL('../../fixtures/fictional-html-appended-capture.json',import.meta.url),'utf8'));
 const raw=Buffer.from(f.rawBase64,'base64'),native=JSON.parse(raw),intent=JSON.parse(f.retainedIntentJson);
 const names=['candidateReportJson','baselineJson','canonicalBaselineJson','contextJson','proposalJson','compositionJson'];
 const bundle=Object.fromEntries(names.map((name,index)=>[name,Buffer.from(native.parts_base64[index],'base64').toString('utf8')]));
 const report=JSON.parse(bundle.candidateReportJson),metadata=JSON.parse(report.intent_json);
 const expected={reportSha256:hash(bundle.candidateReportJson),preparationIntentJson:report.intent_json};
 const lookup={schema_version:1,kind:'invented_html_appended_capture_lookup',scope:{
  preparation_operation_id:report.preparation.operation_id,preparation_artifact_id:report.preparation.artifact_id,
  preparation_stored_at:report.preparation.stored_at,preparation_intent_sha256:hash(report.intent_json),
  payload_sha256:metadata.payload_sha256,selection_sha256:metadata.selection_sha256,provenance_sha256:metadata.provenance_sha256,context_raw_sha256:metadata.context_raw_sha256},
  principal:'postgres',session_principal:'postgres',transaction_isolation:'repeatable read',transaction_read_only:true,
  preparation_matched:true,observed_at:'2026-10-18T02:00:20.000000Z',matches:[{capture_id:native.capture_id,
   preparation_operation_id:native.preparation_operation_id,stored_at:native.stored_at,intent_sha256:hash(f.retainedIntentJson)}]};
 const selection={preparationReportJson:bundle.candidateReportJson,preparationReportSha256:expected.reportSha256,
  preparationIntentJson:report.intent_json,lookupRaw:Buffer.from(JSON.stringify(lookup)),captureId:native.capture_id,
  captureIntentJson:f.retainedIntentJson,observedAt:f.observedAt};
 return {f,raw,native,intent,bundle,report,metadata,expected,lookup,selection};
}
