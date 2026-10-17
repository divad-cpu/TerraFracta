-- Fresh owned network-none laboratory only, never an operational migration.
-- Trusted producer/reobserver owns complete semantic/context validation.
-- Four exact parts retain preparation, not an actual held capture or trust.
do $$begin if current_user<>'postgres' or session_user<>'postgres' then raise exception using errcode='42501',message='invented_html_preparation_owner_required';end if;end$$;
create schema tf_html_preparation authorization postgres;
revoke all on schema tf_html_preparation from public;
create table tf_html_preparation.preparations (
 operation_id uuid primary key,artifact_id uuid not null unique default gen_random_uuid(),
 extraction_operation_id uuid not null references tf_html_extraction.results(operation_id),
 metadata bytea not null check(octet_length(metadata) between 1 and 4096),
 payload_raw bytea not null check(octet_length(payload_raw) between 1 and 16384),
 selection_raw bytea not null check(octet_length(selection_raw) between 1 and 2048),
 provenance_raw bytea not null check(octet_length(provenance_raw) between 1 and 65536),
 context_raw bytea not null check(octet_length(context_raw) between 1 and 32768),
 stored_at timestamptz not null check(isfinite(stored_at)),
 constraint detached_preparation_storage_chronology check(stored_at>=((convert_from(metadata,'UTF8')::jsonb)->>'prepared_at')::timestamptz),
 check(encode(sha256(payload_raw),'hex')=(convert_from(metadata,'UTF8')::jsonb)->>'payload_sha256'),
 check(encode(sha256(selection_raw),'hex')=(convert_from(metadata,'UTF8')::jsonb)->>'selection_sha256'),
 check(encode(sha256(provenance_raw),'hex')=(convert_from(metadata,'UTF8')::jsonb)->>'provenance_sha256'),
 check(encode(sha256(context_raw),'hex')=(convert_from(metadata,'UTF8')::jsonb)->>'context_raw_sha256')
);
alter table tf_html_preparation.preparations enable row level security;
revoke all on tf_html_preparation.preparations from public;
create function tf_html_preparation.refuse_mutation()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin raise exception using errcode='55000',message='invented_html_preparation_append_only';end
$$;
revoke all on function tf_html_preparation.refuse_mutation() from public;
create trigger detached_preparation_append_only before update or delete on tf_html_preparation.preparations
for each row execute function tf_html_preparation.refuse_mutation();

create function tf_html_preparation.preparation_receipt(p_operation uuid)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare r tf_html_preparation.preparations%rowtype;v jsonb;
begin
 if current_user<>'postgres' or session_user<>'postgres' then raise exception using errcode='42501',message='invented_html_preparation_owner_required';end if;
 select * into r from tf_html_preparation.preparations where operation_id=p_operation;
 if not found then raise exception using errcode='22023',message='invented_html_preparation_unavailable';end if;
 v:=jsonb_build_object('schema_version',1,'kind','invented_html_preparation_stored','operation_id',r.operation_id,
  'artifact_id',r.artifact_id,'stored_at',to_char(r.stored_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'metadata_base64',replace(encode(r.metadata,'base64'),E'\n',''),
  'payload_base64',replace(encode(r.payload_raw,'base64'),E'\n',''),'selection_base64',replace(encode(r.selection_raw,'base64'),E'\n',''),
  'provenance_base64',replace(encode(r.provenance_raw,'base64'),E'\n',''),'context_base64',replace(encode(r.context_raw,'base64'),E'\n',''));
 if octet_length(v::text)+29>131072 then raise exception using errcode='22023',message='invented_html_preparation_readback_limit';end if;
 return v;
end
$$;
revoke all on function tf_html_preparation.preparation_receipt(uuid) from public;

create function tf_html_preparation.store_preparation(p_metadata bytea,p_payload bytea,p_selection bytea,p_provenance bytea,p_context bytea)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare p jsonb;metadata_json json;em jsonb;keys text[];k text;operation uuid;prepared timestamptz;observed timestamptz;
 e tf_html_extraction.results%rowtype;old tf_html_preparation.preparations%rowtype;
 payload jsonb;selection jsonb;provenance jsonb;context jsonb;claim jsonb;reference jsonb;receipt jsonb;
begin
 if current_user<>'postgres' or session_user<>'postgres' then raise exception using errcode='42501',message='invented_html_preparation_owner_required';end if;
 if current_setting('transaction_isolation')<>'read committed' or current_setting('transaction_read_only')<>'off' then
  raise exception using errcode='25000',message='invented_html_preparation_write_transaction_required';end if;
 if p_metadata is null or octet_length(p_metadata) not between 1 and 4096 then
  raise exception using errcode='22023',message='invented_html_preparation_metadata_invalid';end if;
 metadata_json:=convert_from(p_metadata,'UTF8')::json;p:=metadata_json::jsonb;
 if jsonb_typeof(p) is distinct from 'object'
  or p_payload is null or octet_length(p_payload) not between 1 and 16384 or p_selection is null or octet_length(p_selection) not between 1 and 2048
  or p_provenance is null or octet_length(p_provenance) not between 1 and 65536 or p_context is null or octet_length(p_context) not between 1 and 32768 then
  raise exception using errcode='22023',message='invented_html_preparation_input_invalid';end if;
 select array_agg(key order by key) into keys from json_object_keys(metadata_json) key;
 if keys is distinct from array['context_raw_sha256','extraction_artifact_id','extraction_operation_id','extraction_output_sha256',
  'extraction_request_sha256','kind','operation_id','payload_sha256','prepared_at','provenance_sha256','schema_version','selection_sha256']
  or p->'schema_version' is distinct from '1'::jsonb or p->>'schema_version' is distinct from '1' or p->>'kind' is distinct from 'invented_detached_html_proposal_preparation' then
  raise exception using errcode='22023',message='invented_html_preparation_metadata_invalid';end if;
 foreach k in array array['context_raw_sha256','extraction_artifact_id','extraction_operation_id','extraction_output_sha256',
  'extraction_request_sha256','kind','operation_id','payload_sha256','prepared_at','provenance_sha256','selection_sha256'] loop
  if jsonb_typeof(p->k) is distinct from 'string' then raise exception using errcode='22023',message='invented_html_preparation_field_invalid';end if;
 end loop;
 foreach k in array array['operation_id','extraction_operation_id','extraction_artifact_id'] loop
  if p->>k !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then
   raise exception using errcode='22023',message='invented_html_preparation_identity_invalid';end if;
 end loop;
 if p->>'payload_sha256' is distinct from encode(sha256(p_payload),'hex') or p->>'selection_sha256' is distinct from encode(sha256(p_selection),'hex')
  or p->>'provenance_sha256' is distinct from encode(sha256(p_provenance),'hex') or p->>'context_raw_sha256' is distinct from encode(sha256(p_context),'hex')
  or p->>'extraction_request_sha256' !~ '^[a-f0-9]{64}$' or p->>'extraction_output_sha256' !~ '^[a-f0-9]{64}$'
  or p->>'prepared_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{6}Z$' then
  raise exception using errcode='22023',message='invented_html_preparation_bytes_invalid';end if;
 operation:=(p->>'operation_id')::uuid;prepared:=(p->>'prepared_at')::timestamptz;
 payload:=convert_from(p_payload,'UTF8')::jsonb;selection:=convert_from(p_selection,'UTF8')::jsonb;
 provenance:=convert_from(p_provenance,'UTF8')::jsonb;context:=convert_from(p_context,'UTF8')::jsonb;
 select * into e from tf_html_extraction.results where operation_id=(p->>'extraction_operation_id')::uuid;
 if not found then raise exception using errcode='22023',message='invented_html_preparation_extraction_mismatch';end if;
 em:=convert_from(e.metadata,'UTF8')::jsonb;
 if e.artifact_id::text is distinct from p->>'extraction_artifact_id' or em->>'request_sha256' is distinct from p->>'extraction_request_sha256'
  or em->>'output_sha256' is distinct from p->>'extraction_output_sha256' or not isfinite(prepared) or prepared>clock_timestamp() or e.stored_at>prepared then
  raise exception using errcode='22023',message='invented_html_preparation_extraction_mismatch';end if;
 if provenance->>'extraction_metadata_sha256' is distinct from encode(sha256(e.metadata),'hex')
  or provenance->'schema_version' is distinct from '1'::jsonb or provenance->>'schema_version' is distinct from '1' or provenance->>'kind' is distinct from 'detached_html_extraction_proposal'
  or provenance->>'scope' is distinct from 'invented_supplied_full_receipts_only' or provenance->>'evidence_state' is distinct from 'unverified_not_captured_no_durable_association'
  or provenance->>'snapshot_intent' is distinct from 'single_claim_technical_review_not_issue_replacement'
  or provenance->>'prepared_at' is distinct from p->>'prepared_at' or provenance->>'payload_sha256' is distinct from p->>'payload_sha256'
  or provenance->>'selection_sha256' is distinct from p->>'selection_sha256' or provenance->>'supplied_context_sha256' is distinct from p->>'context_raw_sha256'
  or provenance->'independent_context' is distinct from context
  or provenance->'artifact' is distinct from jsonb_build_object('operation_id',e.operation_id,'artifact_id',e.artifact_id,
   'request_sha256',em->>'request_sha256','output_sha256',em->>'output_sha256')
  or provenance->>'full_receipt_sha256' is distinct from encode(sha256(convert_to(tf_html_extraction.result_receipt(e.operation_id)::text,'UTF8')),'hex')
  or provenance->>'artifact_prepared_at' is distinct from em->>'prepared_at'
  or provenance->>'artifact_stored_at' is distinct from to_char(e.stored_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') then
  raise exception using errcode='22023',message='invented_html_preparation_provenance_mismatch';end if;
 observed:=(provenance->>'artifact_observed_at')::timestamptz;
 if observed is null or not isfinite(observed) or observed<e.stored_at or observed>prepared
  or context->'schema_version' is distinct from '1'::jsonb or context->>'schema_version' is distinct from '1' or context->>'kind' is distinct from 'invented_detached_extraction_context'
  or context->>'snapshot_intent' is distinct from 'single_claim_technical_review_not_issue_replacement' or context->'held'->>'disposition' is distinct from 'held'
  or context->'held'->>'source_version_id' is distinct from em->'current_original'->>'source_version_id'
  or context->'held'->>'content_sha256' is distinct from em->'current_original'->>'content_sha256'
  or jsonb_typeof(context->'held'->'decided_at') is distinct from 'string'
  or jsonb_typeof(context->'issue'->'observed_at') is distinct from 'string'
  or jsonb_typeof(context->'content'->'last_evidence_review_on') is distinct from 'string'
  or (context->'held'->>'decided_at')::timestamptz>prepared or (context->'issue'->>'observed_at')::timestamptz>prepared
  or (context->'content'->>'last_evidence_review_on')::date>(prepared at time zone 'UTC')::date then
  raise exception using errcode='22023',message='invented_html_preparation_historical_context_invalid';end if;
 if payload->'schemaVersion' is distinct from '1'::jsonb or payload->>'schemaVersion' is distinct from '1' or payload->>'kind' is distinct from 'review_only' or payload->>'conflictCoverage' is distinct from 'not_recorded'
  or jsonb_typeof(payload->'snapshot'->'claims') is distinct from 'array' or jsonb_array_length(payload->'snapshot'->'claims')<>1 then
  raise exception using errcode='22023',message='invented_html_preparation_payload_invalid';end if;
 claim:=payload->'snapshot'->'claims'->0;
 if jsonb_typeof(claim->'evidence') is distinct from 'array' or jsonb_array_length(claim->'evidence')<>1 then
  raise exception using errcode='22023',message='invented_html_preparation_evidence_invalid';end if;
 reference:=claim->'evidence'->0;
 foreach k in array array['id','assertion','type'] loop
  if jsonb_typeof(claim->k) is distinct from 'string' then raise exception using errcode='22023',message='invented_html_preparation_claim_field_invalid';end if;
 end loop;
 foreach k in array array['sourceVersionId','locator','relation'] loop
  if jsonb_typeof(reference->k) is distinct from 'string' then raise exception using errcode='22023',message='invented_html_preparation_reference_field_invalid';end if;
 end loop;
 foreach k in array array['captureId','runId','decisionId','issueId'] loop
  if jsonb_typeof(selection->k) is distinct from 'string' or selection->>k !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then
   raise exception using errcode='22023',message='invented_html_preparation_selection_invalid';end if;
 end loop;
 if claim->>'id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
  or jsonb_typeof(provenance->'claim_id') is distinct from 'string' or jsonb_typeof(context->'content'->'claim_id') is distinct from 'string'
  or not (selection ? 'basePublicationId') or jsonb_typeof(context->'issue'->'head') is distinct from 'object'
  or not ((context->'issue'->'head') ? 'publication_id')
  or (jsonb_typeof(selection->'basePublicationId') is distinct from 'null' and
   (jsonb_typeof(selection->'basePublicationId') is distinct from 'string' or selection->>'basePublicationId' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$')) then
  raise exception using errcode='22023',message='invented_html_preparation_identity_invalid';end if;
 if claim->>'id' is distinct from provenance->>'claim_id' or claim->>'id' is distinct from context->'content'->>'claim_id'
  or claim->>'assertion' is distinct from em->'proposal'->>'proposed_assertion' or claim->>'type' is distinct from em->'proposal'->>'proposed_claim_type'
  or reference->>'sourceVersionId' is distinct from em->'proposal'->>'source_version_id' or reference->>'locator' is distinct from em->'proposal'->>'locator'
  or reference->>'relation' is distinct from 'supports' or context->'support'->>'assignment_state' is distinct from 'proposed_only' or context->'support'->>'relation' is distinct from 'supports'
  or selection->>'captureId' is distinct from context->'content'->>'capture_id' or selection->>'runId' is distinct from context->'held'->>'run_id'
  or selection->>'decisionId' is distinct from context->'held'->>'decision_id' or selection->>'issueId' is distinct from context->'issue'->>'issue_id'
  or selection->'basePublicationId' is distinct from context->'issue'->'head'->'publication_id' then
  raise exception using errcode='22023',message='invented_html_preparation_crosslink_invalid';end if;
 lock table tf_html_preparation.preparations in share row exclusive mode;
 select * into old from tf_html_preparation.preparations where operation_id=operation;
 if found then
  if old.metadata is distinct from p_metadata or old.payload_raw is distinct from p_payload or old.selection_raw is distinct from p_selection
   or old.provenance_raw is distinct from p_provenance or old.context_raw is distinct from p_context then
   raise exception using errcode='22023',message='invented_html_preparation_operation_conflict';end if;
  return tf_html_preparation.preparation_receipt(operation);
 end if;
 if (select count(*) from tf_html_preparation.preparations)>=50 then raise exception using errcode='22023',message='invented_html_preparation_lab_quota';end if;
 insert into tf_html_preparation.preparations(operation_id,extraction_operation_id,metadata,payload_raw,selection_raw,provenance_raw,context_raw,stored_at)
 values(operation,e.operation_id,p_metadata,p_payload,p_selection,p_provenance,p_context,clock_timestamp());
 receipt:=tf_html_preparation.preparation_receipt(operation);return receipt;
exception when insufficient_privilege then raise;
 when others then raise exception using errcode='22023',message='invented_html_preparation_unavailable';
end
$$;
revoke all on function tf_html_preparation.store_preparation(bytea,bytea,bytea,bytea,bytea) from public;
