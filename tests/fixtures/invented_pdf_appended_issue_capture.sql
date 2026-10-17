-- UNINSTALLED owner-only complete PDF known-base composition laboratory.
-- Reuses immutable PDF result/preparation bytes and generic held capture/work
-- guards. Full independent PDF context/rights/support admission stays Python/TS.
-- New source only: no primary migration, backend, source approval or publication.
do $$begin if current_user<>session_user or session_user<>'postgres' then raise exception using errcode='42501',message='invented_pdf_appended_owner_required';end if;end$$;
create schema tf_pdf_review authorization postgres;
revoke all on schema tf_pdf_review from public;
create table tf_pdf_review.captures (
 capture_id uuid primary key references terra_private.proposal_captures(id),
 preparation_operation_id uuid not null unique references tf_pdf_result_rehearsal.preparations(operation_id),
 intent_raw bytea not null check(octet_length(intent_raw)between 1 and 4096),
 candidate_report_raw bytea not null check(octet_length(candidate_report_raw)between 2 and 262144),
 baseline_raw bytea not null check(octet_length(baseline_raw)between 1 and 24576),
 canonical_baseline_raw bytea not null check(octet_length(canonical_baseline_raw)between 1 and 24576),
 context_raw bytea not null check(octet_length(context_raw)between 1 and 32768),
 proposal_raw bytea not null check(octet_length(proposal_raw)between 2 and 16384),
 composition_raw bytea not null check(octet_length(composition_raw)between 2 and 65536),
 stored_at timestamptz not null default clock_timestamp()check(isfinite(stored_at)),
 constraint pdf_appended_capture_chronology check(stored_at>=(convert_from(intent_raw,'UTF8')::jsonb->>'composition_observed_at')::timestamptz),
 check(encode(sha256(candidate_report_raw),'hex')=convert_from(intent_raw,'UTF8')::jsonb#>>'{part_sha256,0}'),
 check(encode(sha256(baseline_raw),'hex')=convert_from(intent_raw,'UTF8')::jsonb#>>'{part_sha256,1}'),
 check(encode(sha256(canonical_baseline_raw),'hex')=convert_from(intent_raw,'UTF8')::jsonb#>>'{part_sha256,2}'),
 check(encode(sha256(context_raw),'hex')=convert_from(intent_raw,'UTF8')::jsonb#>>'{part_sha256,3}'),
 check(encode(sha256(proposal_raw),'hex')=convert_from(intent_raw,'UTF8')::jsonb#>>'{part_sha256,4}'),
 check(encode(sha256(composition_raw),'hex')=convert_from(intent_raw,'UTF8')::jsonb#>>'{part_sha256,5}')
);
alter table tf_pdf_review.captures enable row level security;
revoke all on tf_pdf_review.captures from public;
create function tf_pdf_review.refuse_mutation()returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin raise exception using errcode='55000',message='invented_pdf_appended_append_only';end
$$;
revoke all on function tf_pdf_review.refuse_mutation()from public;
create trigger pdf_appended_append_only before update or delete on tf_pdf_review.captures for each row execute function tf_pdf_review.refuse_mutation();
create trigger pdf_appended_no_truncate before truncate on tf_pdf_review.captures for each statement execute function tf_pdf_review.refuse_mutation();

create function tf_pdf_review.capture_receipt(p_capture uuid)returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare r tf_pdf_review.captures%rowtype;c terra_private.proposal_captures%rowtype;i jsonb;v jsonb;run_id uuid;native_prep jsonb;
begin
 if current_user<>session_user or session_user<>'postgres'then raise exception using errcode='42501',message='invented_pdf_appended_owner_required';end if;
 select * into r from tf_pdf_review.captures where capture_id=p_capture;
 if not found then raise exception using errcode='22023',message='invented_pdf_appended_unavailable';end if;
 select * into c from terra_private.proposal_captures where id=r.capture_id;
 if not found then raise exception using errcode='23514',message='invented_pdf_appended_dependency_invalid';end if;
 i:=convert_from(r.intent_raw,'UTF8')::jsonb;
 select d.run_id into run_id from terra_private.machine_candidate_decisions d where d.id=c.decision_id;
 if not found or c.id::text is distinct from i->>'capture_id'or c.decision_id::text is distinct from i->>'decision_id'or c.issue_id::text is distinct from i->>'issue_id'
  or run_id::text is distinct from i->>'run_id'or c.base_publication_id is null or c.base_head_changed_at is null or c.base_content_sha256 is null
  or c.base_publication_id::text is distinct from i->>'base_publication_id'or c.base_content_sha256 is distinct from encode(sha256(r.baseline_raw),'hex')
  or c.proposal_json is distinct from convert_from(r.proposal_raw,'UTF8')or c.proposal_sha256 is distinct from encode(sha256(r.proposal_raw),'hex')
  or not isfinite(c.captured_at)or not isfinite(r.stored_at)or c.captured_at<(i->>'composition_observed_at')::timestamptz
  or c.captured_at>r.stored_at or r.stored_at>clock_timestamp()or r.stored_at>='10000-01-01Z'::timestamptz then
  raise exception using errcode='23514',message='invented_pdf_appended_dependency_invalid';end if;
 native_prep:=tf_pdf_result_rehearsal.preparation_receipt(r.preparation_operation_id);
 if encode(sha256(convert_to(native_prep::text,'UTF8')),'hex')is distinct from i->>'preparation_full_receipt_sha256'then raise exception using errcode='23514',message='invented_pdf_appended_dependency_invalid';end if;
 v:=jsonb_build_object('schema_version',1,'kind','invented_pdf_appended_issue_capture_stored','capture_id',r.capture_id,'preparation_operation_id',r.preparation_operation_id,
  'stored_at',to_char(r.stored_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'intent_base64',replace(encode(r.intent_raw,'base64'),E'\n',''),
  'parts_base64',jsonb_build_array(replace(encode(r.candidate_report_raw,'base64'),E'\n',''),replace(encode(r.baseline_raw,'base64'),E'\n',''),replace(encode(r.canonical_baseline_raw,'base64'),E'\n',''),replace(encode(r.context_raw,'base64'),E'\n',''),replace(encode(r.proposal_raw,'base64'),E'\n',''),replace(encode(r.composition_raw,'base64'),E'\n','')),
  'capture',jsonb_build_object('captureId',c.id,'runId',run_id,'decisionId',c.decision_id,'issueId',c.issue_id,'basePublicationId',c.base_publication_id,
   'baseHeadChangedAt',to_char(c.base_head_changed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'baseContentSha256',c.base_content_sha256,'proposalSha256',c.proposal_sha256,
   'capturedAt',to_char(c.captured_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'sourceReceipts',c.source_receipts));
 if octet_length(v::text)+29>131072 then raise exception using errcode='22023',message='invented_pdf_appended_readback_limit';end if;
 return v;
end
$$;
revoke all on function tf_pdf_review.capture_receipt(uuid)from public;

create function tf_pdf_review.capture_issue(p_intent bytea,p_report bytea,p_base bytea,p_canonical bytea,p_context bytea,p_proposal bytea,p_composition bytea)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare i jsonb;r jsonb;intent_json json;report_json json;s jsonb;context jsonb;payload jsonb;proof jsonb;
 base jsonb;whole_context jsonb;proposed jsonb;composition jsonb;part_json json;native_sources jsonb;dependencies jsonb;source_count integer;
 native_prep jsonb;native_result jsonb;receipt jsonb;generic jsonb;keys text[];key text;index integer;part bytea;
 canonical_intent text;metadata jsonb;frame jsonb;result_frame jsonb;result_intent jsonb;current_frame jsonb;derivation jsonb;original_doc jsonb;
 current_raw bytea;derivation_raw bytea;original_raw bytea;parts bytea[]:=array[]::bytea[];part_keys text[]:=array['payload','selection','provenance','context'];
 carriers bytea[]:=array[p_report,p_base,p_canonical,p_context,p_proposal,p_composition];limits integer[]:=array[262144,24576,24576,32768,16384,65536];
 prep tf_pdf_result_rehearsal.preparations%rowtype;source_result tf_pdf_result_rehearsal.results%rowtype;publication terra_private.issue_publications%rowtype;
 old tf_pdf_review.captures%rowtype;decision record;target record;head terra_private.issue_heads%rowtype;
begin
 if current_user<>session_user or session_user<>'postgres'then raise exception using errcode='42501',message='invented_pdf_appended_owner_required';end if;
 if current_setting('transaction_read_only')='on'then raise exception using errcode='25006',message='invented_pdf_appended_writer_required';end if;
 if current_setting('transaction_isolation')<>'read committed'then raise exception using errcode='25001',message='invented_pdf_appended_isolation_required';end if;
 if p_intent is null or octet_length(p_intent)not between 1 and 4096 then raise exception using errcode='22023',message='invented_pdf_appended_intent_invalid';end if;
 for index in 1..6 loop if carriers[index]is null or octet_length(carriers[index])not between 1 and limits[index]then raise exception using errcode='22023',message='invented_pdf_appended_parts_invalid';end if;end loop;
 begin intent_json:=convert_from(p_intent,'UTF8')::json;report_json:=convert_from(p_report,'UTF8')::json;
  i:=intent_json::jsonb;r:=report_json::jsonb;base:=convert_from(p_base,'UTF8')::jsonb;whole_context:=convert_from(p_context,'UTF8')::jsonb;proposed:=convert_from(p_proposal,'UTF8')::jsonb;composition:=convert_from(p_composition,'UTF8')::jsonb;
 exception when others then raise exception using errcode='22023',message='invented_pdf_appended_parts_invalid';end;
 if jsonb_typeof(i)is distinct from 'object'or jsonb_typeof(r)is distinct from 'object'or jsonb_typeof(base)is distinct from 'object'or jsonb_typeof(whole_context)is distinct from 'object'or jsonb_typeof(proposed)is distinct from 'object'or jsonb_typeof(composition)is distinct from 'object'then raise exception using errcode='22023',message='invented_pdf_appended_shape_invalid';end if;
 select array_agg(k order by k)into keys from json_object_keys(intent_json)k;
 if keys is distinct from array['base_publication_id','capture_id','composition_observed_at','decision_id','issue_id','kind','part_sha256','preparation_artifact_id','preparation_full_receipt_sha256','preparation_intent_sha256','preparation_operation_id','preparation_stored_at','run_id','schema_version','snapshot_intent']
  or i->'schema_version'is distinct from '1'::jsonb or intent_json->>'schema_version'is distinct from '1'or i->>'kind'is distinct from 'invented_pdf_appended_issue_capture'
  or i->>'snapshot_intent'is distinct from 'append_only_whole_issue_technical_review_not_publication'then raise exception using errcode='22023',message='invented_pdf_appended_intent_invalid';end if;
 foreach key in array array['capture_id','run_id','decision_id','issue_id','base_publication_id','preparation_operation_id','preparation_artifact_id']loop
  if jsonb_typeof(i->key)is distinct from 'string'or(i->>key~'^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$')is distinct from true then raise exception using errcode='22023',message='invented_pdf_appended_identity_invalid';end if;
 end loop;
 foreach key in array array['capture_id','run_id','decision_id','issue_id','base_publication_id']loop
  if(i->>key~'^[a-f0-9]{8}-[a-f0-9]{4}-[45][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$')is distinct from true then raise exception using errcode='22023',message='invented_pdf_appended_identity_invalid';end if;
 end loop;
 foreach key in array array['preparation_intent_sha256','preparation_full_receipt_sha256']loop
  if jsonb_typeof(i->key)is distinct from 'string'or(i->>key~'^[a-f0-9]{64}$')is distinct from true then raise exception using errcode='22023',message='invented_pdf_appended_digest_invalid';end if;
 end loop;
 begin
 foreach key in array array['composition_observed_at','preparation_stored_at']loop
  if jsonb_typeof(i->key)is distinct from 'string'or(i->>key~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{6}Z$')is distinct from true
   or not isfinite((i->>key)::timestamptz)or(i->>key)::timestamptz<'0001-01-01Z'::timestamptz or(i->>key)::timestamptz>statement_timestamp()
   or to_char((i->>key)::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')is distinct from i->>key then raise exception using errcode='22023',message='invented_pdf_appended_time_invalid';end if;
 end loop;
 exception when others then raise exception using errcode='22023',message='invented_pdf_appended_time_invalid';end;
 if(i->>'preparation_stored_at')::timestamptz>(i->>'composition_observed_at')::timestamptz or jsonb_typeof(i->'part_sha256')is distinct from 'array'or jsonb_array_length(i->'part_sha256')<>6 then raise exception using errcode='22023',message='invented_pdf_appended_digest_invalid';end if;
 for index in 0..5 loop if jsonb_typeof(i->'part_sha256'->index)is distinct from 'string'or i->'part_sha256'->>index is distinct from encode(sha256(carriers[index+1]),'hex')then raise exception using errcode='22023',message='invented_pdf_appended_digest_invalid';end if;end loop;
 select '{'||string_agg(to_jsonb(k)::text||':'||regexp_replace(v::text,'[[:space:]]','','g'),','order by k collate "C")||'}'into canonical_intent from jsonb_each(i)as entry(k,v);
 if convert_from(p_intent,'UTF8')is distinct from canonical_intent then raise exception using errcode='22023',message='invented_pdf_appended_canonical_intent_invalid';end if;
 select array_agg(k order by k)into keys from json_object_keys(report_json)k;
 if keys is distinct from array['intent_json','kind','limits','observed_at','parts','preparation','review_state','schema_version','scope']
  or r->'schema_version'is distinct from '1'::jsonb or report_json->>'schema_version'is distinct from '1'
  or r->>'kind'is distinct from 'private_stored_pdf_preparation_review_report'
  or r->>'scope'is distinct from 'invented_supplied_pdf_custody_only' or r->>'review_state'is distinct from 'unverified'
  or jsonb_typeof(r->'preparation')is distinct from 'object' or jsonb_typeof(r->'parts')is distinct from 'object'
  or jsonb_typeof(r->'limits')is distinct from 'object' then
  raise exception using errcode='22023',message='invented_pdf_appended_report_shape_invalid';end if;
 select array_agg(k order by k)into keys from json_object_keys(report_json->'preparation')k;
 if keys is distinct from array['artifact_id','intent_sha256','operation_id','packet_sha256','prepared_at','receipt_sha256','result_operation_id','stored_at'] then
  raise exception using errcode='22023',message='invented_pdf_appended_report_shape_invalid';end if;
 select array_agg(k order by k)into keys from json_object_keys(report_json->'parts')k;
 if keys is distinct from array['context_json','payload_json','provenance_json','selection_json'] then
  raise exception using errcode='22023',message='invented_pdf_appended_report_shape_invalid';end if;
 select array_agg(k order by k)into keys from json_object_keys(report_json->'limits')k;
 if keys is distinct from array['current_publication_observed','current_qualification_established','full_preparation_receipt_included','full_result_receipt_included','held_capture_observed','original_pdf_included','output_body_included','publication_authorized','request_body_included','source_authenticated']
  or r->'limits'is distinct from jsonb_build_object('original_pdf_included',false,'request_body_included',false,'output_body_included',false,
   'full_result_receipt_included',false,'full_preparation_receipt_included',false,'source_authenticated',false,
   'current_qualification_established',false,'held_capture_observed',false,'current_publication_observed',false,'publication_authorized',false)then
  raise exception using errcode='22023',message='invented_pdf_appended_report_limits_invalid';end if;

 -- Closed carrier roots preserve duplicates for field-count admission. The full
 -- strict duplicate-free nested PDF/claim/canonical dialect remains mandatory
 -- in the independently supplied Python/TypeScript producer; SQL is a join guard.
 select array_agg(k order by k)into keys from json_object_keys(convert_from(p_composition,'UTF8')::json)k;
 if keys is distinct from array['appended_claim_sha256','baseline_sha256','candidate_full_receipt_sha256','candidate_part_sha256','candidate_preparation_intent_sha256','candidate_report_sha256','canonical_baseline_sha256','context_raw_sha256','context_sha256','evidence_state','independent_context','kind','observed_at','preserved_claim_sha256','proposal_sha256','schema_version','scope','snapshot_intent','source_manifest_sha256']
  or composition->'schema_version'is distinct from '1'::jsonb or (convert_from(p_composition,'UTF8')::json)->>'schema_version'is distinct from '1'
  or composition->>'kind'is distinct from 'invented_pdf_appended_issue_review'
  or composition->>'scope'is distinct from 'invented_supplied_full_pdf_receipts_only'
  or composition->>'snapshot_intent'is distinct from i->>'snapshot_intent'
  or composition->>'evidence_state'is distinct from 'unverified_whole_issue_preparation_not_captured_or_publication_qualified'
  or composition->>'observed_at'is distinct from i->>'composition_observed_at'
  or composition->>'candidate_report_sha256'is distinct from encode(sha256(p_report),'hex')
  or composition->>'candidate_preparation_intent_sha256'is distinct from i->>'preparation_intent_sha256'
  or composition->>'candidate_full_receipt_sha256'is distinct from i->>'preparation_full_receipt_sha256'
  or composition->>'baseline_sha256'is distinct from encode(sha256(p_base),'hex')
  or composition->>'canonical_baseline_sha256'is distinct from encode(sha256(p_canonical),'hex')
  or composition->>'context_raw_sha256'is distinct from encode(sha256(p_context),'hex')
  or composition->>'proposal_sha256'is distinct from encode(sha256(p_proposal),'hex')
  or composition->'independent_context'is distinct from whole_context
  or jsonb_typeof(composition->'candidate_part_sha256')is distinct from 'array'
  or jsonb_typeof(composition->'preserved_claim_sha256')is distinct from 'array' then
  raise exception using errcode='22023',message='invented_pdf_appended_composition_invalid';end if;
 if jsonb_array_length(composition->'candidate_part_sha256')<>4 then raise exception using errcode='22023',message='invented_pdf_appended_composition_invalid';end if;
 foreach key in array array['context_sha256','appended_claim_sha256','source_manifest_sha256']loop
  if jsonb_typeof(composition->key)is distinct from 'string'or(composition->>key~'^[a-f0-9]{64}$')is distinct from true then raise exception using errcode='22023',message='invented_pdf_appended_digest_invalid';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(composition->'preserved_claim_sha256')v where jsonb_typeof(v)is distinct from 'string'or(v#>>'{}'~'^[a-f0-9]{64}$')is distinct from true)then raise exception using errcode='22023',message='invented_pdf_appended_digest_invalid';end if;
 select array_agg(k order by k)into keys from json_object_keys(convert_from(p_context,'UTF8')::json)k;
 if keys is distinct from array['baseline','kind','page','review','schema_version','snapshot_intent']
  or whole_context->'schema_version'is distinct from '1'::jsonb or (convert_from(p_context,'UTF8')::json)->>'schema_version'is distinct from '1'
  or whole_context->>'kind'is distinct from 'invented_append_only_issue_context'or whole_context->>'snapshot_intent'is distinct from i->>'snapshot_intent'
  or jsonb_typeof(whole_context->'baseline')is distinct from 'object'or jsonb_typeof(whole_context->'page')is distinct from 'object'
  or jsonb_typeof(whole_context->'review')is distinct from 'object'or jsonb_typeof(whole_context#>'{review,translation}')is distinct from 'object'then
  raise exception using errcode='22023',message='invented_pdf_appended_context_invalid';end if;
 select array_agg(k order by k)into keys from json_object_keys((convert_from(p_context,'UTF8')::json)->'baseline')k;
 if keys is distinct from array['content_sha256','head_changed_at','head_observed_at','issue_id','publication_id']then raise exception using errcode='22023',message='invented_pdf_appended_context_invalid';end if;
 select array_agg(k order by k)into keys from json_object_keys((convert_from(p_context,'UTF8')::json)->'page')k;
 if keys is distinct from array['last_evidence_review_on','summary','title']then raise exception using errcode='22023',message='invented_pdf_appended_context_invalid';end if;
 select array_agg(k order by k)into keys from json_object_keys((convert_from(p_context,'UTF8')::json)->'review')k;
 if keys is distinct from array['conflict_coverage','translation']then raise exception using errcode='22023',message='invented_pdf_appended_context_invalid';end if;
 select array_agg(k order by k)into keys from json_object_keys((convert_from(p_context,'UTF8')::json)#>'{review,translation}')k;
 if keys is distinct from array['display_language','status']or whole_context#>>'{review,conflict_coverage}'is distinct from 'not_recorded'
  or(whole_context#>>'{review,translation,status}'in('unreviewed','not_recorded'))is distinct from true then raise exception using errcode='22023',message='invented_pdf_appended_context_invalid';end if;
 select array_agg(k order by k)into keys from json_object_keys(convert_from(p_base,'UTF8')::json)k;
 if keys is distinct from array['dependencyManifest','id','issueId','kind','revision','snapshot']then raise exception using errcode='22023',message='invented_pdf_appended_baseline_invalid';end if;
 begin
  if convert_from(p_canonical,'UTF8')::jsonb is distinct from base then raise exception using errcode='22023',message='invented_pdf_appended_baseline_invalid';end if;
 exception when others then raise exception using errcode='22023',message='invented_pdf_appended_baseline_invalid';end;
 select array_agg(k order by k)into keys from json_object_keys(convert_from(p_proposal,'UTF8')::json)k;
 if keys is distinct from array['conflictCoverage','dependencyManifest','kind','schemaVersion','snapshot','translation']then raise exception using errcode='22023',message='invented_pdf_appended_proposal_invalid';end if;
 -- Bounded lab serialization also prevents two companion rows for one prep.
 lock table tf_pdf_review.captures in share row exclusive mode;
 select * into old from tf_pdf_review.captures where capture_id=(i->>'capture_id')::uuid;
 if found then
  if old.intent_raw is distinct from p_intent or old.candidate_report_raw is distinct from p_report or old.baseline_raw is distinct from p_base
   or old.canonical_baseline_raw is distinct from p_canonical or old.context_raw is distinct from p_context
   or old.proposal_raw is distinct from p_proposal or old.composition_raw is distinct from p_composition then
   raise exception using errcode='23505',message='invented_pdf_appended_retry_conflict';end if;
  return tf_pdf_review.capture_receipt(old.capture_id);
 end if;
 if(select count(*)from tf_pdf_review.captures)>=50 then raise exception using errcode='22023',message='invented_pdf_appended_lab_quota';end if;
 if exists(select 1 from terra_private.proposal_captures where id=(i->>'capture_id')::uuid or decision_id=(i->>'decision_id')::uuid)then
  raise exception using errcode='23505',message='invented_pdf_appended_standalone_refused';end if;
 if exists(select 1 from tf_pdf_review.captures where preparation_operation_id=(i->>'preparation_operation_id')::uuid)then
  raise exception using errcode='23505',message='invented_pdf_appended_preparation_already_used';end if;
 select * into prep from tf_pdf_result_rehearsal.preparations where operation_id=(i->>'preparation_operation_id')::uuid;
 if not found or prep.artifact_id::text is distinct from i->>'preparation_artifact_id'
  or r#>>'{preparation,operation_id}'is distinct from prep.operation_id::text or r#>>'{preparation,artifact_id}'is distinct from prep.artifact_id::text
  or r#>>'{preparation,result_operation_id}'is distinct from prep.result_operation_id::text
  or r#>>'{preparation,stored_at}'is distinct from to_char(prep.stored_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  or to_char(prep.stored_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')is distinct from i->>'preparation_stored_at'
  or prep.stored_at>(i->>'composition_observed_at')::timestamptz or r->>'observed_at'is distinct from i->>'composition_observed_at'
  or jsonb_typeof(r->'intent_json')is distinct from 'string' or convert_to(r->>'intent_json','UTF8')is distinct from prep.intent
  or encode(sha256(prep.intent),'hex')is distinct from i->>'preparation_intent_sha256'
  or r#>>'{preparation,intent_sha256}'is distinct from encode(sha256(prep.intent),'hex')
  or r#>>'{preparation,packet_sha256}'is distinct from encode(sha256(prep.packet),'hex')then
  raise exception using errcode='22023',message='invented_pdf_appended_preparation_invalid';end if;
 metadata:=convert_from(prep.intent,'UTF8')::jsonb;frame:=convert_from(prep.packet,'UTF8')::jsonb;
 if metadata->>'kind'is distinct from 'invented_detached_pdf_proposal_preparation'
  or frame->>'kind'is distinct from 'invented_portable_pdf_preparation'
  or decode(frame->>'intent_base64','base64')is distinct from prep.intent
  or r#>>'{preparation,prepared_at}'is distinct from metadata->>'prepared_at'then
  raise exception using errcode='22023',message='invented_pdf_appended_metadata_invalid';end if;
 for index in 1..4 loop
  key:=part_keys[index];part:=decode(frame->>(key||'_base64'),'base64');
  if part is null or octet_length(part)not between 1 and (case index when 1 then 16384 when 2 then 2048 when 3 then 65536 else 32768 end)
   or replace(encode(part,'base64'),E'\n','')is distinct from frame->>(key||'_base64')
   or jsonb_typeof(r->'parts'->(key||'_json'))is distinct from 'string'
   or convert_to(r->'parts'->>(key||'_json'),'UTF8')is distinct from part
   or composition->'candidate_part_sha256'->>(index-1)is distinct from encode(sha256(part),'hex')
   or metadata->>(case index when 4 then 'context_raw_sha256' else key||'_sha256' end)is distinct from encode(sha256(part),'hex')then
   raise exception using errcode='22023',message='invented_pdf_appended_part_invalid';end if;
  parts:=array_append(parts,part);
 end loop;
 payload:=convert_from(parts[1],'UTF8')::jsonb;s:=convert_from(parts[2],'UTF8')::jsonb;
 proof:=convert_from(parts[3],'UTF8')::jsonb;context:=convert_from(parts[4],'UTF8')::jsonb;
 if proof->>'kind'is distinct from 'detached_pdf_extraction_proposal'
  or proof->>'prepared_at'is distinct from metadata->>'prepared_at' or proof->>'artifact_observed_at'is distinct from metadata->>'prepared_at'
  or context is distinct from proof->'independent_context'
  or s is distinct from jsonb_build_object('captureId',i->>'capture_id','runId',i->>'run_id','decisionId',i->>'decision_id','issueId',i->>'issue_id','basePublicationId',i->>'base_publication_id')
  or context#>'{issue,head}'is distinct from jsonb_build_object('publication_id',i->>'base_publication_id','content_sha256',encode(sha256(p_base),'hex'),'changed_at',whole_context#>>'{baseline,head_changed_at}')
  or context->>'snapshot_intent'is distinct from 'single_claim_technical_review_not_issue_replacement'
  or payload->>'kind'is distinct from 'review_only' or payload->>'conflictCoverage'is distinct from 'not_recorded'
  or (payload#>>'{translation,status}'in('unreviewed','not_recorded'))is distinct from true
  or jsonb_typeof(payload#>'{snapshot,claims}')is distinct from 'array' or jsonb_array_length(payload#>'{snapshot,claims}')<>1
  or jsonb_typeof(payload#>'{snapshot,claims,0,evidence}')is distinct from 'array' or jsonb_array_length(payload#>'{snapshot,claims,0,evidence}')<>1
  or jsonb_typeof(payload#>'{dependencyManifest,sourceVersionIds}')is distinct from 'array' or jsonb_array_length(payload#>'{dependencyManifest,sourceVersionIds}')<>1 then
  raise exception using errcode='23514',message='invented_pdf_appended_candidate_intent_invalid';end if;
 native_prep:=tf_pdf_result_rehearsal.preparation_receipt(prep.operation_id);
 if encode(sha256(convert_to(native_prep::text,'UTF8')),'hex')is distinct from i->>'preparation_full_receipt_sha256'
  or r#>>'{preparation,receipt_sha256}'is distinct from i->>'preparation_full_receipt_sha256'then
  raise exception using errcode='22023',message='invented_pdf_appended_receipt_invalid';end if;
 select * into source_result from tf_pdf_result_rehearsal.results where operation_id=prep.result_operation_id;
 if not found then raise exception using errcode='23503',message='invented_pdf_appended_result_missing';end if;
 native_result:=tf_pdf_result_rehearsal.result_receipt(source_result.operation_id);
 result_intent:=convert_from(source_result.intent,'UTF8')::jsonb;result_frame:=convert_from(source_result.packet,'UTF8')::jsonb;
 if proof#>>'{artifact,operation_id}'is distinct from source_result.operation_id::text
  or proof#>>'{artifact,artifact_id}'is distinct from source_result.artifact_id::text
  or metadata->>'extraction_operation_id'is distinct from source_result.operation_id::text or metadata->>'extraction_artifact_id'is distinct from source_result.artifact_id::text
  or metadata->>'extraction_request_sha256'is distinct from result_intent->>'request_sha256'
  or metadata->>'extraction_output_sha256'is distinct from result_intent->>'output_sha256'
  or proof->>'canonical_intent_sha256'is distinct from encode(sha256(source_result.intent),'hex')
  or proof->>'full_receipt_sha256'is distinct from encode(sha256(convert_to(native_result::text,'UTF8')),'hex')
  or proof->>'artifact_stored_at'is distinct from to_char(source_result.stored_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  or proof->>'artifact_prepared_at'is distinct from result_intent->>'prepared_at'
  or source_result.stored_at>(metadata->>'prepared_at')::timestamptz
  or prep.stored_at<(metadata->>'prepared_at')::timestamptz then
  raise exception using errcode='23514',message='invented_pdf_appended_result_invalid';end if;
 if (result_intent->'previous_packet_sha256'='null'::jsonb and proof->'previous'is distinct from 'null'::jsonb)
  or (result_intent->'previous_packet_sha256'<>'null'::jsonb and proof#>>'{previous,packet_sha256}'is distinct from result_intent->>'previous_packet_sha256')then
  raise exception using errcode='23514',message='invented_pdf_appended_result_invalid';end if;
 -- Cheap immutable-byte crosslinks to the ACTUAL stored current PDF derivation.
 -- Full original parsing/mapping/support checks remain trusted Python/TS work.
 current_raw:=decode(result_frame#>>'{current,base64}','base64');current_frame:=convert_from(current_raw,'UTF8')::jsonb;
 original_raw:=decode(current_frame->>'original_base64','base64');derivation_raw:=decode(current_frame->>'derivation_base64','base64');
 if current_raw is null or octet_length(current_raw)not between 1 and 65536
  or encode(sha256(current_raw),'hex')is distinct from result_intent->>'current_packet_sha256'
  or proof#>>'{current,packet_sha256}'is distinct from result_intent->>'current_packet_sha256'
  or original_raw is null or octet_length(original_raw)not between 1 and 65536
  or encode(sha256(original_raw),'hex')is distinct from current_frame->>'original_sha256'
  or derivation_raw is null or octet_length(derivation_raw)not between 1 and 32768
  or encode(sha256(derivation_raw),'hex')is distinct from current_frame->>'derivation_sha256'
  or proof#>>'{current,derivation_sha256}'is distinct from current_frame->>'derivation_sha256'
  or proof#>>'{current,inspection_sha256}'is distinct from current_frame->>'inspection_sha256'then
  raise exception using errcode='23514',message='invented_pdf_appended_original_invalid';end if;
 derivation:=convert_from(derivation_raw,'UTF8')::jsonb;original_doc:=derivation->'document';
 if original_doc->>'content_sha256'is distinct from encode(sha256(original_raw),'hex')
  or proof#>>'{current,mapping_sha256}'is distinct from derivation->>'mapping_sha256'
  or proof#>>'{current,language_code}'is distinct from derivation->>'language_code'then
  raise exception using errcode='23514',message='invented_pdf_appended_original_invalid';end if;
 select md.*,r.jurisdiction_id,sv.item_key,sv.source_url,sv.language_code,sv.retrieved_at,sv.content_sha256 as original_hash,sr.source_key into decision
 from terra_private.machine_candidate_decisions md join terra_private.update_runs r on r.id=md.run_id
 join terra_private.source_versions sv on sv.id=md.source_version_id join terra_private.source_registrations sr on sr.id=sv.registration_id
 where md.id=(i->>'decision_id')::uuid and r.id=(i->>'run_id')::uuid;
 if not found or decision.source_version_id::text is distinct from original_doc->>'source_version_id'
  or decision.original_hash is distinct from original_doc->>'content_sha256' or decision.content_sha256 is distinct from decision.original_hash
  or decision.item_key is distinct from original_doc->>'item_key' or decision.source_url is distinct from original_doc->>'source_url'
  or decision.source_key is distinct from original_doc->>'source_key' or decision.language_code is distinct from derivation->>'language_code'
  or to_char(decision.retrieved_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')is distinct from original_doc->>'retrieved_at'
  or proof#>>'{current,source_version_id}'is distinct from decision.source_version_id::text
  or proof#>>'{current,content_sha256}'is distinct from decision.original_hash or proof#>>'{current,item_key}'is distinct from decision.item_key
  or proof#>>'{current,source_url}'is distinct from decision.source_url or proof#>>'{current,source_key}'is distinct from decision.source_key
  or proof#>>'{current,language_code}'is distinct from decision.language_code
  or proof#>>'{current,retrieved_at}'is distinct from to_char(decision.retrieved_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  or decision.disposition<>'held' or context#>>'{held,disposition}'is distinct from decision.disposition
  or context#>>'{held,run_id}'is distinct from decision.run_id::text or context#>>'{held,decision_id}'is distinct from decision.id::text
  or context#>>'{held,source_version_id}'is distinct from decision.source_version_id::text or context#>>'{held,content_sha256}'is distinct from decision.content_sha256
  or context#>>'{held,locator}'is distinct from decision.evidence_locator or context#>>'{held,item_key}'is distinct from decision.item_key
  or context#>>'{held,jurisdiction_id}'is distinct from decision.jurisdiction_id
  or context#>>'{held,decided_at}'is distinct from to_char(decision.decided_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  or payload#>>'{snapshot,claims,0,evidence,0,sourceVersionId}'is distinct from decision.source_version_id::text
  or payload#>>'{snapshot,claims,0,evidence,0,locator}'is distinct from decision.evidence_locator
  or payload#>>'{snapshot,claims,0,evidence,0,url}'is distinct from decision.source_url
  or payload#>>'{dependencyManifest,sourceVersionIds,0}'is distinct from decision.source_version_id::text then
  raise exception using errcode='23514',message='invented_pdf_appended_held_binding_invalid';end if;
 select d.*,j.public_slug as jurisdiction_slug into target from terra_private.issue_dossiers d join terra_private.jurisdictions j on j.id=d.jurisdiction_id where d.id=(i->>'issue_id')::uuid;
 if not found or target.jurisdiction_id is distinct from decision.jurisdiction_id or context#>>'{issue,issue_id}'is distinct from target.id::text
  or context#>>'{issue,jurisdiction_id}'is distinct from target.jurisdiction_id or context#>>'{issue,jurisdiction_slug}'is distinct from target.jurisdiction_slug
  or context#>>'{issue,issue_slug}'is distinct from target.public_slug or context#>>'{issue,created_at}'is distinct from to_char(target.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')then
  raise exception using errcode='23514',message='invented_pdf_appended_issue_binding_invalid';end if;

 select * into head from terra_private.issue_heads where issue_id=(i->>'issue_id')::uuid for update;
 if not found or head.current_publication_id is null or head.current_publication_id is distinct from(i->>'base_publication_id')::uuid then
  raise exception using errcode='23514',message='invented_pdf_appended_head_changed';end if;
 select * into publication from terra_private.issue_publications where id=head.current_publication_id and issue_id=head.issue_id;
 -- EXACT native historical serializer bytes, not a re-signed portable baseline.
 if not found or terra_private.proposal_base_json(publication)is distinct from convert_from(p_base,'UTF8')
  or whole_context#>>'{baseline,publication_id}'is distinct from head.current_publication_id::text
  or whole_context#>>'{baseline,issue_id}'is distinct from head.issue_id::text
  or whole_context#>>'{baseline,content_sha256}'is distinct from encode(sha256(p_base),'hex')
  or whole_context#>>'{baseline,head_changed_at}'is distinct from to_char(head.changed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  or whole_context->'baseline'is distinct from jsonb_build_object('publication_id',context#>>'{issue,head,publication_id}','issue_id',context#>>'{issue,issue_id}',
   'content_sha256',context#>>'{issue,head,content_sha256}','head_changed_at',context#>>'{issue,head,changed_at}','head_observed_at',context#>>'{issue,observed_at}')then
  raise exception using errcode='23514',message='invented_pdf_appended_baseline_invalid';end if;
 if jsonb_typeof(base#>'{snapshot,claims}')is distinct from 'array'or jsonb_typeof(base#>'{dependencyManifest,sourceVersionIds}')is distinct from 'array'then
  raise exception using errcode='22023',message='invented_pdf_appended_preservation_invalid';end if;
 if jsonb_array_length(base#>'{snapshot,claims}')not between 1 and 29
  or jsonb_array_length(composition->'preserved_claim_sha256')<>jsonb_array_length(base#>'{snapshot,claims}')
  or proposed is distinct from jsonb_build_object('schemaVersion',1,'kind','review_only',
   'snapshot',(base->'snapshot')||jsonb_build_object('title',whole_context#>>'{page,title}','summary',whole_context#>>'{page,summary}','lastEvidenceReviewOn',whole_context#>>'{page,last_evidence_review_on}',
    'claims',(base#>'{snapshot,claims}')||(payload#>'{snapshot,claims}')),
   'dependencyManifest',jsonb_build_object('sourceVersionIds',(base#>'{dependencyManifest,sourceVersionIds}')||case when(base#>'{dependencyManifest,sourceVersionIds}')?(payload#>>'{snapshot,claims,0,evidence,0,sourceVersionId}')then '[]'::jsonb else jsonb_build_array(payload#>>'{snapshot,claims,0,evidence,0,sourceVersionId}')end),
   'conflictCoverage','not_recorded','translation',jsonb_build_object('displayLanguage',whole_context#>>'{review,translation,display_language}','status',whole_context#>>'{review,translation,status}'))
  or whole_context#>>'{review,translation,display_language}'is distinct from payload#>>'{translation,displayLanguage}'then
  raise exception using errcode='22023',message='invented_pdf_appended_preservation_invalid';end if;
 -- Include EVERY preserved/current dependency in the PREWRITE native envelope.
 -- This is separate from the larger portable report/transfer capacity.
 dependencies:=proposed#>'{dependencyManifest,sourceVersionIds}';
 if jsonb_typeof(dependencies)is distinct from 'array'then raise exception using errcode='22023',message='invented_pdf_appended_dependencies_invalid';end if;
 if jsonb_array_length(dependencies)not between 1 and 120 then raise exception using errcode='22023',message='invented_pdf_appended_dependencies_invalid';end if;
 if exists(select 1 from jsonb_array_elements(dependencies)v where jsonb_typeof(v)is distinct from 'string'or(v#>>'{}'~'^[a-f0-9]{8}-[a-f0-9]{4}-[45][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$')is distinct from true)
  or(select count(distinct v)from jsonb_array_elements_text(dependencies)v)<>jsonb_array_length(dependencies)then
  raise exception using errcode='22023',message='invented_pdf_appended_dependencies_invalid';end if;
 select jsonb_agg(jsonb_build_object('sourceVersionId',sv.id,'contentSha256',sv.content_sha256,
  'retrievedAt',to_char(sv.retrieved_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'languageCode',sv.language_code)order by sv.id),count(*)
 into native_sources,source_count from terra_private.source_versions sv where sv.id in(select value::uuid from jsonb_array_elements_text(dependencies));
 if source_count<>jsonb_array_length(dependencies)then raise exception using errcode='23503',message='invented_pdf_appended_source_missing';end if;
 receipt:=jsonb_build_object('schema_version',1,'kind','invented_pdf_appended_issue_capture_stored','capture_id',i->>'capture_id','preparation_operation_id',prep.operation_id,
  'stored_at','9999-12-31T23:59:59.999999Z','intent_base64',replace(encode(p_intent,'base64'),E'\n',''),
  'parts_base64',jsonb_build_array(replace(encode(p_report,'base64'),E'\n',''),replace(encode(p_base,'base64'),E'\n',''),replace(encode(p_canonical,'base64'),E'\n',''),replace(encode(p_context,'base64'),E'\n',''),replace(encode(p_proposal,'base64'),E'\n',''),replace(encode(p_composition,'base64'),E'\n','')),
  'capture',jsonb_build_object('captureId',i->>'capture_id','runId',i->>'run_id','decisionId',i->>'decision_id','issueId',i->>'issue_id','basePublicationId',head.current_publication_id,
   'baseHeadChangedAt',to_char(head.changed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'baseContentSha256',encode(sha256(p_base),'hex'),'proposalSha256',encode(sha256(p_proposal),'hex'),
   'capturedAt','9999-12-31T23:59:59.999999Z','sourceReceipts',native_sources));
 if octet_length(receipt::text)+4096>131072 then raise exception using errcode='22023',message='invented_pdf_appended_readback_limit';end if;
 generic:=terra_private.capture_held_proposal((i->>'capture_id')::uuid,(i->>'run_id')::uuid,(i->>'decision_id')::uuid,
  (i->>'issue_id')::uuid,(i->>'base_publication_id')::uuid,convert_from(p_proposal,'UTF8'));
 -- The generic decision may have been inserted concurrently after absence.
 if generic->>'status'is distinct from 'stored'then raise exception using errcode='23505',message='invented_pdf_appended_concurrent_standalone_refused';end if;
 insert into tf_pdf_review.captures(capture_id,preparation_operation_id,intent_raw,candidate_report_raw,baseline_raw,canonical_baseline_raw,context_raw,proposal_raw,composition_raw)
 values((i->>'capture_id')::uuid,prep.operation_id,p_intent,p_report,p_base,p_canonical,p_context,p_proposal,p_composition);
 receipt:=tf_pdf_review.capture_receipt((i->>'capture_id')::uuid);
 if receipt#>>'{capture,baseContentSha256}'is distinct from encode(sha256(p_base),'hex')
  or receipt#>>'{capture,baseHeadChangedAt}'is distinct from whole_context#>>'{baseline,head_changed_at}'
  or receipt#>'{capture,sourceReceipts}'is distinct from native_sources then raise exception using errcode='23514',message='invented_pdf_appended_native_mismatch';end if;
 return receipt;
end
$$;
revoke all on function tf_pdf_review.capture_issue(bytea,bytea,bytea,bytea,bytea,bytea,bytea)from public;

-- Separate work10 entrypoint; the pure seven-carrier command has no work proof.
-- Fences bracket table/head waits and the complete atomic generic+companion+
-- getter call. No assertion can authorize an arbitrarily later COMMIT.
create function tf_pdf_review.capture_issue_for_work(p_run uuid,p_fingerprint text,p_claim uuid,p_intent bytea,p_report bytea,p_base bytea,p_canonical bytea,p_context bytea,p_proposal bytea,p_composition bytea)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare i jsonb;v jsonb;head terra_private.issue_heads%rowtype;
begin
 if current_user<>session_user or session_user<>'postgres'then raise exception using errcode='42501',message='invented_pdf_appended_owner_required';end if;
 if current_setting('transaction_read_only')='on'then raise exception using errcode='25006',message='invented_pdf_appended_writer_required';end if;
 if current_setting('transaction_isolation')<>'read committed'then raise exception using errcode='25001',message='invented_pdf_appended_isolation_required';end if;
 if p_intent is null or octet_length(p_intent)not between 1 and 4096 then raise exception using errcode='22023',message='invented_pdf_appended_intent_invalid';end if;
 begin i:=convert_from(p_intent,'UTF8')::jsonb;
  if i->>'run_id'is distinct from p_run::text or jsonb_typeof(i->'issue_id')is distinct from 'string'
   or(i->>'issue_id'~'^[a-f0-9]{8}-[a-f0-9]{4}-[45][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$')is distinct from true then raise exception using errcode='22023',message='invented_pdf_appended_work_scope_invalid';end if;
 exception when others then raise exception using errcode='22023',message='invented_pdf_appended_work_scope_invalid';end;
 perform terra_private.assert_update_run_work(p_run,p_fingerprint,p_claim);
 lock table tf_pdf_review.captures in share row exclusive mode;
 perform terra_private.assert_update_run_work(p_run,p_fingerprint,p_claim);
 select * into head from terra_private.issue_heads where issue_id=(i->>'issue_id')::uuid for update;
 if not found then raise exception using errcode='23514',message='invented_pdf_appended_head_changed';end if;
 -- Replay is historical but still live-work fenced. New insertion's inner7
 -- checks the nonempty exact current baseline after this owned head wait.
 perform terra_private.assert_update_run_work(p_run,p_fingerprint,p_claim);
 v:=tf_pdf_review.capture_issue(p_intent,p_report,p_base,p_canonical,p_context,p_proposal,p_composition);
 perform terra_private.assert_update_run_work(p_run,p_fingerprint,p_claim);
 return v;
end
$$;
revoke all on function tf_pdf_review.capture_issue_for_work(uuid,text,uuid,bytea,bytea,bytea,bytea,bytea,bytea,bytea)from public;
