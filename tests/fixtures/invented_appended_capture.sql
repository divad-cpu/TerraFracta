-- UNINSTALLED fresh-owned invented laboratory only. No runtime writer or grant.
-- Complete duplicate-free syntax is admitted by the Python/TypeScript producer.
-- This SQL binds the consumed identities, exact parts, actual historical base
-- and unchanged generic-six capture in one statement. It is not work-eight,
-- publication qualification or containment of an arbitrary database owner.
create schema tf_appended_review authorization postgres;
revoke all on schema tf_appended_review from public;
create table tf_appended_review.captures (
 capture_id uuid primary key references terra_private.proposal_captures(id),
 preparation_operation_id uuid not null unique references tf_detached_proposal.preparations(operation_id),
 intent_raw bytea not null check(octet_length(intent_raw) between 1 and 4096),
 candidate_report_raw bytea not null check(octet_length(candidate_report_raw) between 1 and 262144),
 baseline_raw bytea not null check(octet_length(baseline_raw) between 1 and 24576),
 canonical_baseline_raw bytea not null check(octet_length(canonical_baseline_raw) between 1 and 24576),
 context_raw bytea not null check(octet_length(context_raw) between 1 and 32768),
 proposal_raw bytea not null check(octet_length(proposal_raw) between 1 and 16384),
 composition_raw bytea not null check(octet_length(composition_raw) between 1 and 65536),
 stored_at timestamptz not null default clock_timestamp() check(isfinite(stored_at)),
 constraint appended_capture_storage_chronology check(stored_at>=(convert_from(intent_raw,'UTF8')::jsonb->>'composition_observed_at')::timestamptz)
);
alter table tf_appended_review.captures enable row level security;
revoke all on tf_appended_review.captures from public;
create function tf_appended_review.refuse_mutation() returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin raise exception using errcode='55000',message='invented_appended_capture_append_only';end
$$;
revoke all on function tf_appended_review.refuse_mutation() from public;
create trigger appended_capture_append_only before update or delete on tf_appended_review.captures for each row execute function tf_appended_review.refuse_mutation();

create function tf_appended_review.capture_receipt(p_capture uuid) returns jsonb language plpgsql stable security invoker set search_path=pg_catalog as $$
declare r tf_appended_review.captures%rowtype;c terra_private.proposal_captures%rowtype;v jsonb;intent jsonb;
begin
 if current_user<>'postgres' then raise exception using errcode='42501',message='invented_appended_capture_owner_required';end if;
 select * into r from tf_appended_review.captures where capture_id=p_capture;
 if not found then raise exception using errcode='22023',message='invented_appended_capture_unavailable';end if;
 select * into c from terra_private.proposal_captures where id=r.capture_id;
 if not found then raise exception using errcode='22023',message='invented_appended_capture_dependency_unavailable';end if;
 intent:=convert_from(r.intent_raw,'UTF8')::jsonb;
 if not isfinite(c.captured_at) or r.stored_at>clock_timestamp() or r.stored_at>='10000-01-01Z'::timestamptz
  or c.captured_at>r.stored_at or c.captured_at<(intent->>'composition_observed_at')::timestamptz then
  raise exception using errcode='23514',message='invented_appended_capture_storage_chronology';end if;
 v:=jsonb_build_object('schema_version',1,'kind','invented_appended_issue_capture_stored','capture_id',r.capture_id,
  'preparation_operation_id',r.preparation_operation_id,'stored_at',to_char(r.stored_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'intent_base64',replace(encode(r.intent_raw,'base64'),E'\n',''),
  'parts_base64',jsonb_build_array(replace(encode(r.candidate_report_raw,'base64'),E'\n',''),replace(encode(r.baseline_raw,'base64'),E'\n',''),
   replace(encode(r.canonical_baseline_raw,'base64'),E'\n',''),replace(encode(r.context_raw,'base64'),E'\n',''),replace(encode(r.proposal_raw,'base64'),E'\n',''),replace(encode(r.composition_raw,'base64'),E'\n','')),
  'capture',jsonb_build_object('captureId',c.id,'runId',intent->>'run_id','decisionId',c.decision_id,'issueId',c.issue_id,'basePublicationId',c.base_publication_id,
   'baseHeadChangedAt',to_char(c.base_head_changed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'baseContentSha256',c.base_content_sha256,
   'proposalSha256',c.proposal_sha256,'capturedAt',to_char(c.captured_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'sourceReceipts',c.source_receipts));
 if octet_length(v::text)+29>131072 then raise exception using errcode='22023',message='invented_appended_capture_readback_limit';end if;
 return v;
end
$$;
revoke all on function tf_appended_review.capture_receipt(uuid) from public;

create function tf_appended_review.capture_issue(p_intent bytea,p_report bytea,p_base bytea,p_canonical bytea,p_context bytea,p_proposal bytea,p_composition bytea)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare intent jsonb;report jsonb;base jsonb;context jsonb;proposed jsonb;proof jsonb;selection jsonb;old_payload jsonb;old_context jsonb;
 keys text[];key text;parts bytea[]:=array[p_report,p_base,p_canonical,p_context,p_proposal,p_composition];limits integer[]:=array[262144,24576,24576,32768,16384,65536];i integer;
 prep tf_detached_proposal.preparations%rowtype;old tf_appended_review.captures%rowtype;head terra_private.issue_heads%rowtype;
 publication terra_private.issue_publications%rowtype;decision record;target record;receipt jsonb;native_prep jsonb;source_id text;observed timestamptz;ignored jsonb;
begin
 if current_user<>'postgres' then raise exception using errcode='42501',message='invented_appended_capture_owner_required';end if;
 if current_setting('transaction_read_only')='on' then raise exception using errcode='25006',message='invented_appended_capture_writer_required';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception using errcode='25001',message='invented_appended_capture_isolation_required';end if;
 if p_intent is null or octet_length(p_intent) not between 1 and 4096 then raise exception using errcode='22023',message='invented_appended_capture_intent_invalid';end if;
 for i in 1..6 loop
  if parts[i] is null or octet_length(parts[i]) not between 1 and limits[i] then raise exception using errcode='22023',message='invented_appended_capture_part_invalid';end if;
 end loop;
 intent:=convert_from(p_intent,'UTF8')::jsonb;
 if jsonb_typeof(intent) is distinct from 'object' then raise exception using errcode='22023',message='invented_appended_capture_intent_invalid';end if;
 select array_agg(k order by k) into keys from jsonb_object_keys(intent) k;
 if keys is distinct from array['base_publication_id','capture_id','composition_observed_at','decision_id','issue_id','kind','part_sha256','preparation_artifact_id','preparation_operation_id','run_id','schema_version']
  or intent->'schema_version' is distinct from '1'::jsonb or intent->>'schema_version' is distinct from '1'
  or intent->>'kind' is distinct from 'invented_appended_issue_capture' or jsonb_typeof(intent->'part_sha256') is distinct from 'array' then
  raise exception using errcode='22023',message='invented_appended_capture_intent_invalid';end if;
 foreach key in array array['base_publication_id','capture_id','decision_id','issue_id','preparation_artifact_id','preparation_operation_id','run_id'] loop
  if jsonb_typeof(intent->key) is distinct from 'string' or (intent->>key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') is distinct from true then
   raise exception using errcode='22023',message='invented_appended_capture_identity_invalid';end if;
 end loop;
 if jsonb_array_length(intent->'part_sha256')<>6 then raise exception using errcode='22023',message='invented_appended_capture_hash_invalid';end if;
 for i in 1..6 loop
  if jsonb_typeof(intent->'part_sha256'->(i-1)) is distinct from 'string' or intent->'part_sha256'->>(i-1) is distinct from encode(sha256(parts[i]),'hex') then
   raise exception using errcode='22023',message='invented_appended_capture_hash_invalid';end if;
 end loop;
 if jsonb_typeof(intent->'composition_observed_at') is distinct from 'string' or (intent->>'composition_observed_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$') is distinct from true then
  raise exception using errcode='22023',message='invented_appended_capture_time_invalid';end if;
 observed:=(intent->>'composition_observed_at')::timestamptz;
 if not isfinite(observed) or observed<'0001-01-01Z'::timestamptz or observed>statement_timestamp() then raise exception using errcode='22023',message='invented_appended_capture_time_invalid';end if;
 -- Bounded fifty-record lab serializes new associations/retries; no queue/lease.
 lock table tf_appended_review.captures in share row exclusive mode;
 select * into old from tf_appended_review.captures where capture_id=(intent->>'capture_id')::uuid;
 if found then
  if old.intent_raw is distinct from p_intent or old.candidate_report_raw is distinct from p_report or old.baseline_raw is distinct from p_base
   or old.canonical_baseline_raw is distinct from p_canonical or old.context_raw is distinct from p_context or old.proposal_raw is distinct from p_proposal or old.composition_raw is distinct from p_composition then
   raise exception using errcode='23505',message='invented_appended_capture_retry_conflict';end if;
  return tf_appended_review.capture_receipt(old.capture_id);
 end if;
 if (select count(*) from tf_appended_review.captures)>=50 then raise exception using errcode='22023',message='invented_appended_capture_lab_quota';end if;
 -- Never adopt a preexisting standalone capture after losing its provenance.
 if exists(select 1 from terra_private.proposal_captures where id=(intent->>'capture_id')::uuid or decision_id=(intent->>'decision_id')::uuid) then
  raise exception using errcode='23505',message='invented_appended_capture_standalone_refused';end if;
 report:=convert_from(p_report,'UTF8')::jsonb;base:=convert_from(p_base,'UTF8')::jsonb;context:=convert_from(p_context,'UTF8')::jsonb;
 proposed:=convert_from(p_proposal,'UTF8')::jsonb;proof:=convert_from(p_composition,'UTF8')::jsonb;
 select * into prep from tf_detached_proposal.preparations where operation_id=(intent->>'preparation_operation_id')::uuid;
 if not found or prep.artifact_id::text is distinct from intent->>'preparation_artifact_id'
  or report#>>'{preparation,operation_id}' is distinct from prep.operation_id::text or report#>>'{preparation,artifact_id}' is distinct from prep.artifact_id::text
  or report->>'intent_json' is null or (report->>'intent_json')::jsonb is distinct from prep.input
  or report#>>'{parts,payload_json}' is distinct from convert_from(prep.payload_raw,'UTF8')
  or report#>>'{parts,selection_json}' is distinct from convert_from(prep.selection_raw,'UTF8')
  or report#>>'{parts,provenance_json}' is distinct from convert_from(prep.provenance_raw,'UTF8')
  or report#>>'{parts,context_json}' is distinct from convert_from(prep.context_raw,'UTF8') then
  raise exception using errcode='22023',message='invented_appended_capture_preparation_invalid';end if;
 -- Exact native jsonb representation of the unchanged owner-only receipt. The
 -- original function cannot be called as postgres; no role switch/grant occurs.
 native_prep:=jsonb_build_object('schema_version',1,'kind','invented_detached_preparation_stored','operation_id',prep.operation_id,'artifact_id',prep.artifact_id,
  'stored_at',to_char(prep.stored_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'input',prep.input,
  'payload_base64',replace(encode(prep.payload_raw,'base64'),E'\n',''),'selection_base64',replace(encode(prep.selection_raw,'base64'),E'\n',''),
  'provenance_base64',replace(encode(prep.provenance_raw,'base64'),E'\n',''),'context_base64',replace(encode(prep.context_raw,'base64'),E'\n',''));
 if report#>>'{preparation,full_receipt_sha256}' is distinct from encode(sha256(convert_to(native_prep::text,'UTF8')),'hex')
  or proof->>'candidate_full_receipt_sha256' is distinct from report#>>'{preparation,full_receipt_sha256}' then
  raise exception using errcode='22023',message='invented_appended_capture_receipt_invalid';end if;
 selection:=convert_from(prep.selection_raw,'UTF8')::jsonb;old_payload:=convert_from(prep.payload_raw,'UTF8')::jsonb;old_context:=convert_from(prep.context_raw,'UTF8')::jsonb;
 if selection is distinct from jsonb_build_object('captureId',intent->>'capture_id','runId',intent->>'run_id','decisionId',intent->>'decision_id','issueId',intent->>'issue_id','basePublicationId',intent->>'base_publication_id')
  or convert_from(p_canonical,'UTF8')::jsonb is distinct from base
  or proof->>'schema_version' is distinct from '1' or proof->'schema_version' is distinct from '1'::jsonb
  or proof->>'kind' is distinct from 'invented_appended_issue_review' or proof->>'scope' is distinct from 'invented_offline_rehearsal_only'
  or proof->>'snapshot_intent' is distinct from 'append_only_whole_issue_technical_review_not_publication'
  or proof->>'evidence_state' is distinct from 'unverified_whole_issue_preparation_not_captured_or_publication_qualified'
  or proof->>'observed_at' is distinct from intent->>'composition_observed_at'
  or proof->>'candidate_report_sha256' is distinct from encode(sha256(p_report),'hex')
  or proof->>'candidate_preparation_intent_sha256' is distinct from encode(sha256(convert_to(report->>'intent_json','UTF8')),'hex')
  or proof->>'baseline_sha256' is distinct from encode(sha256(p_base),'hex') or proof->>'canonical_baseline_sha256' is distinct from encode(sha256(p_canonical),'hex')
  or proof->>'context_raw_sha256' is distinct from encode(sha256(p_context),'hex') or proof->>'proposal_sha256' is distinct from encode(sha256(p_proposal),'hex')
  or proof->'independent_context' is distinct from context then
  raise exception using errcode='22023',message='invented_appended_capture_composition_invalid';end if;
 -- A preserved baseline citation must never stand in for this appended
 -- candidate's actual held decision/source/passsage/time association.
 select md.*,r.jurisdiction_id,sv.item_key,sv.source_url into decision
 from terra_private.machine_candidate_decisions md join terra_private.update_runs r on r.id=md.run_id
 join terra_private.source_versions sv on sv.id=md.source_version_id
 where md.id=(intent->>'decision_id')::uuid and r.id=(intent->>'run_id')::uuid;
 if not found or decision.disposition<>'held' or old_context#>>'{held,disposition}' is distinct from decision.disposition
  or old_context#>>'{held,run_id}' is distinct from decision.run_id::text or old_context#>>'{held,decision_id}' is distinct from decision.id::text
  or old_context#>>'{held,source_version_id}' is distinct from decision.source_version_id::text
  or old_context#>>'{held,content_sha256}' is distinct from decision.content_sha256
  or old_context#>>'{held,locator}' is distinct from decision.evidence_locator or old_context#>>'{held,item_key}' is distinct from decision.item_key
  or old_context#>>'{held,jurisdiction_id}' is distinct from decision.jurisdiction_id
  or old_context#>>'{held,decided_at}' is distinct from to_char(decision.decided_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  or old_payload#>>'{snapshot,claims,0,evidence,0,sourceVersionId}' is distinct from decision.source_version_id::text
  or old_payload#>>'{snapshot,claims,0,evidence,0,locator}' is distinct from decision.evidence_locator
  or old_payload#>>'{snapshot,claims,0,evidence,0,url}' is distinct from decision.source_url then
  raise exception using errcode='23514',message='invented_appended_capture_held_binding_invalid';end if;
 select i.*,j.public_slug as jurisdiction_slug into target from terra_private.issue_dossiers i join terra_private.jurisdictions j on j.id=i.jurisdiction_id where i.id=(intent->>'issue_id')::uuid;
 if not found or old_context#>>'{issue,jurisdiction_id}' is distinct from target.jurisdiction_id
  or target.jurisdiction_id is distinct from decision.jurisdiction_id
  or old_context#>>'{issue,jurisdiction_slug}' is distinct from target.jurisdiction_slug or old_context#>>'{issue,issue_slug}' is distinct from target.public_slug
  or old_context#>>'{issue,created_at}' is distinct from to_char(target.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') then
  raise exception using errcode='23514',message='invented_appended_capture_issue_binding_invalid';end if;
 select * into head from terra_private.issue_heads where issue_id=(intent->>'issue_id')::uuid for update;
 if not found or head.current_publication_id is distinct from (intent->>'base_publication_id')::uuid then
  raise exception using errcode='23514',message='invented_appended_capture_head_changed';end if;
 select * into publication from terra_private.issue_publications where id=head.current_publication_id and issue_id=head.issue_id;
 if not found or terra_private.proposal_base_json(publication) is distinct from convert_from(p_base,'UTF8')
  or context#>>'{baseline,publication_id}' is distinct from head.current_publication_id::text
  or context#>>'{baseline,issue_id}' is distinct from head.issue_id::text
  or context#>>'{baseline,content_sha256}' is distinct from encode(sha256(p_base),'hex')
  or context#>>'{baseline,head_changed_at}' is distinct from to_char(head.changed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  or context->'baseline' is distinct from jsonb_build_object('publication_id',old_context#>>'{issue,head,publication_id}','issue_id',old_context#>>'{issue,issue_id}',
   'content_sha256',old_context#>>'{issue,head,content_sha256}','head_changed_at',old_context#>>'{issue,head,changed_at}','head_observed_at',old_context#>>'{issue,observed_at}') then
  raise exception using errcode='23514',message='invented_appended_capture_base_changed';end if;
 source_id:=old_payload#>>'{snapshot,claims,0,evidence,0,sourceVersionId}';
 if jsonb_typeof(base#>'{snapshot,claims}') is distinct from 'array' or jsonb_array_length(base#>'{snapshot,claims}') not between 1 and 29
  or jsonb_array_length(old_payload#>'{snapshot,claims}')<>1
  or proposed is distinct from jsonb_build_object('schemaVersion',1,'kind','review_only',
   'snapshot',(base->'snapshot')||jsonb_build_object('title',context#>>'{page,title}','summary',context#>>'{page,summary}','lastEvidenceReviewOn',context#>>'{page,last_evidence_review_on}',
    'claims',(base#>'{snapshot,claims}')||(old_payload#>'{snapshot,claims}')),
   'dependencyManifest',jsonb_build_object('sourceVersionIds',(base#>'{dependencyManifest,sourceVersionIds}')||case when (base#>'{dependencyManifest,sourceVersionIds}') ? source_id then '[]'::jsonb else jsonb_build_array(source_id) end),
   'conflictCoverage','not_recorded','translation',jsonb_build_object('displayLanguage',context#>>'{review,translation,display_language}','status',context#>>'{review,translation,status}')) then
  raise exception using errcode='22023',message='invented_appended_capture_preservation_invalid';end if;
 ignored:=terra_private.capture_held_proposal((intent->>'capture_id')::uuid,(intent->>'run_id')::uuid,(intent->>'decision_id')::uuid,
  (intent->>'issue_id')::uuid,(intent->>'base_publication_id')::uuid,convert_from(p_proposal,'UTF8'));
 -- New provenance and real held capture commit together or neither survives.
 insert into tf_appended_review.captures(capture_id,preparation_operation_id,intent_raw,candidate_report_raw,baseline_raw,canonical_baseline_raw,context_raw,proposal_raw,composition_raw)
 values((intent->>'capture_id')::uuid,prep.operation_id,p_intent,p_report,p_base,p_canonical,p_context,p_proposal,p_composition);
 receipt:=tf_appended_review.capture_receipt((intent->>'capture_id')::uuid);
 if receipt#>>'{capture,baseContentSha256}' is distinct from encode(sha256(p_base),'hex')
  or receipt#>>'{capture,baseHeadChangedAt}' is distinct from context#>>'{baseline,head_changed_at}' then
  raise exception using errcode='23514',message='invented_appended_capture_native_base_mismatch';end if;
 return receipt;
end
$$;
revoke all on function tf_appended_review.capture_issue(bytea,bytea,bytea,bytea,bytea,bytea,bytea) from public;
