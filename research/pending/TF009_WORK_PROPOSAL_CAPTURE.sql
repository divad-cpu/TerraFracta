-- Uninstalled draft. A future worker requires its current work fence both
-- before and after capture can wait on another transaction. Historical manual
-- backfill keeps the separate existing generic command. No writer is granted.
begin;
create function terra_private.capture_held_proposal_for_work(
 p_run uuid,p_fingerprint text,p_work uuid,p_capture uuid,p_decision uuid,
 p_issue uuid,p_base uuid,p_proposal text)
returns jsonb language plpgsql volatile security invoker set search_path='' as $work$
declare result jsonb;
begin
 if current_setting('transaction_read_only')='on' then
  raise exception 'Work capture requires a write transaction' using errcode='25006';
 end if;
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception 'Work capture requires read committed isolation' using errcode='25001';
 end if;
 perform terra_private.assert_update_run_work(p_run,p_fingerprint,p_work);
 result:=terra_private.capture_held_proposal(p_capture,p_run,p_decision,p_issue,p_base,p_proposal);
 -- clock_timestamp inside the existing assertion is evaluated after any
 -- capture lock wait. Refusal rolls the entire statement back atomically.
 perform terra_private.assert_update_run_work(p_run,p_fingerprint,p_work);
 return result;
end;
$work$;
revoke all on function terra_private.capture_held_proposal_for_work(uuid,text,uuid,uuid,uuid,uuid,uuid,text)
 from public,anon,authenticated,service_role,terra_collector,terra_operator,terra_issue_reader,terra_reviewer;
commit;
