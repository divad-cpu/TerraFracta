import {htmlInitialFixture,sha} from './html_initial_candidate_fixture.mjs';
export const LOOKUP='2026-10-18T02:00:16.000000Z',CAPTURE='2026-10-18T02:00:17.000000Z';
export function htmlInitialOwnerFixture(){
 const f=htmlInitialFixture(),p=f.report.preparation,m=JSON.parse(f.report.intent_json);
 const scope={preparation_operation_id:p.operation_id,preparation_artifact_id:p.artifact_id,preparation_stored_at:p.stored_at,preparation_intent_sha256:sha(f.expected.preparationIntentJson),payload_sha256:m.payload_sha256,selection_sha256:m.selection_sha256,provenance_sha256:m.provenance_sha256,context_raw_sha256:m.context_raw_sha256};
 const metadata={schema_version:1,kind:'invented_html_initial_candidate_lookup',scope,principal:'postgres',session_principal:'postgres',transaction_isolation:'repeatable read',transaction_read_only:true,preparation_matched:true,observed_at:LOOKUP,matches:[{capture_id:f.value.capture_id,preparation_operation_id:p.operation_id,stored_at:f.value.stored_at,intent_sha256:sha(f.command.intentJson)}]};
 const input={preparationReportJson:f.rawReport,preparationExpected:f.expected,lookupRaw:Buffer.from(JSON.stringify(metadata)),lookupObservedAt:LOOKUP,captureId:f.value.capture_id,captureIntentJson:f.command.intentJson,captureObservedAt:CAPTURE};
 return {...f,scope,metadata,input,refresh(){input.lookupRaw=Buffer.from(JSON.stringify(metadata));}};
}
