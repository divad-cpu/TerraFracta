// Original E reservation and I/A ownership survive a current-target refusal.
// The existing B transaction remains the only writer/current-target authority.
import {randomUUID} from 'node:crypto';
import {createInventedContactFreeSharedWriteTrial} from '../src/invented-contact-free-shared-write-trial.ts';
import {contactFreeCorrectionPolicy as limits} from '../src/contact-free-correction-policy.ts';

export async function proveInventedSharedTargetRefusal(ctx) {
  const {check,call,counts,fixture,clock,current,packet,quote,sql}=ctx;
  const original=packet(),incoming=new Request('https://example.org/INVENTED_ONLY',{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(original)});
  const before=await counts();let reservation,armCalls=0,writeCalls=0,releaseCalls=0,resolveCalls=0;
  const trial=createInventedContactFreeSharedWriteTrial({executionId:fixture.executionId,
    async reserve(input){
      check('targetgap_reserve_before_original_body',incoming.bodyUsed,false);
      reservation=await call('begin_invented',[quote(input.executionId),quote(input.operationId),
        quote(input.currentKey),quote(input.previousKey),input.epoch]);
      check('targetgap_original_operation_issued',reservation.operationId,input.operationId);
      return reservation;
    },
    async arm(input){
      armCalls++;
      check('targetgap_original_body_consumed_before_arm',incoming.bodyUsed,true);
      check('targetgap_original_ticket_and_request',[input.ticket,input.requestId],[reservation.ticket,original.requestId]);
      const armed=await call('arm_invented',[quote(input.executionId),quote(input.ticket),quote(input.requestId),
        quote(JSON.stringify(input.target))+'::jsonb']);
      check('targetgap_actual_SQL_armed',armed.kind,'armed_invented');
      // Change only the new owned fixture target after its actual arm completes.
      // The original packet remains unchanged; no alternate target is substituted.
      await sql('update tf_bound_trial.current_targets set eligible_for_invented_trial=false;');
      check('targetgap_target_retired_after_arm',Number((await sql('select count(*) from tf_bound_trial.current_targets where eligible_for_invented_trial;')).trim()),0);
      return armed;
    },
    async write(input){
      writeCalls++;
      check('targetgap_write_exact_original_packet',input.request,original);
      check('targetgap_write_exact_original_ticket',input.ticket,reservation.ticket);
      const result=await call('write_invented',[quote(input.executionId),quote(input.ticket),quote(JSON.stringify(input.request))+'::jsonb']);
      check('targetgap_B_transaction_known_nonwrite',result.outcome,'known_nonwrite');
      check('targetgap_nonwrite_has_no_body_receipt',result.result,null);
      return result;
    },
    async release(){releaseCalls++;throw Error('Armed original reservation is not a prewrite release');},
    async resolve(input){
      resolveCalls++;
      check('targetgap_resolution_minimal_original_metadata',Object.keys(input).sort(),['executionId','ticket']);
      check('targetgap_resolution_owns_original_ticket',input.ticket,reservation.ticket);
      const result=await call('resolve_invented',[quote(input.executionId),quote(input.ticket)],'tf_shared_recovery');
      check('targetgap_resolution_original_nonwrite',result.outcome,'known_nonwrite');return result;
    },
  },clock.token);
  check('targetgap_owned_coordinator_ready',trial.kind,'ready');
  const submission=trial.begin(incoming,{currentKey:randomUUID(),previousKey:randomUUID(),
    epoch:Math.floor(fixture.receivedAtMs/limits.addressWindowMs)},current);
  check('targetgap_original_submission_owned',submission.kind,'owned_invented_submission');
  check('targetgap_refusal_observation_held',await submission.observation,{kind:'held'});
  check('targetgap_one_arm_and_write_only',[armCalls,writeCalls],[1,1]);
  check('targetgap_no_physical_work_after_reply',[trial.inspection().physicalPorts,trial.inspection().physicalBodies,trial.inspection().physicalWrites],[0,0,0]);
  check('targetgap_actual_owned_body_leases_retired',trial.inspection().ownedBodyLeases,0);
  check('targetgap_actual_prepared_handoffs_claimed',trial.inspection().preparedBodyHandoffs,0);
  check('targetgap_no_automatic_shared_settlement',resolveCalls,0);
  check('targetgap_SQL_nonwrite_debt_retained',(await counts()).unknown,1);
  check('targetgap_no_new_accepted_or_open_effect',[(await counts()).acceptedInHour,(await counts()).openReports],[before.acceptedInHour,before.openReports]);
  check('targetgap_zero_staging_rows',Number((await sql('select (select count(*) from tf_bound_trial.records)+(select count(*) from tf_bound_trial.payloads);')).trim()),0);
  check('targetgap_no_original_private_record',Number((await sql('select count(*) from tf_contact_free_trial.records where request_id='+quote(original.requestId)+';')).trim()),0);
  check('targetgap_immutable_original_nonwrite_fence',Number((await sql('select count(*) from tf_contact_free_write_trial.operations where operation_id='+quote(reservation.operationId)+" and state='nonwrite' and admitted_at_ms="+fixture.receivedAtMs+';')).trim()),1);
  check('targetgap_armed_refusal_cannot_release_prewrite',await trial.retirePrewrite(submission.token),{kind:'held'});
  check('targetgap_no_prewrite_release_port',releaseCalls,0);
  check('targetgap_explicit_resolution_remains_nonacceptance',await trial.resolveUnknown(submission.token),{kind:'held'});
  check('targetgap_one_original_resolution_only',resolveCalls,1);
  check('targetgap_known_resolution_releases_SQL_debt',[(await counts()).reserved,(await counts()).unknown],[0,0]);
  check('targetgap_global_counts_unchanged',[(await counts()).acceptedInHour,(await counts()).openReports],[before.acceptedInHour,before.openReports]);
  check('targetgap_factory_held_after_resolution',trial.inspection().held,true);
  const unread=new Request('https://example.org/INVENTED_ONLY',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(packet())});
  check('targetgap_held_factory_cannot_reopen',trial.begin(unread,{},current),{kind:'held'});
  check('targetgap_held_new_body_unread',unread.bodyUsed,false);
  check('targetgap_no_second_resolution',await trial.resolveUnknown(submission.token),{kind:'held'});
  check('targetgap_original_SQL_ticket_cannot_write_again',await call('write_invented',[quote(fixture.executionId),quote(reservation.ticket),quote(JSON.stringify(original))+'::jsonb']),{kind:'held'});
}
