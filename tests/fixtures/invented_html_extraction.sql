-- Separate new owned laboratory only. No primary migration, grant or provider.
-- Byte custody and original associations only. Python rederives full semantics.
do $$begin if current_user<>'postgres' or session_user<>'postgres' then raise exception using errcode='42501',message='invented_html_extraction_owner_required';end if;end$$;
create schema tf_html_extraction authorization postgres;
revoke all on schema tf_html_extraction from public;
create table tf_html_extraction.results (
 operation_id uuid primary key,
 artifact_id uuid not null unique default gen_random_uuid(),
 current_operation_id uuid not null references tf_html_rehearsal.originals(operation_id),
 previous_operation_id uuid not null references tf_html_rehearsal.originals(operation_id),
 metadata bytea not null check(octet_length(metadata) between 1 and 16384),
 request_raw bytea not null check(octet_length(request_raw) between 1 and 131072),
 output_raw bytea not null check(octet_length(output_raw) between 1 and 8192),
 stored_at timestamptz not null check(isfinite(stored_at)),
 check(current_operation_id<>previous_operation_id)
);
alter table tf_html_extraction.results enable row level security;
revoke all on tf_html_extraction.results from public;
create function tf_html_extraction.refuse_mutation() returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin raise exception using errcode='55000',message='invented_html_extraction_append_only';end$$;
create trigger html_extraction_append_only before update or delete on tf_html_extraction.results for each row execute function tf_html_extraction.refuse_mutation();

-- VOLATILE obtains a fresh query snapshot after store_result's INSERT. The
-- getter itself is SELECT-only; its external wrapper is repeatable-read/read-only.
create function tf_html_extraction.result_receipt(p_operation uuid) returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare r tf_html_extraction.results%rowtype;v jsonb;
begin
 if current_user<>'postgres' or session_user<>'postgres' then raise exception using errcode='42501',message='invented_html_extraction_owner_required';end if;
 select * into r from tf_html_extraction.results where operation_id=p_operation;
 if not found then raise exception using errcode='22023',message='invented_html_extraction_unavailable';end if;
 v:=jsonb_build_object('schema_version',1,'kind','invented_html_extraction_stored','operation_id',r.operation_id,'artifact_id',r.artifact_id,
  'stored_at',to_char(r.stored_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'metadata_base64',replace(encode(r.metadata,'base64'),E'\n',''),'request_base64',replace(encode(r.request_raw,'base64'),E'\n',''),'output_base64',replace(encode(r.output_raw,'base64'),E'\n',''),
  'metadata_sha256',encode(sha256(r.metadata),'hex'),'request_sha256',encode(sha256(r.request_raw),'hex'),'output_sha256',encode(sha256(r.output_raw),'hex'),
  'metadata_bytes',octet_length(r.metadata),'request_bytes',octet_length(r.request_raw),'output_bytes',octet_length(r.output_raw));
 if octet_length(v::text)+29>131072 then raise exception using errcode='22023',message='invented_html_extraction_receipt_limit';end if;
 return v;
end$$;

create function tf_html_extraction.store_result(p_metadata bytea,p_request bytea,p_output bytea) returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare j_original json;j jsonb;request_json jsonb;output_original json;output_json jsonb;keys text[];field_name text;original_key text;
 operation uuid;current_operation uuid;previous_operation uuid;prepared timestamptz;old tf_html_extraction.results%rowtype;
 doc tf_html_rehearsal.originals%rowtype;current_doc tf_html_rehearsal.originals%rowtype;ref jsonb;expected_ref jsonb;original_metadata jsonb;
begin
 if current_user<>'postgres' or session_user<>'postgres' then raise exception using errcode='42501',message='invented_html_extraction_owner_required';end if;
 if current_setting('transaction_isolation')<>'read committed' or current_setting('transaction_read_only')<>'off' then
  raise exception using errcode='25000',message='invented_html_extraction_write_transaction_required';end if;
 if p_metadata is null or p_request is null or p_output is null or octet_length(p_metadata) not between 1 and 16384
  or octet_length(p_request) not between 1 and 131072 or octet_length(p_output) not between 1 and 8192 then
  raise exception using errcode='22023',message='invented_html_extraction_input_invalid';end if;
 j_original:=convert_from(p_metadata,'UTF8')::json;j:=j_original::jsonb;
 if jsonb_typeof(j) is distinct from 'object' then raise exception using errcode='22023',message='invented_html_extraction_input_invalid';end if;
 select array_agg(key order by key) into keys from json_object_keys(j_original) key;
 if keys is distinct from array['current_original','kind','maximum_output_tokens','operation_id','output_sha256','prepared_at','previous_original','proposal','request_sha256','schema_version','selected_payload_sha256']
  or j->'schema_version' is distinct from '1'::jsonb or j->>'kind' is distinct from 'invented_html_private_extraction_intent'
  or jsonb_typeof(j->'maximum_output_tokens') is distinct from 'number' or j->>'maximum_output_tokens' !~ '^[1-9][0-9]{0,6}$'
  or (j->>'maximum_output_tokens')::integer>1000000 then
  raise exception using errcode='22023',message='invented_html_extraction_input_invalid';end if;
 foreach field_name in array array['operation_id','prepared_at','output_sha256','request_sha256','selected_payload_sha256'] loop
  if jsonb_typeof(j->field_name) is distinct from 'string' then raise exception using errcode='22023',message='invented_html_extraction_input_invalid';end if;
 end loop;
 if j->>'operation_id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
  or j->>'prepared_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{6}Z$'
  or j->>'request_sha256' is distinct from encode(sha256(p_request),'hex')
  or j->>'output_sha256' is distinct from encode(sha256(p_output),'hex')
  or j->>'selected_payload_sha256' !~ '^[a-f0-9]{64}$' then
  raise exception using errcode='22023',message='invented_html_extraction_identity_invalid';end if;
 operation:=(j->>'operation_id')::uuid;prepared:=(j->>'prepared_at')::timestamptz;
 if not isfinite(prepared) or prepared>clock_timestamp() then raise exception using errcode='22023',message='invented_html_extraction_chronology_invalid';end if;
 foreach original_key in array array['current_original','previous_original'] loop
  ref:=j->original_key;
  if jsonb_typeof(ref) is distinct from 'object' then raise exception using errcode='22023',message='invented_html_extraction_original_invalid';end if;
  select array_agg(key order by key) into keys from json_object_keys(j_original->original_key) key;
  if keys is distinct from array['artifact_id','content_sha256','derivation_manifest_sha256','metadata_sha256','operation_id','source_version_id','stored_at']
   or exists(select 1 from jsonb_each(ref) e where jsonb_typeof(e.value)<>'string')
   or ref->>'operation_id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then
   raise exception using errcode='22023',message='invented_html_extraction_original_invalid';end if;
  select * into doc from tf_html_rehearsal.originals where operation_id=(ref->>'operation_id')::uuid;
  if not found or doc.stored_at>prepared then raise exception using errcode='22023',message='invented_html_extraction_original_unavailable';end if;
  original_metadata:=convert_from(doc.metadata,'UTF8')::jsonb;
  expected_ref:=jsonb_build_object('operation_id',doc.operation_id,'artifact_id',doc.artifact_id,
   'stored_at',to_char(doc.stored_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'source_version_id',original_metadata->'document'->>'source_version_id','content_sha256',encode(sha256(doc.raw),'hex'),
   'metadata_sha256',encode(sha256(doc.metadata),'hex'),'derivation_manifest_sha256',original_metadata->>'derivation_manifest_sha256');
  if ref is distinct from expected_ref then raise exception using errcode='22023',message='invented_html_extraction_original_binding_mismatch';end if;
  if original_key='current_original' then current_operation:=doc.operation_id;current_doc:=doc;else previous_operation:=doc.operation_id;end if;
 end loop;
 if current_operation=previous_operation then raise exception using errcode='22023',message='invented_html_extraction_distinct_originals_required';end if;
 request_json:=convert_from(p_request,'UTF8')::jsonb;output_original:=convert_from(p_output,'UTF8')::json;output_json:=output_original::jsonb;
 if jsonb_typeof(request_json) is distinct from 'object' or jsonb_typeof(output_json) is distinct from 'object' then
  raise exception using errcode='22023',message='invented_html_extraction_body_invalid';end if;
 select array_agg(key order by key) into keys from json_object_keys(output_original) key;
 if keys is distinct from array['language_code','locator','proposed_assertion','proposed_claim_type','schema_version','source_date_text','source_sha256','source_version_id']
  or output_json->'schema_version' is distinct from '1'::jsonb
  or j->'proposal' is distinct from ((output_json-'schema_version')||jsonb_build_object('review_state','unverified'))
  or request_json->>'kind' is distinct from 'private_offline_html_extraction_request'
  or request_json->>'template_id' is distinct from 'tf-private-html-passage-extraction-1'
  or request_json->'maximum_output_tokens' is distinct from j->'maximum_output_tokens'
  or request_json->'maximum_output_bytes' is distinct from '8192'::jsonb
  or request_json->>'selected_payload_sha256' is distinct from j->>'selected_payload_sha256'
  or request_json->'selected_payload'->>'source_version_id' is distinct from j->'current_original'->>'source_version_id'
  or request_json->'selected_payload'->>'content_sha256' is distinct from j->'current_original'->>'content_sha256'
  or request_json->'html_provenance'->>'current_derivation_sha256' is distinct from j->'current_original'->>'derivation_manifest_sha256'
  or request_json->'html_provenance'->>'previous_derivation_sha256' is distinct from j->'previous_original'->>'derivation_manifest_sha256'
  or request_json->'html_provenance'->'rendered_visibility_verified' is distinct from 'false'::jsonb
  or output_json->>'source_version_id' is distinct from j->'current_original'->>'source_version_id'
  or output_json->>'source_sha256' is distinct from j->'current_original'->>'content_sha256' then
  raise exception using errcode='22023',message='invented_html_extraction_request_output_binding_mismatch';end if;
 original_metadata:=convert_from(current_doc.metadata,'UTF8')::jsonb;
 if output_json->>'language_code' is distinct from original_metadata->'mapping'->>'language_code'
  or not exists(select 1 from jsonb_array_elements(request_json->'selected_payload'->'passages') as p(value),
   jsonb_array_elements_text(p.value->'locators') as l(value) where l.value=output_json->>'locator') then
  raise exception using errcode='22023',message='invented_html_extraction_locator_binding_mismatch';end if;
 lock table tf_html_extraction.results in share row exclusive mode;
 select * into old from tf_html_extraction.results where operation_id=operation;
 if found then
  if old.metadata<>p_metadata or old.request_raw<>p_request or old.output_raw<>p_output then
   raise exception using errcode='23505',message='invented_html_extraction_operation_conflict';end if;
  return tf_html_extraction.result_receipt(operation);
 end if;
 insert into tf_html_extraction.results(operation_id,current_operation_id,previous_operation_id,metadata,request_raw,output_raw,stored_at)
 values(operation,current_operation,previous_operation,p_metadata,p_request,p_output,clock_timestamp());
 -- Receipt size is checked before this transaction can commit. A failure here
 -- rolls back the row; no otherwise-valid oversized request is truncated.
 return tf_html_extraction.result_receipt(operation);
end$$;
revoke all on all functions in schema tf_html_extraction from public;
