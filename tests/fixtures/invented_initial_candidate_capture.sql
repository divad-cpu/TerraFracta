-- UNINSTALLED invented owner-only initial SINGLE candidate custody.
-- Reuses immutable preparation and generic capture; no publication or grant.
create schema tf_initial_candidate authorization postgres;
revoke all on schema tf_initial_candidate from public;
create table tf_initial_candidate.captures (
 capture_id uuid primary key references terra_private.proposal_captures(id),
 preparation_operation_id uuid not null unique references tf_detached_proposal.preparations(operation_id),
 intent_raw bytea not null check(octet_length(intent_raw) between 1 and 4096),
 report_raw bytea not null check(octet_length(report_raw) between 2 and 65536),
 stored_at timestamptz not null default clock_timestamp() check(isfinite(stored_at)),
 check(encode(sha256(report_raw),'hex')=convert_from(intent_raw,'UTF8')::jsonb->>'report_sha256')
);
alter table tf_initial_candidate.captures enable row level security;
revoke all on tf_initial_candidate.captures from public;
create function tf_initial_candidate.refuse_mutation()returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin raise exception using errcode='55000',message='invented_initial_candidate_append_only';end
$$;
revoke all on function tf_initial_candidate.refuse_mutation()from public;
create trigger initial_candidate_append_only before update or delete on tf_initial_candidate.captures for each row execute function tf_initial_candidate.refuse_mutation();

create function tf_initial_candidate.capture_receipt(p_capture uuid)returns jsonb language plpgsql stable security invoker set search_path=pg_catalog as $$
declare r tf_initial_candidate.captures%rowtype;c terra_private.proposal_captures%rowtype;i jsonb;v jsonb;
begin
 if current_user<>session_user or session_user<>'postgres' then raise exception using errcode='42501',message='invented_initial_candidate_owner_required';end if;
 select * into r from tf_initial_candidate.captures where capture_id=p_capture;
 if not found then raise exception using errcode='22023',message='invented_initial_candidate_unavailable';end if;
 select * into c from terra_private.proposal_captures where id=r.capture_id;
 i:=convert_from(r.intent_raw,'UTF8')::jsonb;
 if not found or c.base_publication_id is not null or c.base_head_changed_at is not null or c.base_content_sha256 is not null
  or c.id::text is distinct from i->>'capture_id' or c.decision_id::text is distinct from i->>'decision_id' or c.issue_id::text is distinct from i->>'issue_id'
  or c.captured_at>r.stored_at or r.stored_at>clock_timestamp() or r.stored_at>='10000-01-01Z'::timestamptz then
  raise exception using errcode='23514',message='invented_initial_candidate_dependency_invalid';end if;
 v:=jsonb_build_object('schema_version',1,'kind','invented_initial_candidate_capture_stored','capture_id',r.capture_id,'preparation_operation_id',r.preparation_operation_id,
  'stored_at',to_char(r.stored_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'intent_base64',replace(encode(r.intent_raw,'base64'),E'\n',''),'report_base64',replace(encode(r.report_raw,'base64'),E'\n',''),
  'capture',jsonb_build_object('captureId',c.id,'runId',i->>'run_id','decisionId',c.decision_id,'issueId',c.issue_id,'basePublicationId',null,'baseHeadChangedAt',null,'baseContentSha256',null,'proposalSha256',c.proposal_sha256,
  'capturedAt',to_char(c.captured_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'sourceReceipts',c.source_receipts));
 if octet_length(v::text)+29>131072 then raise exception using errcode='22023',message='invented_initial_candidate_readback_limit';end if;
 return v;
end
$$;
revoke all on function tf_initial_candidate.capture_receipt(uuid)from public;

create function tf_initial_candidate.capture_for_work(p_run uuid,p_fingerprint text,p_claim uuid,p_intent bytea,p_report bytea)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare i jsonb;r jsonb;s jsonb;context jsonb;payload jsonb;native_prep jsonb;receipt jsonb;generic jsonb;keys text[];key text;index integer;part bytea;
 prep tf_detached_proposal.preparations%rowtype;old tf_initial_candidate.captures%rowtype;decision record;target record;head terra_private.issue_heads%rowtype;
begin
 if current_user<>session_user or session_user<>'postgres' then raise exception using errcode='42501',message='invented_initial_candidate_owner_required';end if;
 if current_setting('transaction_read_only')='on' then raise exception using errcode='25006',message='invented_initial_candidate_writer_required';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception using errcode='25001',message='invented_initial_candidate_isolation_required';end if;
 if p_intent is null or octet_length(p_intent)not between 1 and 4096 or p_report is null or octet_length(p_report)not between 2 and 65536 then
  raise exception using errcode='22023',message='invented_initial_candidate_parts_invalid';end if;
 i:=convert_from(p_intent,'UTF8')::jsonb;r:=convert_from(p_report,'UTF8')::jsonb;
 if jsonb_typeof(i)is distinct from 'object' or jsonb_typeof(r)is distinct from 'object' then raise exception using errcode='22023',message='invented_initial_candidate_shape_invalid';end if;
 select array_agg(k order by k)into keys from jsonb_object_keys(i)k;
 if keys is distinct from array['base_publication_id','capture_id','decision_id','issue_id','kind','part_sha256','preparation_artifact_id','preparation_full_receipt_sha256','preparation_intent_sha256','preparation_observed_at','preparation_operation_id','report_sha256','run_id','schema_version','snapshot_intent']
  or i->'schema_version'is distinct from '1'::jsonb or i->>'schema_version'is distinct from '1' or i->>'kind'is distinct from 'invented_initial_candidate_capture'
  or i->>'snapshot_intent'is distinct from 'single_claim_technical_review_not_issue_replacement' or i->'base_publication_id'is distinct from 'null'::jsonb
  or i->>'run_id'is distinct from p_run::text then raise exception using errcode='22023',message='invented_initial_candidate_intent_invalid';end if;
 foreach key in array array['capture_id','run_id','decision_id','issue_id','preparation_operation_id','preparation_artifact_id']loop
  if jsonb_typeof(i->key)is distinct from 'string' or (i->>key~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')is distinct from true then raise exception using errcode='22023',message='invented_initial_candidate_identity_invalid';end if;
 end loop;
 foreach key in array array['capture_id','run_id','decision_id','issue_id']loop
  if (i->>key~'^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')is distinct from true then raise exception using errcode='22023',message='invented_initial_candidate_capture_identity_invalid';end if;
 end loop;
 foreach key in array array['report_sha256','preparation_intent_sha256','preparation_full_receipt_sha256']loop
  if jsonb_typeof(i->key)is distinct from 'string' or (i->>key~'^[0-9a-f]{64}$')is distinct from true then raise exception using errcode='22023',message='invented_initial_candidate_digest_invalid';end if;
 end loop;
 if i->>'report_sha256'is distinct from encode(sha256(p_report),'hex')or jsonb_typeof(i->'part_sha256')is distinct from 'array' or jsonb_array_length(i->'part_sha256')<>4
  or jsonb_typeof(i->'preparation_observed_at')is distinct from 'string' or (i->>'preparation_observed_at'~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{6}Z$')is distinct from true
  or not isfinite((i->>'preparation_observed_at')::timestamptz)or (i->>'preparation_observed_at')::timestamptz>statement_timestamp()then raise exception using errcode='22023',message='invented_initial_candidate_observation_invalid';end if;
 perform terra_private.assert_update_run_work(p_run,p_fingerprint,p_claim);
 lock table tf_initial_candidate.captures in share row exclusive mode;
 select * into old from tf_initial_candidate.captures where capture_id=(i->>'capture_id')::uuid;
 if found then
  if old.intent_raw is distinct from p_intent or old.report_raw is distinct from p_report then raise exception using errcode='23505',message='invented_initial_candidate_replay_conflict';end if;
  receipt:=tf_initial_candidate.capture_receipt(old.capture_id);perform terra_private.assert_update_run_work(p_run,p_fingerprint,p_claim);return receipt;
 end if;
 if(select count(*)from tf_initial_candidate.captures)>=50 then raise exception using errcode='22023',message='invented_initial_candidate_lab_quota';end if;
 if exists(select 1 from terra_private.proposal_captures where id=(i->>'capture_id')::uuid or decision_id=(i->>'decision_id')::uuid)
  or exists(select 1 from tf_initial_candidate.captures where preparation_operation_id=(i->>'preparation_operation_id')::uuid)then raise exception using errcode='23505',message='invented_initial_candidate_standalone_or_preparation_conflict';end if;
 select * into prep from tf_detached_proposal.preparations where operation_id=(i->>'preparation_operation_id')::uuid;
 if not found or prep.artifact_id::text is distinct from i->>'preparation_artifact_id'
  or r->>'schema_version'is distinct from '1' or r->'schema_version'is distinct from '1'::jsonb or r->>'kind'is distinct from 'invented_detached_preparation_review'
  or r->>'scope'is distinct from 'invented_offline_rehearsal_only' or r->>'review_state'is distinct from 'unverified' or r->>'evidence_state'is distinct from 'historical_preparation_not_current_qualification_or_held_capture'
  or r#>>'{preparation,operation_id}'is distinct from prep.operation_id::text or r#>>'{preparation,artifact_id}'is distinct from prep.artifact_id::text
  or r#>>'{preparation,stored_at}'is distinct from to_char(prep.stored_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  or prep.stored_at>(i->>'preparation_observed_at')::timestamptz or r->>'observed_at'is distinct from i->>'preparation_observed_at' or r->>'intent_json'is null or (r->>'intent_json')::jsonb is distinct from prep.input
  or encode(sha256(convert_to(r->>'intent_json','UTF8')),'hex')is distinct from i->>'preparation_intent_sha256'
  or r#>>'{parts,payload_json}'is distinct from convert_from(prep.payload_raw,'UTF8')or r#>>'{parts,selection_json}'is distinct from convert_from(prep.selection_raw,'UTF8')
  or r#>>'{parts,provenance_json}'is distinct from convert_from(prep.provenance_raw,'UTF8')or r#>>'{parts,context_json}'is distinct from convert_from(prep.context_raw,'UTF8')then raise exception using errcode='22023',message='invented_initial_candidate_preparation_invalid';end if;
 for index in 0..3 loop
  part:=case index when 0 then prep.payload_raw when 1 then prep.selection_raw when 2 then prep.provenance_raw else prep.context_raw end;
  if jsonb_typeof(i->'part_sha256'->index)is distinct from 'string' or i->'part_sha256'->>index is distinct from encode(sha256(part),'hex')then raise exception using errcode='22023',message='invented_initial_candidate_part_invalid';end if;
 end loop;
 -- Same native receipt representation as the existing private owner getter;
 -- postgres must not bypass its explicit tf_feed_lab_owner identity guard.
 native_prep:=jsonb_build_object('schema_version',1,'kind','invented_detached_preparation_stored','operation_id',prep.operation_id,'artifact_id',prep.artifact_id,
  'stored_at',to_char(prep.stored_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'input',prep.input,
  'payload_base64',replace(encode(prep.payload_raw,'base64'),E'\n',''),'selection_base64',replace(encode(prep.selection_raw,'base64'),E'\n',''),
  'provenance_base64',replace(encode(prep.provenance_raw,'base64'),E'\n',''),'context_base64',replace(encode(prep.context_raw,'base64'),E'\n',''));
 if encode(sha256(convert_to(native_prep::text,'UTF8')),'hex')is distinct from i->>'preparation_full_receipt_sha256'
  or r#>>'{preparation,full_receipt_sha256}'is distinct from i->>'preparation_full_receipt_sha256'then raise exception using errcode='22023',message='invented_initial_candidate_receipt_invalid';end if;
 s:=convert_from(prep.selection_raw,'UTF8')::jsonb;payload:=convert_from(prep.payload_raw,'UTF8')::jsonb;context:=convert_from(prep.context_raw,'UTF8')::jsonb;
 if s is distinct from jsonb_build_object('captureId',i->>'capture_id','runId',i->>'run_id','decisionId',i->>'decision_id','issueId',i->>'issue_id','basePublicationId',null)
  or context#>'{issue,head}'is distinct from jsonb_build_object('publication_id',null,'content_sha256',null,'changed_at',null)
  or context->>'snapshot_intent'is distinct from 'single_claim_technical_review_not_issue_replacement'
  or payload->>'kind'is distinct from 'review_only' or payload->>'conflictCoverage'is distinct from 'not_recorded'
  or (payload#>>'{translation,status}'in('unreviewed','not_recorded'))is distinct from true
  or jsonb_array_length(payload#>'{snapshot,claims}')<>1 or jsonb_array_length(payload#>'{snapshot,claims,0,evidence}')<>1 or jsonb_array_length(payload#>'{dependencyManifest,sourceVersionIds}')<>1 then raise exception using errcode='23514',message='invented_initial_candidate_initial_intent_invalid';end if;
 select d.*,r.jurisdiction_id,sv.source_url into decision from terra_private.machine_candidate_decisions d join terra_private.update_runs r on r.id=d.run_id join terra_private.source_versions sv on sv.id=d.source_version_id where d.id=(i->>'decision_id')::uuid and r.id=p_run;
 if not found or decision.disposition<>'held' or context#>>'{held,disposition}'is distinct from decision.disposition or context#>>'{held,run_id}'is distinct from decision.run_id::text
  or context#>>'{held,decision_id}'is distinct from decision.id::text or context#>>'{held,source_version_id}'is distinct from decision.source_version_id::text
  or context#>>'{held,content_sha256}'is distinct from decision.content_sha256 or context#>>'{held,locator}'is distinct from decision.evidence_locator
  or context#>>'{held,item_key}'is distinct from decision.candidate_key or context#>>'{held,jurisdiction_id}'is distinct from decision.jurisdiction_id
  or context#>>'{held,decided_at}'is distinct from to_char(decision.decided_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  or payload#>>'{snapshot,claims,0,evidence,0,sourceVersionId}'is distinct from decision.source_version_id::text or payload#>>'{snapshot,claims,0,evidence,0,locator}'is distinct from decision.evidence_locator
  or payload#>>'{snapshot,claims,0,evidence,0,url}'is distinct from decision.source_url then raise exception using errcode='23514',message='invented_initial_candidate_held_binding_invalid';end if;
 select d.*,j.public_slug as jurisdiction_slug into target from terra_private.issue_dossiers d join terra_private.jurisdictions j on j.id=d.jurisdiction_id where d.id=(i->>'issue_id')::uuid;
 if not found or target.jurisdiction_id is distinct from decision.jurisdiction_id or context#>>'{issue,issue_id}'is distinct from target.id::text
  or context#>>'{issue,jurisdiction_id}'is distinct from target.jurisdiction_id or context#>>'{issue,jurisdiction_slug}'is distinct from target.jurisdiction_slug
  or context#>>'{issue,issue_slug}'is distinct from target.public_slug or context#>>'{issue,created_at}'is distinct from to_char(target.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')then raise exception using errcode='23514',message='invented_initial_candidate_issue_binding_invalid';end if;
 select * into head from terra_private.issue_heads where issue_id=target.id for update;
 if not found or head.current_publication_id is not null or head.changed_at is not null then raise exception using errcode='23514',message='invented_initial_candidate_head_changed';end if;
 generic:=terra_private.capture_held_proposal((i->>'capture_id')::uuid,p_run,(i->>'decision_id')::uuid,target.id,null,convert_from(prep.payload_raw,'UTF8'));
 -- A concurrent standalone exact capture is still not adoptable provenance.
 if generic->>'status'is distinct from 'stored'then raise exception using errcode='23505',message='invented_initial_candidate_concurrent_standalone';end if;
 insert into tf_initial_candidate.captures(capture_id,preparation_operation_id,intent_raw,report_raw)values((i->>'capture_id')::uuid,prep.operation_id,p_intent,p_report);
 receipt:=tf_initial_candidate.capture_receipt((i->>'capture_id')::uuid);
 perform terra_private.assert_update_run_work(p_run,p_fingerprint,p_claim);
 return receipt;
end
$$;
revoke all on function tf_initial_candidate.capture_for_work(uuid,text,uuid,bytea,bytea)from public;
