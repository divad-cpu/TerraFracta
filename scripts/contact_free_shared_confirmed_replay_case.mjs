// A later-day confirmed repeat preserves the original report and expiry.
// Uses only the new fixed invented fixture and the existing SQL functions.
import {randomUUID} from 'node:crypto';
import {createInventedContactFreeSharedWriteTrial} from '../src/invented-contact-free-shared-write-trial.ts';
import {contactFreeCorrectionPolicy as limits} from '../src/contact-free-correction-policy.ts';
export async function proveInventedSharedConfirmedReplay(ctx) {
  const {check,call,counts,fixture,clock,current,packet,quote,sql,originalRequestId,originalReportId}=ctx;
  const at=fixture.receivedAtMs+86400000;
  await sql('begin;update tf_contact_free_trial.clock_state set now_ms='+at+';update tf_bound_trial.clock_state set now_ms='+at+';commit;');
  clock.advanceForTrial({utcAtMs:at});
  const before=await counts();
  check('replay_previous_hour_is_not_current',before.acceptedInHour,0);
  const original={...packet(),requestId:originalRequestId};
  const incoming=new Request('https://example.org/INVENTED_ONLY',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(original)});
  let reservation,armCalls=0,writeCalls=0,releaseCalls=0,resolveCalls=0;
  const trial=createInventedContactFreeSharedWriteTrial({executionId:fixture.executionId,
    async reserve(input){
      check('replay_reserve_before_original_body',incoming.bodyUsed,false);
      reservation=await call('begin_invented',[quote(input.executionId),quote(input.operationId),quote(input.currentKey),quote(input.previousKey),input.epoch]);
      check('replay_new_original_operation',reservation.operationId,input.operationId);
      check('replay_later_original_admission',reservation.admittedAtMs,at);return reservation;
    },
    async arm(input){
      armCalls++;
      check('replay_original_body_consumed_before_arm',incoming.bodyUsed,true);
      check('replay_original_ticket_and_request',[input.ticket,input.requestId],[reservation.ticket,originalRequestId]);
      const result=await call('arm_invented',[quote(input.executionId),quote(input.ticket),quote(input.requestId),quote(JSON.stringify(input.target))+'::jsonb']);
      check('replay_actual_SQL_armed',result.kind,'armed_invented');return result;
    },
    async write(input){
      writeCalls++;
      check('replay_same_original_packet',input.request,original);
      check('replay_same_original_ticket',input.ticket,reservation.ticket);
      const result=await call('write_invented',[quote(input.executionId),quote(input.ticket),quote(JSON.stringify(input.request))+'::jsonb']);
      check('replay_actual_SQL_confirmed',result.outcome,'confirmed');
      check('replay_actual_SQL_replayed',result.result.replayed,true);
      check('replay_same_original_report',result.result.reportId,originalReportId);
      check('replay_original_received_not_renewed',result.result.lifecycle.receivedAtMs,fixture.receivedAtMs);return result;
    },
    async release(){releaseCalls++;throw Error('Replay dispatch is not prewrite release');},
    async resolve(input){
      resolveCalls++;
      check('replay_resolution_minimal',Object.keys(input).sort(),['executionId','ticket']);
      check('replay_resolution_original_ticket',input.ticket,reservation.ticket);
      return call('resolve_invented',[quote(input.executionId),quote(input.ticket)],'tf_shared_recovery');
    },
  },clock.token);
  check('replay_owned_coordinator_ready',trial.kind,'ready');
  const submission=trial.begin(incoming,{currentKey:randomUUID(),previousKey:randomUUID(),epoch:Math.floor(at/limits.addressWindowMs)},current);
  check('replay_owned_original_submission',submission.kind,'owned_invented_submission');
  const result=await submission.observation;
  check('replay_facade_recorded',result.kind,'recorded_invented');
  check('replay_public_receipt_original_identity',[result.receipt.requestId,result.receipt.reportId,result.receipt.replayed],[originalRequestId,originalReportId,true]);
  check('replay_public_receipt_no_body',JSON.stringify(result).includes('CANARY'),false);
  check('replay_one_arm_write_only',[armCalls,writeCalls],[1,1]);
  check('replay_no_automatic_settlement_or_release',[resolveCalls,releaseCalls],[0,0]);
  check('replay_physical_work_retired',[trial.inspection().physicalPorts,trial.inspection().physicalBodies,trial.inspection().physicalWrites],[0,0,0]);
  check('replay_actual_owned_body_leases_retired',trial.inspection().ownedBodyLeases,0);
  check('replay_actual_prepared_handoffs_claimed',trial.inspection().preparedBodyHandoffs,0);
  check('replay_original_debt_retained',[trial.inspection().unknown,(await counts()).unknown],[1,1]);
  check('replay_does_not_increment_hour_or_open',[(await counts()).acceptedInHour,(await counts()).openReports],[before.acceptedInHour,before.openReports]);
  check('replay_one_custody_and_payload',Number((await sql('select (select count(*) from tf_contact_free_trial.records)+(select count(*) from tf_contact_free_trial.payloads);')).trim()),2);
  check('replay_effect_expiry_bound_to_original_report',Number((await sql('select expires_at_ms from tf_contact_free_write_trial.operations where operation_id='+quote(reservation.operationId)+';')).trim()),fixture.receivedAtMs+limits.recordLifetimeMs);
  check('replay_new_admission_not_report_receipt',Number((await sql('select admitted_at_ms from tf_contact_free_write_trial.operations where operation_id='+quote(reservation.operationId)+';')).trim()),at);
  check('replay_original_custody_receipt_unchanged',Number((await sql('select received_at_ms from tf_contact_free_trial.records where report_id='+quote(originalReportId)+';')).trim()),fixture.receivedAtMs);
  check('replay_explicit_resolution_recorded',(await trial.resolveUnknown(submission.token)).kind,'recorded_invented');
  check('replay_one_original_resolution',resolveCalls,1);
  check('replay_resolution_removes_only_own_debt',[(await counts()).reserved,(await counts()).unknown],[0,0]);
  check('replay_resolution_never_counts_new_acceptance',[(await counts()).acceptedInHour,(await counts()).openReports],[before.acceptedInHour,before.openReports]);
  check('replay_factory_stays_held',trial.inspection().held,true);
  check('replay_no_second_resolution',await trial.resolveUnknown(submission.token),{kind:'held'});
  check('replay_original_SQL_ticket_cannot_write_again',await call('write_invented',[quote(fixture.executionId),quote(reservation.ticket),quote(JSON.stringify(original))+'::jsonb']),{kind:'held'});
  check('replay_two_original_effects_one_report',Number((await sql("select count(*) from tf_contact_free_write_trial.operations where state='recorded' and report_id="+quote(originalReportId)+';')).trim()),2);
}
