import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {prepareHtmlInitialCandidateCaptureForWork as prepare} from '../../src/server/html-initial-candidate-capture.ts';
export const sha=raw=>createHash('sha256').update(raw).digest('hex');
export const b64=raw=>Buffer.from(raw,'utf8').toString('base64');
export const CAPTURED='2026-10-18T02:00:14.000000Z',STORED='2026-10-18T02:00:15.000000Z',OBSERVED='2026-10-18T02:00:16.000000Z';
export function htmlInitialFixture(){
 const fixture=JSON.parse(readFileSync(new URL('../../fixtures/fictional-html-initial-candidate.json',import.meta.url),'utf8'));
 const rawReport=fixture.reportJson,expected=fixture.expected,report=JSON.parse(rawReport),selection=JSON.parse(report.selection_json);
 const work={runId:selection.runId,requestFingerprint:'a'.repeat(64),workClaimId:'90000000-0000-4000-8000-000000000998'};
 const command=prepare(work,rawReport,expected),intent=JSON.parse(command.intentJson),source=report.extraction.inspection.current;
 const value={schema_version:1,kind:'invented_html_initial_candidate_capture_stored',capture_id:intent.capture_id,preparation_operation_id:intent.preparation_operation_id,stored_at:STORED,intent_base64:b64(command.intentJson),report_base64:b64(rawReport),
  capture:{captureId:intent.capture_id,runId:intent.run_id,decisionId:intent.decision_id,issueId:intent.issue_id,basePublicationId:null,baseHeadChangedAt:null,baseContentSha256:null,proposalSha256:JSON.parse(report.intent_json).payload_sha256,capturedAt:CAPTURED,
   sourceReceipts:[{sourceVersionId:source.source_version_id,contentSha256:source.content_sha256,retrievedAt:source.retrieved_at,languageCode:source.language_code}]}};
 return {fixture,rawReport,report,expected,selection,work,command,intent,value,raw:Buffer.from(JSON.stringify(value))};
}
