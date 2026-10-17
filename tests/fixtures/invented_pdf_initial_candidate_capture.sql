-- UNINSTALLED invented owner-only PDF initial SINGLE candidate custody.
-- Reuses existing PDF preparation/result bytes and generic capture/work
-- fences. No policy/source approval, publication, default target or runtime grant.
-- Trusted Python cold reopening and strict TS own full semantic validation; exact
-- stored preparation/source/work/head bindings are checked again here.
-- UNINSTALLED: requires separate source review and a fresh owned native trial.
create schema tf_pdf_initial_candidate authorization postgres;
revoke all on schema tf_pdf_initial_candidate from public;
create table tf_pdf_initial_candidate.captures (
 capture_id uuid primary key references terra_private.proposal_captures(id),
 preparation_operation_id uuid not null unique references tf_pdf_result_rehearsal.preparations(operation_id),
 intent_raw bytea not null check(octet_length(intent_raw) between 1 and 4096),
 report_raw bytea not null check(octet_length(report_raw) between 2 and 262144),
 stored_at timestamptz not null default clock_timestamp() check(isfinite(stored_at)),
 check(encode(sha256(report_raw),'hex')=convert_from(intent_raw,'UTF8')::jsonb->>'report_sha256')
);
alter table tf_pdf_initial_candidate.captures enable row level security;
revoke all on tf_pdf_initial_candidate.captures from public;
create function tf_pdf_initial_candidate.refuse_mutation()returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin raise exception using errcode='55000',message='invented_pdf_initial_candidate_append_only';end
$$;
revoke all on function tf_pdf_initial_candidate.refuse_mutation()from public;
create trigger initial_candidate_append_only before update or delete on tf_pdf_initial_candidate.captures for each row execute function tf_pdf_initial_candidate.refuse_mutation();
create trigger initial_candidate_no_truncate before truncate on tf_pdf_initial_candidate.captures for each statement execute function tf_pdf_initial_candidate.refuse_mutation();

create function tf_pdf_initial_candidate.capture_receipt(p_capture uuid)returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare r tf_pdf_initial_candidate.captures%rowtype;c terra_private.proposal_captures%rowtype;i jsonb;v jsonb;native_prep jsonb;
begin
 if current_user<>session_user or session_user<>'postgres' then raise exception using errcode='42501',message='invented_pdf_initial_candidate_owner_required';end if;
 select * into r from tf_pdf_initial_candidate.captures where capture_id=p_capture;
 if not found then raise exception using errcode='22023',message='invented_pdf_initial_candidate_unavailable';end if;
 select * into c from terra_private.proposal_captures where id=r.capture_id;
 i:=convert_from(r.intent_raw,'UTF8')::jsonb;
 if not found or c.base_publication_id is not null or c.base_head_changed_at is not null or c.base_content_sha256 is not null
  or c.id::text is distinct from i->>'capture_id' or c.decision_id::text is distinct from i->>'decision_id' or c.issue_id::text is distinct from i->>'issue_id'
  or not isfinite(c.captured_at) or not isfinite(r.stored_at)
  or c.captured_at<(i->>'preparation_observed_at')::timestamptz or c.captured_at>r.stored_at or r.stored_at>clock_timestamp() or r.stored_at>='10000-01-01Z'::timestamptz then
  raise exception using errcode='23514',message='invented_pdf_initial_candidate_dependency_invalid';end if;
 native_prep:=tf_pdf_result_rehearsal.preparation_receipt(r.preparation_operation_id);
 if encode(sha256(convert_to(native_prep::text,'UTF8')),'hex') is distinct from i->>'preparation_full_receipt_sha256'
  or encode(sha256(r.report_raw),'hex') is distinct from i->>'report_sha256' then raise exception using errcode='23514',message='invented_pdf_initial_candidate_dependency_invalid';end if;
 v:=jsonb_build_object('schema_version',1,'kind','invented_pdf_initial_candidate_capture_stored','capture_id',r.capture_id,'preparation_operation_id',r.preparation_operation_id,
  'stored_at',to_char(r.stored_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'intent_base64',replace(encode(r.intent_raw,'base64'),E'\n',''),'report_base64',replace(encode(r.report_raw,'base64'),E'\n',''),
  'capture',jsonb_build_object('captureId',c.id,'runId',i->>'run_id','decisionId',c.decision_id,'issueId',c.issue_id,'basePublicationId',null,'baseHeadChangedAt',null,'baseContentSha256',null,'proposalSha256',c.proposal_sha256,
  'capturedAt',to_char(c.captured_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'sourceReceipts',c.source_receipts));
 if octet_length(v::text)+29>131072 then raise exception using errcode='22023',message='invented_pdf_initial_candidate_readback_limit';end if;
 return v;
end
$$;
revoke all on function tf_pdf_initial_candidate.capture_receipt(uuid)from public;

create function tf_pdf_initial_candidate.capture_for_work(p_run uuid,p_fingerprint text,p_claim uuid,p_intent bytea,p_report bytea)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare i jsonb;r jsonb;intent_json json;report_json json;s jsonb;context jsonb;payload jsonb;proof jsonb;
 native_prep jsonb;native_result jsonb;receipt jsonb;generic jsonb;keys text[];key text;index integer;part bytea;
 canonical_intent text;metadata jsonb;frame jsonb;result_frame jsonb;result_intent jsonb;current_frame jsonb;derivation jsonb;original_doc jsonb;
 current_raw bytea;derivation_raw bytea;original_raw bytea;parts bytea[]:=array[]::bytea[];part_keys text[]:=array['payload','selection','provenance','context'];
 prep tf_pdf_result_rehearsal.preparations%rowtype;source_result tf_pdf_result_rehearsal.results%rowtype;
 old tf_pdf_initial_candidate.captures%rowtype;decision record;target record;head terra_private.issue_heads%rowtype;
begin
 if current_user<>session_user or session_user<>'postgres' then raise exception using errcode='42501',message='invented_pdf_initial_candidate_owner_required';end if;
 if current_setting('transaction_read_only')='on' then raise exception using errcode='25006',message='invented_pdf_initial_candidate_writer_required';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception using errcode='25001',message='invented_pdf_initial_candidate_isolation_required';end if;
 if p_intent is null or octet_length(p_intent)not between 1 and 4096 or p_report is null or octet_length(p_report)not between 2 and 262144 then
  raise exception using errcode='22023',message='invented_pdf_initial_candidate_parts_invalid';end if;
 intent_json:=convert_from(p_intent,'UTF8')::json;report_json:=convert_from(p_report,'UTF8')::json;
 i:=intent_json::jsonb;r:=report_json::jsonb;
 if jsonb_typeof(i)is distinct from 'object' or jsonb_typeof(r)is distinct from 'object' then raise exception using errcode='22023',message='invented_pdf_initial_candidate_shape_invalid';end if;
 select array_agg(k order by k)into keys from json_object_keys(intent_json)k;
 if keys is distinct from array['base_publication_id','capture_id','decision_id','issue_id','kind','part_sha256','preparation_artifact_id','preparation_full_receipt_sha256','preparation_intent_sha256','preparation_observed_at','preparation_operation_id','report_sha256','run_id','schema_version','snapshot_intent']
  or i->'schema_version'is distinct from '1'::jsonb or i->>'schema_version'is distinct from '1' or i->>'kind'is distinct from 'invented_pdf_initial_candidate_capture'
  or i->>'snapshot_intent'is distinct from 'single_claim_technical_review_not_issue_replacement' or i->'base_publication_id'is distinct from 'null'::jsonb
  or i->>'run_id'is distinct from p_run::text then raise exception using errcode='22023',message='invented_pdf_initial_candidate_intent_invalid';end if;
 foreach key in array array['capture_id','run_id','decision_id','issue_id','preparation_operation_id','preparation_artifact_id']loop
  if jsonb_typeof(i->key)is distinct from 'string' or (i->>key~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')is distinct from true then raise exception using errcode='22023',message='invented_pdf_initial_candidate_identity_invalid';end if;
 end loop;
 foreach key in array array['capture_id','run_id','decision_id','issue_id']loop
  if (i->>key~'^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')is distinct from true then raise exception using errcode='22023',message='invented_pdf_initial_candidate_capture_identity_invalid';end if;
 end loop;
 foreach key in array array['report_sha256','preparation_intent_sha256','preparation_full_receipt_sha256']loop
  if jsonb_typeof(i->key)is distinct from 'string' or (i->>key~'^[0-9a-f]{64}$')is distinct from true then raise exception using errcode='22023',message='invented_pdf_initial_candidate_digest_invalid';end if;
 end loop;
 if i->>'report_sha256'is distinct from encode(sha256(p_report),'hex')or jsonb_typeof(i->'part_sha256')is distinct from 'array' or jsonb_array_length(i->'part_sha256')<>4
  or jsonb_typeof(i->'preparation_observed_at')is distinct from 'string' or (i->>'preparation_observed_at'~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{6}Z$')is distinct from true
  or not isfinite((i->>'preparation_observed_at')::timestamptz)
  or (i->>'preparation_observed_at')::timestamptz<'0001-01-01Z'::timestamptz
  or (i->>'preparation_observed_at')::timestamptz>statement_timestamp()
  or to_char((i->>'preparation_observed_at')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')is distinct from i->>'preparation_observed_at'then raise exception using errcode='22023',message='invented_pdf_initial_candidate_observation_invalid';end if;
 for index in 0..3 loop
  if jsonb_typeof(i->'part_sha256'->index)is distinct from 'string'
   or (i->'part_sha256'->>index~'^[a-f0-9]{64}$')is distinct from true then
   raise exception using errcode='22023',message='invented_pdf_initial_candidate_digest_invalid';end if;
 end loop;
 -- Closed intent values contain only ASCII tokens after the guards above.
 -- Sort keys lexically like the existing producer, and remove structural JSON
 -- spaces only from this fixed token-only dialect. No source text is rewritten.
 select '{'||string_agg(to_jsonb(k)::text||':'||regexp_replace(v::text,'[[:space:]]','','g'),','order by k collate "C")||'}'
 into canonical_intent from jsonb_each(i)as entry(k,v);
 if convert_from(p_intent,'UTF8')is distinct from canonical_intent then
  raise exception using errcode='22023',message='invented_pdf_initial_candidate_canonical_intent_invalid';end if;
 select array_agg(k order by k)into keys from json_object_keys(report_json)k;
 if keys is distinct from array['intent_json','kind','limits','observed_at','parts','preparation','review_state','schema_version','scope']
  or r->'schema_version'is distinct from '1'::jsonb or report_json->>'schema_version'is distinct from '1'
  or r->>'kind'is distinct from 'private_stored_pdf_preparation_review_report'
  or r->>'scope'is distinct from 'invented_supplied_pdf_custody_only' or r->>'review_state'is distinct from 'unverified'
  or jsonb_typeof(r->'preparation')is distinct from 'object' or jsonb_typeof(r->'parts')is distinct from 'object'
  or jsonb_typeof(r->'limits')is distinct from 'object' then
  raise exception using errcode='22023',message='invented_pdf_initial_candidate_report_shape_invalid';end if;
 select array_agg(k order by k)into keys from json_object_keys(report_json->'preparation')k;
 if keys is distinct from array['artifact_id','intent_sha256','operation_id','packet_sha256','prepared_at','receipt_sha256','result_operation_id','stored_at'] then
  raise exception using errcode='22023',message='invented_pdf_initial_candidate_report_shape_invalid';end if;
 select array_agg(k order by k)into keys from json_object_keys(report_json->'parts')k;
 if keys is distinct from array['context_json','payload_json','provenance_json','selection_json'] then
  raise exception using errcode='22023',message='invented_pdf_initial_candidate_report_shape_invalid';end if;
 select array_agg(k order by k)into keys from json_object_keys(report_json->'limits')k;
 if keys is distinct from array['current_publication_observed','current_qualification_established','full_preparation_receipt_included','full_result_receipt_included','held_capture_observed','original_pdf_included','output_body_included','publication_authorized','request_body_included','source_authenticated']
  or r->'limits'is distinct from jsonb_build_object('original_pdf_included',false,'request_body_included',false,'output_body_included',false,
   'full_result_receipt_included',false,'full_preparation_receipt_included',false,'source_authenticated',false,
   'current_qualification_established',false,'held_capture_observed',false,'current_publication_observed',false,'publication_authorized',false)then
  raise exception using errcode='22023',message='invented_pdf_initial_candidate_report_limits_invalid';end if;
 perform terra_private.assert_update_run_work(p_run,p_fingerprint,p_claim);
 lock table tf_pdf_initial_candidate.captures in share row exclusive mode;
 perform terra_private.assert_update_run_work(p_run,p_fingerprint,p_claim);
 select * into old from tf_pdf_initial_candidate.captures where capture_id=(i->>'capture_id')::uuid;
 if found then
  if old.intent_raw is distinct from p_intent or old.report_raw is distinct from p_report then raise exception using errcode='23505',message='invented_pdf_initial_candidate_replay_conflict';end if;
  receipt:=tf_pdf_initial_candidate.capture_receipt(old.capture_id);
  perform terra_private.assert_update_run_work(p_run,p_fingerprint,p_claim);return receipt;
 end if;
 if(select count(*)from tf_pdf_initial_candidate.captures)>=50 then raise exception using errcode='22023',message='invented_pdf_initial_candidate_lab_quota';end if;
 if exists(select 1 from terra_private.proposal_captures where id=(i->>'capture_id')::uuid or decision_id=(i->>'decision_id')::uuid)
  or exists(select 1 from tf_pdf_initial_candidate.captures where preparation_operation_id=(i->>'preparation_operation_id')::uuid)then
  raise exception using errcode='23505',message='invented_pdf_initial_candidate_standalone_or_preparation_conflict';end if;
 select * into prep from tf_pdf_result_rehearsal.preparations where operation_id=(i->>'preparation_operation_id')::uuid;
 if not found or prep.artifact_id::text is distinct from i->>'preparation_artifact_id'
  or r#>>'{preparation,operation_id}'is distinct from prep.operation_id::text or r#>>'{preparation,artifact_id}'is distinct from prep.artifact_id::text
  or r#>>'{preparation,result_operation_id}'is distinct from prep.result_operation_id::text
  or r#>>'{preparation,stored_at}'is distinct from to_char(prep.stored_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  or prep.stored_at>(i->>'preparation_observed_at')::timestamptz or r->>'observed_at'is distinct from i->>'preparation_observed_at'
  or jsonb_typeof(r->'intent_json')is distinct from 'string' or convert_to(r->>'intent_json','UTF8')is distinct from prep.intent
  or encode(sha256(prep.intent),'hex')is distinct from i->>'preparation_intent_sha256'
  or r#>>'{preparation,intent_sha256}'is distinct from encode(sha256(prep.intent),'hex')
  or r#>>'{preparation,packet_sha256}'is distinct from encode(sha256(prep.packet),'hex')then
  raise exception using errcode='22023',message='invented_pdf_initial_candidate_preparation_invalid';end if;
 metadata:=convert_from(prep.intent,'UTF8')::jsonb;frame:=convert_from(prep.packet,'UTF8')::jsonb;
 if metadata->>'kind'is distinct from 'invented_detached_pdf_proposal_preparation'
  or frame->>'kind'is distinct from 'invented_portable_pdf_preparation'
  or decode(frame->>'intent_base64','base64')is distinct from prep.intent
  or r#>>'{preparation,prepared_at}'is distinct from metadata->>'prepared_at'then
  raise exception using errcode='22023',message='invented_pdf_initial_candidate_metadata_invalid';end if;
 for index in 1..4 loop
  key:=part_keys[index];part:=decode(frame->>(key||'_base64'),'base64');
  if part is null or octet_length(part)not between 1 and (case index when 1 then 16384 when 2 then 2048 when 3 then 65536 else 32768 end)
   or replace(encode(part,'base64'),E'\n','')is distinct from frame->>(key||'_base64')
   or jsonb_typeof(r->'parts'->(key||'_json'))is distinct from 'string'
   or convert_to(r->'parts'->>(key||'_json'),'UTF8')is distinct from part
   or i->'part_sha256'->>(index-1)is distinct from encode(sha256(part),'hex')
   or metadata->>(case index when 4 then 'context_raw_sha256' else key||'_sha256' end)is distinct from encode(sha256(part),'hex')then
   raise exception using errcode='22023',message='invented_pdf_initial_candidate_part_invalid';end if;
  parts:=array_append(parts,part);
 end loop;
 payload:=convert_from(parts[1],'UTF8')::jsonb;s:=convert_from(parts[2],'UTF8')::jsonb;
 proof:=convert_from(parts[3],'UTF8')::jsonb;context:=convert_from(parts[4],'UTF8')::jsonb;
 if proof->>'kind'is distinct from 'detached_pdf_extraction_proposal'
  or proof->>'prepared_at'is distinct from metadata->>'prepared_at' or proof->>'artifact_observed_at'is distinct from metadata->>'prepared_at'
  or context is distinct from proof->'independent_context'
  or s is distinct from jsonb_build_object('captureId',i->>'capture_id','runId',i->>'run_id','decisionId',i->>'decision_id','issueId',i->>'issue_id','basePublicationId',null)
  or context#>'{issue,head}'is distinct from jsonb_build_object('publication_id',null,'content_sha256',null,'changed_at',null)
  or context->>'snapshot_intent'is distinct from 'single_claim_technical_review_not_issue_replacement'
  or payload->>'kind'is distinct from 'review_only' or payload->>'conflictCoverage'is distinct from 'not_recorded'
  or (payload#>>'{translation,status}'in('unreviewed','not_recorded'))is distinct from true
  or jsonb_typeof(payload#>'{snapshot,claims}')is distinct from 'array' or jsonb_array_length(payload#>'{snapshot,claims}')<>1
  or jsonb_typeof(payload#>'{snapshot,claims,0,evidence}')is distinct from 'array' or jsonb_array_length(payload#>'{snapshot,claims,0,evidence}')<>1
  or jsonb_typeof(payload#>'{dependencyManifest,sourceVersionIds}')is distinct from 'array' or jsonb_array_length(payload#>'{dependencyManifest,sourceVersionIds}')<>1 then
  raise exception using errcode='23514',message='invented_pdf_initial_candidate_initial_intent_invalid';end if;
 native_prep:=tf_pdf_result_rehearsal.preparation_receipt(prep.operation_id);
 if encode(sha256(convert_to(native_prep::text,'UTF8')),'hex')is distinct from i->>'preparation_full_receipt_sha256'
  or r#>>'{preparation,receipt_sha256}'is distinct from i->>'preparation_full_receipt_sha256'then
  raise exception using errcode='22023',message='invented_pdf_initial_candidate_receipt_invalid';end if;
 select * into source_result from tf_pdf_result_rehearsal.results where operation_id=prep.result_operation_id;
 if not found then raise exception using errcode='23503',message='invented_pdf_initial_candidate_result_missing';end if;
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
  raise exception using errcode='23514',message='invented_pdf_initial_candidate_result_invalid';end if;
 if (result_intent->'previous_packet_sha256'='null'::jsonb and proof->'previous'is distinct from 'null'::jsonb)
  or (result_intent->'previous_packet_sha256'<>'null'::jsonb and proof#>>'{previous,packet_sha256}'is distinct from result_intent->>'previous_packet_sha256')then
  raise exception using errcode='23514',message='invented_pdf_initial_candidate_result_invalid';end if;
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
  raise exception using errcode='23514',message='invented_pdf_initial_candidate_original_invalid';end if;
 derivation:=convert_from(derivation_raw,'UTF8')::jsonb;original_doc:=derivation->'document';
 if original_doc->>'content_sha256'is distinct from encode(sha256(original_raw),'hex')
  or proof#>>'{current,mapping_sha256}'is distinct from derivation->>'mapping_sha256'
  or proof#>>'{current,language_code}'is distinct from derivation->>'language_code'then
  raise exception using errcode='23514',message='invented_pdf_initial_candidate_original_invalid';end if;
 select md.*,r.jurisdiction_id,sv.item_key,sv.source_url,sv.language_code,sv.retrieved_at,sv.content_sha256 as original_hash,sr.source_key into decision
 from terra_private.machine_candidate_decisions md join terra_private.update_runs r on r.id=md.run_id
 join terra_private.source_versions sv on sv.id=md.source_version_id join terra_private.source_registrations sr on sr.id=sv.registration_id
 where md.id=(i->>'decision_id')::uuid and r.id=p_run;
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
  raise exception using errcode='23514',message='invented_pdf_initial_candidate_held_binding_invalid';end if;
 select d.*,j.public_slug as jurisdiction_slug into target from terra_private.issue_dossiers d join terra_private.jurisdictions j on j.id=d.jurisdiction_id where d.id=(i->>'issue_id')::uuid;
 if not found or target.jurisdiction_id is distinct from decision.jurisdiction_id or context#>>'{issue,issue_id}'is distinct from target.id::text
  or context#>>'{issue,jurisdiction_id}'is distinct from target.jurisdiction_id or context#>>'{issue,jurisdiction_slug}'is distinct from target.jurisdiction_slug
  or context#>>'{issue,issue_slug}'is distinct from target.public_slug or context#>>'{issue,created_at}'is distinct from to_char(target.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')then
  raise exception using errcode='23514',message='invented_pdf_initial_candidate_issue_binding_invalid';end if;
 select * into head from terra_private.issue_heads where issue_id=target.id for update;
 if not found or head.current_publication_id is not null or head.changed_at is not null then
  raise exception using errcode='23514',message='invented_pdf_initial_candidate_head_changed';end if;
 perform terra_private.assert_update_run_work(p_run,p_fingerprint,p_claim);
 -- Complete conservative envelope BEFORE generic or companion INSERT. Actual
 -- getter size is also checked below before this atomic statement can commit.
 receipt:=jsonb_build_object('schema_version',1,'kind','invented_pdf_initial_candidate_capture_stored','capture_id',i->>'capture_id','preparation_operation_id',prep.operation_id,
  'stored_at','9999-12-31T23:59:59.999999Z','intent_base64',replace(encode(p_intent,'base64'),E'\n',''),'report_base64',replace(encode(p_report,'base64'),E'\n',''),
  'capture',jsonb_build_object('captureId',i->>'capture_id','runId',p_run,'decisionId',decision.id,'issueId',target.id,'basePublicationId',null,'baseHeadChangedAt',null,'baseContentSha256',null,
  'proposalSha256',encode(sha256(parts[1]),'hex'),'capturedAt','9999-12-31T23:59:59.999999Z','sourceReceipts',jsonb_build_array(jsonb_build_object('sourceVersionId',decision.source_version_id,'contentSha256',decision.original_hash,
   'retrievedAt',to_char(decision.retrieved_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'languageCode',decision.language_code))));
 if octet_length(receipt::text)+4096>131072 then raise exception using errcode='22023',message='invented_pdf_initial_candidate_readback_limit';end if;
 generic:=terra_private.capture_held_proposal((i->>'capture_id')::uuid,p_run,(i->>'decision_id')::uuid,target.id,null,convert_from(parts[1],'UTF8'));
 perform terra_private.assert_update_run_work(p_run,p_fingerprint,p_claim);
 if generic->>'status'is distinct from 'stored'then raise exception using errcode='23505',message='invented_pdf_initial_candidate_concurrent_standalone';end if;
 insert into tf_pdf_initial_candidate.captures(capture_id,preparation_operation_id,intent_raw,report_raw)values((i->>'capture_id')::uuid,prep.operation_id,p_intent,p_report);
 receipt:=tf_pdf_initial_candidate.capture_receipt((i->>'capture_id')::uuid);
 perform terra_private.assert_update_run_work(p_run,p_fingerprint,p_claim);
 return receipt;
end
$$;
revoke all on function tf_pdf_initial_candidate.capture_for_work(uuid,text,uuid,bytea,bytea)from public;
