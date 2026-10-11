-- UNINSTALLED trusted producer command. No writer role, grant or default binding.
-- Stored/replayed is only an immutable private capture receipt, never publication
-- or present comparison eligibility. Readers must still recheck source/base state.
create function terra_private.capture_held_proposal(p_capture uuid,p_run uuid,p_decision uuid,
 p_issue uuid,p_base uuid,p_proposal text)
returns jsonb language plpgsql volatile security invoker set search_path='' as $command$
declare c terra_private.proposal_captures; observed timestamptz:=statement_timestamp(); replayed boolean:=false; value uuid;
begin
 if current_setting('transaction_read_only')='on' then raise exception 'Capture command requires a writer' using errcode='25006';end if;
 foreach value in array array[p_capture,p_run,p_decision,p_issue] loop
  if value is null or value::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   then raise exception 'Capture command identity invalid' using errcode='23514';end if;
 end loop;
 if (p_base is not null and p_base::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
  or p_proposal is null or octet_length(p_proposal) not between 2 and 16384
  or not exists(select 1 from terra_private.machine_candidate_decisions where id=p_decision and run_id=p_run and disposition='held')
  then raise exception 'Capture command scope unavailable' using errcode='23514';end if;
 select * into c from terra_private.proposal_captures where decision_id=p_decision;
 if found then replayed:=true;
 else
  insert into terra_private.proposal_captures(id,decision_id,issue_id,base_publication_id,proposal_json,proposal_sha256,source_receipts,captured_at)
   values(p_capture,p_decision,p_issue,p_base,p_proposal,repeat('0',64),'[]'::jsonb,observed)
   on conflict(decision_id) do nothing returning * into c;
  if not found then
   select * into c from terra_private.proposal_captures where decision_id=p_decision;
   if not found then raise exception 'Capture command requires retry' using errcode='40001';end if;
   replayed:=true;
  end if;
 end if;
 -- The immutable decision uniqueness prevents a second spelling or association.
 if c.id is distinct from p_capture or c.issue_id is distinct from p_issue
  or c.base_publication_id is distinct from p_base or c.proposal_json is distinct from p_proposal
  or c.proposal_sha256 is distinct from encode(sha256(convert_to(p_proposal,'UTF8')),'hex')
  then raise exception 'Capture command conflicts with stored capture' using errcode='23505';end if;
 -- A statement may start earlier but wait while another caller stores. Observe
 -- after lookup/locks; keep the original capture time on an idempotent replay.
 observed:=clock_timestamp();
 if not isfinite(c.captured_at) or c.captured_at>observed then
  raise exception 'Capture command observation requires retry' using errcode='40001';end if;
 return jsonb_build_object('schemaVersion',1,'status',case when replayed then 'replayed' else 'stored' end,
  'captureId',c.id,'runId',p_run,'decisionId',c.decision_id,'issueId',c.issue_id,'basePublicationId',c.base_publication_id,
  'proposalSha256',c.proposal_sha256,'capturedAt',to_char(c.captured_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'observedAt',to_char(observed at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
end;
$command$;
revoke all on function terra_private.capture_held_proposal(uuid,uuid,uuid,uuid,uuid,text)
 from public,anon,authenticated,service_role,terra_collector,terra_operator,terra_issue_reader,terra_reviewer;
